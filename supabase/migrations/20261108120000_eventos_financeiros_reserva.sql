-- Eventos financeiros da reserva, como na OS da oficina.
--
-- Uma reserva gera dois tipos de saída, que não se misturam:
--
-- 1. Custo da imobiliária (faxina terceirizada, lavanderia, comissão de canal...): é dinheiro
--    da imobiliária. Nasce como evento financeiro (source_type RESERVA, origem DESPESA_RESERVA),
--    entra na DRE pela competência e vai ao fluxo de caixa pelo mesmo lançamento de eventos da
--    OS (registrar_lancamento_de_eventos): a transação nasce com lancamento_id e, por isso, não
--    gera um segundo evento de resultado (transacao_gera_evento_de_resultado).
--
-- 2. Despesa do proprietário e repasse: o dinheiro é do proprietário, fora da DRE. Continua
--    sendo o lançamento contábil do imóvel (imovel_lancamento), agora com o vínculo da reserva.
--    O movimento do extrato não recebe reserva_id de propósito: imob_salvar_reserva trava a
--    edição de reserva com movimento, e uma despesa não muda o período nem o valor da estadia.
BEGIN;

-- ---------------------------------------------------------------- 1) evento da reserva
ALTER TABLE public.eventos_financeiros DROP CONSTRAINT eventos_financeiros_source_type_check;
ALTER TABLE public.eventos_financeiros ADD CONSTRAINT eventos_financeiros_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('ORDEM_SERVICO','VENDA','TRANSACAO','MANUAL','ENTRADA','USOCONSUMO_ENTRADA','IMOVEL_TAXA','RESERVA'));
ALTER TABLE public.eventos_financeiros DROP CONSTRAINT eventos_financeiros_origem_check;
ALTER TABLE public.eventos_financeiros ADD CONSTRAINT eventos_financeiros_origem_check
  CHECK (origem IN ('PRODUTO','SERVICO','COMISSAO','AVULSO','DESCONTO','FRETE','ENTRADA_FISCAL','CONSUMO',
    'ADMINISTRACAO_IMOBILIARIA','ESTORNO_ADMINISTRACAO_IMOBILIARIA','COMISSAO_IMOBILIARIA','DESPESA_RESERVA'));

CREATE INDEX IF NOT EXISTS eventos_financeiros_reserva_idx
  ON public.eventos_financeiros (source_id) WHERE source_type = 'RESERVA';

-- Na DRE, o custo da reserva é custo do serviço prestado: a mesma linha e classificação da
-- despesa de serviço terceirizado da OS (SERVICO:DESPESA), em cada template que a tiver.
INSERT INTO public.dre_mapeamento (template_id, linha_id, origem_tipo, origem_valor, percentual, classificacao_resultado_id, observacao)
SELECT m.template_id, m.linha_id, 'EVENTO_ORIGEM', 'DESPESA_RESERVA:DESPESA', 100, m.classificacao_resultado_id,
       'Custo da imobiliária vinculado a uma reserva (faxina, lavanderia, comissão de canal).'
  FROM public.dre_mapeamento m
 WHERE m.origem_tipo = 'EVENTO_ORIGEM' AND m.origem_valor = 'SERVICO:DESPESA' AND m.ativo
   AND NOT EXISTS (
     SELECT 1 FROM public.dre_mapeamento e
      WHERE e.template_id = m.template_id AND e.origem_tipo = 'EVENTO_ORIGEM'
        AND e.origem_valor = 'DESPESA_RESERVA:DESPESA' AND e.ativo);

