-- Repasse como liquidação de obrigação e taxa reconhecida na prestação do serviço.
--
-- 1. Taxa de administração da reserva: a receita entra na DRE na competência do check-out
--    (fim da estadia), quando a administradora adquire o direito à comissão. O caixa continua
--    na data do pagamento (data_evento). Ajuste manual de data no painel é preservado.
--
-- 2. Repasse ao proprietário: registrar o repasse não abate mais o saldo a repassar. O
--    movimento REPASSE do extrato passa a acompanhar o que foi efetivamente PAGO nas transações
--    ligadas ao lançamento (a principal e os ajustes). Enquanto não há pagamento, a dívida com o
--    proprietário continua no saldo. Despesa do proprietário segue abatendo na hora (ela é
--    devida assim que acontece).
--
-- Também grava reserva_id nos movimentos de lançamentos ligados a reserva.
BEGIN;

-- --------------------------------------------------------------------------- 2. repasse
-- Alvo do extrato = soma do que foi pago nas transações do lançamento (DESPESA soma, RECEITA de
-- ajuste devolve). Lançamento estornado tem alvo zero. Grava só a diferença: o razão é imutável.
CREATE OR REPLACE FUNCTION public.imob_sincronizar_repasse(
  p_lancamento_id bigint,
  p_actor uuid DEFAULT NULL,
  p_ignorar_transacao bigint DEFAULT NULL,
  p_prefixo_estorno text DEFAULT 'Estorno: '
) RETURNS void
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  l public.imovel_lancamento%ROWTYPE;
  v_alvo numeric(14,2) := 0;
  v_atual numeric(14,2);
  v_delta numeric(14,2);
  v_pago_em timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('imob-repasse:' || p_lancamento_id, 0));
  SELECT * INTO l FROM public.imovel_lancamento WHERE id = p_lancamento_id;
  IF NOT FOUND OR l.natureza <> 'REPASSE' THEN RETURN; END IF;

  IF l.cancelado_em IS NULL THEN
    SELECT coalesce(sum(CASE WHEN t.tipo::text = 'DESPESA' THEN 1 ELSE -1 END
                        * CASE WHEN t.pendente THEN coalesce(t.valor_baixado, 0) ELSE t.valor END), 0),
           max(t.pago_em)
      INTO v_alvo, v_pago_em
      FROM public.transacao t
     WHERE (t.id = l.transacao_id OR t.imovel_lancamento_contabil_id = l.id)
       AND NOT t.is_deleted
       AND NOT coalesce(t.abonado, false)
       AND t.baixa_de_transacao_id IS NULL
       AND (p_ignorar_transacao IS NULL OR t.id <> p_ignorar_transacao);
  END IF;

  SELECT coalesce(sum(valor), 0) INTO v_atual FROM public.imovel_movimento WHERE lancamento_id = l.id AND tipo = 'REPASSE';
  v_delta := round(v_alvo - v_atual, 2);
  IF v_delta = 0 THEN RETURN; END IF;

  INSERT INTO public.imovel_movimento (imovel_id, proprietario_id, reserva_id, lancamento_id, transacao_chave, tipo, valor,
    competencia_em, data_movimento, descricao, chave_unica, created_by, auth_actor_id)
  VALUES (l.imovel_id, l.proprietario_id, l.reserva_id, l.id, NULL, 'REPASSE', v_delta, l.competencia_em,
    CASE WHEN v_delta > 0 THEN coalesce(v_pago_em, clock_timestamp()) ELSE clock_timestamp() END,
    CASE WHEN v_delta < 0 THEN p_prefixo_estorno ELSE '' END || l.descricao,
    gen_random_uuid()::text, coalesce(p_actor, l.created_by),
    public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id', true)));
END $function$;

REVOKE ALL ON FUNCTION public.imob_sincronizar_repasse(bigint, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_sincronizar_repasse(bigint, uuid, bigint, text) TO service_role;

-- Toda mudança numa transação de repasse (baixa, estorno, exclusão lógica, ajuste) refaz o extrato.
CREATE OR REPLACE FUNCTION public.imob_transacao_movimento()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id bigint;
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.imob_sincronizar_movimento(old,true); RETURN old; END IF;
 PERFORM public.imob_sincronizar_movimento(new,false);
 FOR v_id IN SELECT id FROM public.imovel_lancamento
   WHERE natureza='REPASSE' AND (transacao_id=new.id OR id=new.imovel_lancamento_contabil_id) LOOP
  PERFORM public.imob_sincronizar_repasse(v_id, coalesce(new.baixado_por,new.updated_by,new.created_by));
 END LOOP;
 RETURN new;
END $function$;

-- Exclusão física: antes do ON DELETE SET NULL soltar o vínculo, refaz o extrato sem a transação.
CREATE OR REPLACE FUNCTION public.imob_repasse_antes_excluir_transacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id bigint;
BEGIN
 FOR v_id IN SELECT id FROM public.imovel_lancamento
   WHERE natureza='REPASSE' AND (transacao_id=old.id OR id=old.imovel_lancamento_contabil_id) LOOP
  PERFORM public.imob_sincronizar_repasse(v_id, NULL, old.id);
 END LOOP;
 RETURN old;
END $function$;

DROP TRIGGER IF EXISTS z_imob_repasse_antes_excluir ON public.transacao;
CREATE TRIGGER z_imob_repasse_antes_excluir BEFORE DELETE ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.imob_repasse_antes_excluir_transacao();

-- Registrar: despesa do proprietário entra no extrato na hora; repasse só quando for pago.
CREATE OR REPLACE FUNCTION public.imob_registrar_lancamento(p_payload jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_prop bigint := (p_payload->>'proprietario_id')::bigint;
  v_imovel bigint := (p_payload->>'imovel_id')::bigint;
  v_reserva bigint := nullif(p_payload->>'reserva_id', '')::bigint;
  v_valor numeric(14,2) := round((p_payload->>'valor')::numeric, 2);
  v_tipo text := upper(coalesce(p_payload->>'tipo', p_payload->>'natureza', ''));
  v_natureza text := CASE WHEN v_tipo IN ('DESPESA', 'DESPESA_PROPRIETARIO') THEN 'DESPESA_PROPRIETARIO' WHEN v_tipo = 'REPASSE' THEN 'REPASSE' END;
  v_data date := coalesce((p_payload->>'data')::date, current_date);
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_descricao text := nullif(btrim(p_payload->>'descricao'), '');
  l public.imovel_lancamento%ROWTYPE;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE = '42501'; END IF;
  IF v_natureza IS NULL THEN RAISE EXCEPTION 'Tipo de lançamento inválido.' USING ERRCODE = '22023'; END IF;
  IF v_key IS NULL OR v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe valor positivo e chave de idempotência.' USING ERRCODE = '22023'; END IF;
  IF v_descricao IS NULL THEN RAISE EXCEPTION 'Informe a descrição do lançamento.' USING ERRCODE = '22023'; END IF;

  -- Serializa os lançamentos do mesmo proprietário (idempotência e ordem do extrato).
  PERFORM 1 FROM public.proprietario WHERE id = v_prop AND ativo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proprietário inexistente ou inativo.'; END IF;

  SELECT * INTO l FROM public.imovel_lancamento WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF l.imovel_id <> v_imovel OR l.proprietario_id <> v_prop OR l.valor <> v_valor OR l.natureza <> v_natureza
       OR l.reserva_id IS DISTINCT FROM v_reserva THEN
      RAISE EXCEPTION 'Chave de idempotência reutilizada com outros dados.' USING ERRCODE = '23505';
    END IF;
    RETURN to_jsonb(l);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.imovel WHERE id = v_imovel
      AND (proprietario_id = v_prop OR EXISTS (SELECT 1 FROM public.imovel_movimento WHERE imovel_id = v_imovel AND proprietario_id = v_prop))
  ) THEN
    RAISE EXCEPTION 'Imóvel não pertence ao proprietário informado.';
  END IF;

  IF v_reserva IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.reserva_imovel WHERE id = v_reserva AND imovel_id = v_imovel AND proprietario_id = v_prop
  ) THEN
    RAISE EXCEPTION 'A reserva não pertence a este imóvel e proprietário.' USING ERRCODE = '22023';
  END IF;

  -- Sem conferência de saldo: o repasse pode vir antes do recebimento e negativar o extrato.

  INSERT INTO public.imovel_lancamento (imovel_id, proprietario_id, reserva_id, natureza, valor, data, competencia_em, descricao, idempotency_key, created_by)
  VALUES (v_imovel, v_prop, v_reserva, v_natureza, v_valor, v_data, date_trunc('month', v_data)::date, v_descricao, v_key, v_actor)
  RETURNING * INTO l;

  -- O repasse liquida a dívida com o proprietário só quando o dinheiro sai: o extrato é
  -- atualizado pela baixa da transação (imob_sincronizar_repasse).
  IF v_natureza = 'DESPESA_PROPRIETARIO' THEN
    INSERT INTO public.imovel_movimento (imovel_id, proprietario_id, reserva_id, lancamento_id, transacao_chave, tipo, valor, competencia_em, data_movimento, descricao, chave_unica, created_by, auth_actor_id)
    VALUES (v_imovel, v_prop, v_reserva, l.id, NULL, v_natureza, v_valor, l.competencia_em, (v_data + time '12:00') AT TIME ZONE 'America/Fortaleza', v_descricao,
      'LANCAMENTO:' || l.id, v_actor, public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id', true)));
  END IF;

  RETURN to_jsonb(l);
END $function$;

-- Estornar: devolve ao extrato exatamente o que o lançamento ainda pesa nele.
CREATE OR REPLACE FUNCTION public.imob_cancelar_lancamento(p_id bigint, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_saldo numeric;
  l public.imovel_lancamento%ROWTYPE;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.imovel_lancamento WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF l.cancelado_em IS NOT NULL THEN RETURN to_jsonb(l); END IF;
  IF EXISTS (SELECT 1 FROM public.transacao WHERE (id = l.transacao_id OR imovel_lancamento_contabil_id=l.id) AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Este lançamento já está no financeiro (transação #%). Exclua a transação antes de estornar.', l.transacao_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.imovel_lancamento SET cancelado_em = now(), cancelado_por = v_actor WHERE id = l.id RETURNING * INTO l;
  IF l.natureza = 'REPASSE' THEN
    PERFORM public.imob_sincronizar_repasse(l.id, v_actor);
  ELSE
    SELECT coalesce(sum(valor), 0) INTO v_saldo FROM public.imovel_movimento WHERE lancamento_id = l.id;
    IF v_saldo <> 0 THEN
      INSERT INTO public.imovel_movimento (imovel_id, proprietario_id, reserva_id, lancamento_id, transacao_chave, tipo, valor, competencia_em, data_movimento, descricao, chave_unica, created_by, auth_actor_id)
      VALUES (l.imovel_id, l.proprietario_id, l.reserva_id, l.id, NULL, l.natureza, -v_saldo, l.competencia_em, clock_timestamp(), 'Estorno: ' || l.descricao,
        'LANCAMENTO:' || l.id || ':ESTORNO', v_actor, public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id', true)));
    END IF;
  END IF;
  RETURN to_jsonb(l);
END $function$;

-- Vincular a transação ao repasse já pago (ex.: lançada como paga) atualiza o extrato na hora.
CREATE OR REPLACE FUNCTION public.imob_vincular_lancamento(p_lancamento_id bigint, p_transacao_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  l public.imovel_lancamento%ROWTYPE;
  t public.transacao%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.imovel_lancamento WHERE id = p_lancamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF l.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Este lançamento foi estornado.' USING ERRCODE = '22023'; END IF;
  IF l.transacao_id IS NOT NULL AND l.transacao_id <> p_transacao_id
     AND EXISTS (SELECT 1 FROM public.transacao WHERE id = l.transacao_id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Este lançamento já está no financeiro (transação #%).', l.transacao_id USING ERRCODE = '23505';
  END IF;
  IF EXISTS(SELECT 1 FROM public.transacao WHERE imovel_lancamento_contabil_id=l.id AND NOT is_deleted) THEN RAISE EXCEPTION 'Este lançamento possui ajustes ativos no financeiro.' USING ERRCODE='23505'; END IF; SELECT * INTO t FROM public.transacao WHERE id = p_transacao_id;
  IF NOT FOUND OR t.is_deleted THEN RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF t.tipo::text <> 'DESPESA' OR t.imovel_id IS NOT NULL OR round(t.valor, 2) <> l.valor THEN
    RAISE EXCEPTION 'A transação não corresponde ao lançamento contábil.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.imovel_lancamento SET transacao_id = p_transacao_id WHERE id = l.id RETURNING * INTO l;
  IF l.natureza = 'REPASSE' THEN
    PERFORM public.imob_sincronizar_repasse(l.id, coalesce(t.baixado_por, t.updated_by, t.created_by));
  END IF;
  RETURN to_jsonb(l);
END $function$;

-- Editar: a despesa refaz o extrato na hora; o repasse é refeito pelo que já foi pago.
CREATE OR REPLACE FUNCTION public.imob_editar_lancamento_reserva(p_reserva_id bigint, p_lancamento_id bigint, p_payload jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  l public.imovel_lancamento%ROWTYPE;
  v_valor numeric;
  v_descricao text;
  v_data date;
  v_soma numeric;
  v_ajuste bigint;
  t public.transacao%ROWTYPE;
BEGIN
  IF public.imob_definir_ator(p_actor) IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE='42501'; END IF;
  SELECT * INTO l FROM public.imovel_lancamento WHERE id=p_lancamento_id AND reserva_id=p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado nesta reserva.' USING ERRCODE='P0002'; END IF;
  IF l.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Lançamento estornado não pode ser editado.' USING ERRCODE='22023'; END IF;
  IF p_payload ? 'atualizado_em' AND l.updated_at IS DISTINCT FROM (p_payload->>'atualizado_em')::timestamptz THEN
    RAISE EXCEPTION 'O lançamento mudou. Atualize a lista.' USING ERRCODE='40001';
  END IF;
  v_valor:=round(CASE WHEN p_payload ? 'valor' THEN (p_payload->>'valor')::numeric ELSE l.valor END,2);
  v_descricao:=btrim(coalesce(p_payload->>'descricao',l.descricao));
  v_data:=coalesce(nullif(p_payload->>'data','')::date,l.data);
  IF v_valor IS NULL OR v_valor::text IN ('NaN','Infinity','-Infinity') OR v_valor<=0
    OR nullif(v_descricao,'') IS NULL OR char_length(v_descricao)>200 THEN
    RAISE EXCEPTION 'Informe o título e um valor positivo para o lançamento.' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.transacao WHERE (id=l.transacao_id OR imovel_lancamento_contabil_id=l.id) AND NOT is_deleted ORDER BY id FOR UPDATE;
  SELECT * INTO t FROM public.transacao WHERE id=l.transacao_id AND NOT is_deleted;
  IF FOUND OR EXISTS(SELECT 1 FROM public.transacao WHERE imovel_lancamento_contabil_id=l.id AND NOT is_deleted) THEN
    IF (p_payload->>'pode_editar_financeiro') IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Você não tem permissão para editar transações vinculadas.' USING ERRCODE='42501';
    END IF;
    SELECT sum(CASE WHEN tipo::text='DESPESA' THEN valor ELSE -valor END) INTO v_soma FROM public.transacao
      WHERE (id=l.transacao_id OR imovel_lancamento_contabil_id=l.id) AND NOT is_deleted AND baixa_de_transacao_id IS NULL;
    IF v_valor IS DISTINCT FROM l.valor THEN
      IF t.id IS NOT NULL AND t.pendente
        AND NOT EXISTS(SELECT 1 FROM public.transacao WHERE (baixa_de_transacao_id=t.id OR imovel_lancamento_contabil_id=l.id) AND NOT is_deleted) THEN
        PERFORM public.imob_ajustar_transacao_reserva(t.id,v_valor,p_actor);
      ELSE
        v_ajuste:=public.imob_criar_ajuste_financeiro_reserva(p_reserva_id,v_valor-v_soma,v_descricao,
          (v_data+time '12:00') AT TIME ZONE 'America/Fortaleza',p_actor,NULL,l.id);
      END IF;
    END IF;
  END IF;
  -- Despesa: estorna a versão anterior e registra a nova, preservando o histórico do extrato.
  IF l.natureza<>'REPASSE' AND ROW(l.valor,l.data,l.descricao) IS DISTINCT FROM ROW(v_valor,v_data,v_descricao) THEN
    INSERT INTO public.imovel_movimento(imovel_id,proprietario_id,reserva_id,lancamento_id,transacao_chave,tipo,valor,competencia_em,data_movimento,descricao,chave_unica,created_by)
    VALUES(l.imovel_id,l.proprietario_id,l.reserva_id,l.id,NULL,l.natureza,-l.valor,l.competencia_em,
      (l.data+time '12:00') AT TIME ZONE 'America/Fortaleza','Ajuste: '||l.descricao,gen_random_uuid()::text,p_actor),
      (l.imovel_id,l.proprietario_id,l.reserva_id,l.id,NULL,l.natureza,v_valor,v_data,
      (v_data+time '12:00') AT TIME ZONE 'America/Fortaleza',v_descricao,gen_random_uuid()::text,p_actor);
  END IF;
  UPDATE public.imovel_lancamento SET valor=v_valor,descricao=v_descricao,data=v_data,competencia_em=v_data,updated_at=clock_timestamp()
    WHERE id=l.id RETURNING * INTO l;
  -- Repasse: o extrato segue o que foi pago; um ajuste pendente só pesa quando for baixado.
  IF l.natureza='REPASSE' THEN PERFORM public.imob_sincronizar_repasse(l.id,p_actor); END IF;
  RETURN to_jsonb(l) || jsonb_build_object('ajuste_transacao_id',v_ajuste);
END $function$;

-- ------------------------------------------------------------- 1. taxa na competência do check-out
DO $patch$
DECLARE v_sql text;
BEGIN
  SELECT pg_get_functiondef('public.imob_sincronizar_movimento(public.transacao,boolean)'::regprocedure) INTO v_sql;
  IF strpos(v_sql, 'v_competencia_taxa') = 0 THEN
    IF strpos(v_sql, 'v_origem text; v_evento_valor numeric;') = 0
       OR strpos(v_sql, ',v_evento_valor,coalesce(p_tx.pago_em,now()),coalesce(p_tx.pago_em,now()),') = 0
       OR strpos(v_sql, '  SELECT id INTO v_template FROM public.dre_template') = 0 THEN
      RAISE EXCEPTION 'Ponto da competência da taxa administrativa não encontrado.';
    END IF;
    v_sql := replace(v_sql, 'v_origem text; v_evento_valor numeric;', 'v_origem text; v_evento_valor numeric; v_competencia_taxa timestamptz;');
    -- Reserva: a comissão é ganha no check-out; sem reserva (locação, venda), vale o pagamento.
    v_sql := replace(v_sql, '  SELECT id INTO v_template FROM public.dre_template',
      '  v_competencia_taxa:=coalesce(p_tx.pago_em,now());' || chr(10)
      || '  IF p_tx.reserva_imovel_id IS NOT NULL THEN' || chr(10)
      || '   SELECT coalesce((fim+time ''12:00'') AT TIME ZONE ''America/Fortaleza'',v_competencia_taxa) INTO v_competencia_taxa FROM public.reserva_imovel WHERE id=p_tx.reserva_imovel_id;' || chr(10)
      || '  END IF;' || chr(10)
      || '  SELECT id INTO v_template FROM public.dre_template');
    v_sql := replace(v_sql, ',v_evento_valor,coalesce(p_tx.pago_em,now()),coalesce(p_tx.pago_em,now()),',
      ',v_evento_valor,coalesce(p_tx.pago_em,now()),v_competencia_taxa,');
    EXECUTE v_sql;
  END IF;
END $patch$;

-- ----------------------------------------------------------------------- dados existentes
-- Taxas de reserva já lançadas passam para o mês do check-out, salvo data ajustada à mão.
UPDATE public.eventos_financeiros e
   SET competencia_em = (r.fim + time '12:00') AT TIME ZONE 'America/Fortaleza', updated_at = now()
  FROM public.reserva_imovel r
 WHERE e.source_type = 'IMOVEL_TAXA'
   AND (e.dados_snapshot->>'reserva_id') ~ '^\d+$'
   AND (e.dados_snapshot->>'reserva_id')::bigint = r.id
   AND coalesce(e.dados_snapshot->>'data_ajustada', 'false') <> 'true'
   AND e.competencia_em IS DISTINCT FROM (r.fim + time '12:00') AT TIME ZONE 'America/Fortaleza';

-- Repasses registrados e ainda não pagos voltam ao saldo a repassar.
DO $repasses$
DECLARE v_id bigint;
BEGIN
  FOR v_id IN SELECT id FROM public.imovel_lancamento WHERE natureza = 'REPASSE' ORDER BY id LOOP
    PERFORM public.imob_sincronizar_repasse(v_id, NULL, NULL, 'Aguardando pagamento: ');
  END LOOP;
END $repasses$;

NOTIFY pgrst, 'reload schema';
COMMIT;