-- Grava a classificação vigente do evento no template ativo, como faz a taxa de administração.
CREATE OR REPLACE FUNCTION public.imob_classificar_evento_reserva(p_evento_id bigint, p_usuario uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_template integer;
BEGIN
  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC, id DESC LIMIT 1;
  IF v_template IS NOT NULL THEN
    PERFORM public.dre_gravar_classificacao_evento(p_evento_id, v_template, p_usuario, NULL);
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.imob_criar_evento_reserva(
  p_reserva_id bigint, p_descricao text, p_detalhe text, p_valor numeric, p_data date, p_usuario uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r public.reserva_imovel%ROWTYPE;
  v_evento public.eventos_financeiros%ROWTYPE;
  v_data date;
BEGIN
  IF nullif(btrim(p_descricao), '') IS NULL OR p_valor IS NULL
     OR p_valor::text IN ('NaN','Infinity','-Infinity') OR round(p_valor, 2) <= 0 OR p_usuario IS NULL THEN
    RAISE EXCEPTION 'Informe o título e um valor positivo para o custo.' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(p_descricao)) > 200 THEN
    RAISE EXCEPTION 'O título do custo aceita até 200 caracteres.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.reserva_imovel WHERE id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE = 'P0002'; END IF;
  -- Como na OS: só a reserva cancelada fecha os eventos financeiros.
  IF r.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'Reserva cancelada não recebe novos custos.' USING ERRCODE = 'P0001';
  END IF;
  -- Competência: o dia escolhido pelo operador; sem ele, a entrada do hóspede.
  v_data := coalesce(p_data, r.inicio);
  PERFORM set_config('app.audit_user_id', p_usuario::text, true);
  INSERT INTO public.eventos_financeiros
    (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre, chave_origem,
     descricao, detalhe, valor, data_evento, competencia_em, is_manual, pode_gerar_transacao,
     created_by, status, dados_snapshot)
  VALUES (NULL, 'RESERVA', r.id, 'DESPESA_RESERVA', 'DESPESA',
    public.natureza_dre_de_evento('DESPESA_RESERVA', 'DESPESA'), 'MANUAL:' || gen_random_uuid(),
    btrim(p_descricao), nullif(btrim(p_detalhe), ''), round(p_valor, 2),
    (v_data + time '12:00') AT TIME ZONE 'America/Fortaleza', (v_data + time '12:00') AT TIME ZONE 'America/Fortaleza',
    true, true, p_usuario, 'ATIVO',
    jsonb_build_object('reserva_id', r.id, 'imovel_id', r.imovel_id, 'proprietario_id', r.proprietario_id,
      'lancamento_avulso_manual', true, 'criado_em', now()))
  RETURNING * INTO v_evento;
  PERFORM public.imob_classificar_evento_reserva(v_evento.id, p_usuario);
  RETURN to_jsonb(v_evento);
END $fn$;

-- Releitura sob lock: nunca edita/exclui dinheiro que outra tela acabou de lançar no financeiro.
CREATE OR REPLACE FUNCTION public.imob_alterar_evento_reserva(
  p_reserva_id bigint, p_evento_id bigint, p_operacao text, p_payload jsonb, p_usuario uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_evento public.eventos_financeiros%ROWTYPE;
  v_valor numeric;
  v_descricao text;
  v_detalhe text;
  v_data date;
  v_competencia timestamptz;
BEGIN
  IF p_usuario IS NULL OR p_operacao IS NULL OR p_operacao NOT IN ('EDITAR','EXCLUIR') THEN
    RAISE EXCEPTION 'Operação inválida.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.reserva_imovel WHERE id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_evento FROM public.eventos_financeiros
   WHERE id = p_evento_id AND source_type = 'RESERVA' AND source_id = p_reserva_id AND ordemservicoid IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Custo não encontrado nesta reserva.' USING ERRCODE = 'P0002'; END IF;
  IF v_evento.origem <> 'DESPESA_RESERVA' OR NOT coalesce(v_evento.is_manual, false)
     OR coalesce(v_evento.chave_origem, '') NOT LIKE 'MANUAL:%' THEN
    RAISE EXCEPTION 'Este evento é automático e deve ser corrigido na origem que o criou.' USING ERRCODE = 'P0001';
  END IF;
  IF v_evento.status = 'CONVERTIDO' OR v_evento.transacaoid IS NOT NULL OR v_evento.lancamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este custo já está no financeiro. Desfaça o lançamento antes de alterá-lo.' USING ERRCODE = 'P0001';
  END IF;
  IF v_evento.status <> 'ATIVO' THEN
    RAISE EXCEPTION 'Somente custos ativos podem ser alterados.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.audit_user_id', p_usuario::text, true);
  IF p_operacao = 'EXCLUIR' THEN
    DELETE FROM public.eventos_financeiros WHERE id = v_evento.id;
    RETURN jsonb_build_object('evento_id', v_evento.id, 'excluido', true, 'competencia_em', v_evento.competencia_em);
  END IF;

  v_valor := CASE WHEN p_payload ? 'valor' THEN (p_payload->>'valor')::numeric ELSE v_evento.valor END;
  v_descricao := btrim(coalesce(p_payload->>'descricao', v_evento.descricao));
  v_detalhe := CASE WHEN p_payload ? 'detalhe' THEN nullif(btrim(p_payload->>'detalhe'), '') ELSE v_evento.detalhe END;
  v_data := nullif(p_payload->>'data', '')::date;
  v_competencia := CASE WHEN v_data IS NULL THEN v_evento.competencia_em
    ELSE (v_data + time '12:00') AT TIME ZONE 'America/Fortaleza' END;
  IF v_valor IS NULL OR v_valor::text IN ('NaN','Infinity','-Infinity') OR round(v_valor, 2) <= 0
     OR nullif(v_descricao, '') IS NULL OR char_length(v_descricao) > 200 THEN
    RAISE EXCEPTION 'Informe o título e um valor positivo para o custo.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.eventos_financeiros
     SET descricao = v_descricao, detalhe = v_detalhe, valor = round(v_valor, 2),
         data_evento = v_competencia, competencia_em = v_competencia, updated_at = now(),
         dados_snapshot = coalesce(dados_snapshot, '{}'::jsonb)
           || jsonb_build_object('ajuste_manual', true, 'ajustado_em', now(), 'ajustado_por', p_usuario)
   WHERE id = v_evento.id
   RETURNING * INTO v_evento;
  -- Mudou o mês: a classificação é resolvida pela competência, então é gravada de novo.
  IF v_data IS NOT NULL THEN PERFORM public.imob_classificar_evento_reserva(v_evento.id, p_usuario); END IF;
  RETURN to_jsonb(v_evento);
END $fn$;

REVOKE ALL ON FUNCTION public.imob_classificar_evento_reserva(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_classificar_evento_reserva(bigint, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.imob_criar_evento_reserva(bigint, text, text, numeric, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_criar_evento_reserva(bigint, text, text, numeric, date, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.imob_alterar_evento_reserva(bigint, bigint, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_alterar_evento_reserva(bigint, bigint, text, jsonb, uuid) TO service_role;

-- O lançamento de eventos (boleto do terceirizado, à vista ou parcelado) passa a aceitar o custo
-- da reserva. Mesmo padrão de patch da 20261005162941: a versão vigente é reescrita no ponto
-- exato, e a migration aborta se o trecho não estiver lá.
DO $patch$
DECLARE v_sql text; v_antigo text; v_novo text;
BEGIN
  SELECT pg_get_functiondef('public.registrar_lancamento_de_eventos(jsonb)'::regprocedure) INTO v_sql;
  v_novo := $new$AND NOT (e.source_type = 'RESERVA' AND e.origem = 'DESPESA_RESERVA' AND e.is_manual
              AND EXISTS (SELECT 1 FROM public.reserva_imovel ri WHERE ri.id = e.source_id))
     AND NOT (e.source_type IS NOT DISTINCT FROM 'VENDA'$new$;
  IF strpos(v_sql, 'DESPESA_RESERVA') = 0 THEN
    v_antigo := $old$AND NOT (e.source_type IS NOT DISTINCT FROM 'VENDA'$old$;
    IF strpos(v_sql, v_antigo) = 0 THEN RAISE EXCEPTION 'Validação de origem do lançamento não encontrada.'; END IF;
    v_sql := replace(v_sql, v_antigo, v_novo);
    v_sql := replace(v_sql, 'comissao ou despesa manual de venda', 'comissao, despesa manual de venda ou custo de reserva');
    EXECUTE v_sql;
  END IF;
END
$patch$;

-- ---------------------------------------------------------------- 2) conta do proprietário
ALTER TABLE public.imovel_lancamento ADD COLUMN IF NOT EXISTS reserva_id bigint REFERENCES public.reserva_imovel(id);
CREATE INDEX IF NOT EXISTS imovel_lancamento_reserva_idx ON public.imovel_lancamento (reserva_id) WHERE reserva_id IS NOT NULL;

-- Igual à 20261102210000, mais o vínculo opcional da reserva (do mesmo imóvel e proprietário).
CREATE OR REPLACE FUNCTION public.imob_registrar_lancamento(p_payload jsonb, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
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
  v_saldo numeric;
  v_pendente numeric;
  l public.imovel_lancamento%ROWTYPE;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE = '42501'; END IF;
  IF v_natureza IS NULL THEN RAISE EXCEPTION 'Tipo de lançamento inválido.' USING ERRCODE = '22023'; END IF;
  IF v_key IS NULL OR v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe valor positivo e chave de idempotência.' USING ERRCODE = '22023'; END IF;
  IF v_descricao IS NULL THEN RAISE EXCEPTION 'Informe a descrição do lançamento.' USING ERRCODE = '22023'; END IF;

  -- Trava o proprietário: dois repasses ao mesmo tempo não podem gastar o mesmo saldo.
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

  IF v_natureza = 'REPASSE' THEN
    SELECT coalesce(sum(CASE WHEN tipo = 'BRUTO_RECEBIDO' THEN valor ELSE -valor END), 0) INTO v_saldo
      FROM public.imovel_movimento WHERE proprietario_id = v_prop AND imovel_id = v_imovel;
    -- Repasses antigos, criados direto como transação em aberto, ainda comprometem o saldo.
    SELECT coalesce(sum(greatest(coalesce(nullif("valorLiquido", 0), valor) - valor_baixado, 0)), 0) INTO v_pendente
      FROM public.transacao WHERE proprietario_id = v_prop AND imovel_id = v_imovel AND imovel_natureza = 'REPASSE'
        AND pendente AND NOT is_deleted AND baixa_de_transacao_id IS NULL;
    IF v_valor > v_saldo - v_pendente THEN
      RAISE EXCEPTION 'Repasse excede o saldo disponível do proprietário.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.imovel_lancamento (imovel_id, proprietario_id, reserva_id, natureza, valor, data, competencia_em, descricao, idempotency_key, created_by)
  VALUES (v_imovel, v_prop, v_reserva, v_natureza, v_valor, v_data, date_trunc('month', v_data)::date, v_descricao, v_key, v_actor)
  RETURNING * INTO l;

  INSERT INTO public.imovel_movimento (imovel_id, proprietario_id, lancamento_id, transacao_chave, tipo, valor, competencia_em, data_movimento, descricao, chave_unica, created_by, auth_actor_id)
  VALUES (v_imovel, v_prop, l.id, NULL, v_natureza, v_valor, l.competencia_em, (v_data + time '12:00') AT TIME ZONE 'America/Fortaleza', v_descricao,
    'LANCAMENTO:' || l.id, v_actor, public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id', true)));

  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_registrar_lancamento(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_registrar_lancamento(jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
