-- Edição dos eventos da reserva, inclusive taxa automática e custos já convertidos.
-- O razão do proprietário continua imutável: correções acrescentam movimentos de ajuste.
BEGIN;

ALTER TABLE public.transacao ADD COLUMN IF NOT EXISTS imovel_taxa_admin_ajustada numeric(14,2)
  CHECK (imovel_taxa_admin_ajustada >= 0);
ALTER TABLE public.imovel_lancamento ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.transacao ADD COLUMN IF NOT EXISTS imovel_lancamento_contabil_id bigint REFERENCES public.imovel_lancamento(id);
CREATE INDEX IF NOT EXISTS transacao_imovel_lancamento_contabil_idx ON public.transacao(imovel_lancamento_contabil_id)
  WHERE imovel_lancamento_contabil_id IS NOT NULL;

-- Mantém o ajuste no pagamento que gerou a taxa, de modo que retries do gatilho não o apaguem.
-- Exclusão/estorno do pagamento continua levando a taxa e o seu evento a zero.
DO $patch$
DECLARE v_sql text;
BEGIN
  SELECT pg_get_functiondef('public.imob_sincronizar_movimento(public.transacao,boolean)'::regprocedure) INTO v_sql;
  IF strpos(v_sql, 'p_tx.imovel_taxa_admin_ajustada') = 0 THEN
    IF strpos(v_sql, ' v_actor:=coalesce(p_tx.baixado_por,p_tx.updated_by,p_tx.created_by);') = 0 THEN
      RAISE EXCEPTION 'Ponto de cálculo da taxa administrativa não encontrado.';
    END IF;
    v_sql := replace(v_sql, ' v_actor:=coalesce(p_tx.baixado_por,p_tx.updated_by,p_tx.created_by);', $new$
 IF v_valor > 0 AND p_tx.imovel_natureza IN ('RECEBIMENTO','REEMBOLSO') AND p_tx.imovel_taxa_admin_ajustada IS NOT NULL THEN
  v_taxa := p_tx.imovel_taxa_admin_ajustada * CASE WHEN p_tx.imovel_natureza='REEMBOLSO' THEN -1 ELSE 1 END;
 END IF;
 v_actor:=coalesce(p_tx.baixado_por,p_tx.updated_by,p_tx.created_by);$new$);
    IF strpos(v_sql, '''locacao_id'',p_tx.locacao_imovel_id)') = 0
      OR strpos(v_sql, 'dados_snapshot=excluded.dados_snapshot') = 0 THEN
      RAISE EXCEPTION 'Snapshot da taxa administrativa não encontrado.';
    END IF;
    v_sql := replace(v_sql, '''locacao_id'',p_tx.locacao_imovel_id)',
      '''locacao_id'',p_tx.locacao_imovel_id,''taxa_admin_ajustada'',p_tx.imovel_taxa_admin_ajustada IS NOT NULL,''taxa_admin_valor_automatico'',round(v_valor*coalesce(p_tx.imovel_percentual_admin,0)/100,2))');
    v_sql := replace(v_sql, 'data_evento=excluded.data_evento,competencia_em=excluded.competencia_em,dados_snapshot=excluded.dados_snapshot',
      'data_evento=CASE WHEN eventos_financeiros.dados_snapshot->>''data_ajustada''=''true'' THEN eventos_financeiros.data_evento ELSE excluded.data_evento END,'
      || 'competencia_em=CASE WHEN eventos_financeiros.dados_snapshot->>''data_ajustada''=''true'' THEN eventos_financeiros.competencia_em ELSE excluded.competencia_em END,'
      || 'dados_snapshot=coalesce(eventos_financeiros.dados_snapshot,''{}''::jsonb)||excluded.dados_snapshot');
    EXECUTE v_sql;
  END IF;
END $patch$;

-- Parcelas sem pagamento usam a RPC de valores existente, com seu histórico.
-- Quando já houve pagamento, a diferença vira outra transação; nenhuma baixa é reescrita.
CREATE OR REPLACE FUNCTION public.imob_ajustar_transacao_reserva(p_id bigint, p_valor numeric, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='5s' AS $fn$
DECLARE
  t public.transacao%ROWTYPE;
  v_liquido numeric;
BEGIN
  SELECT * INTO t FROM public.transacao WHERE id=p_id AND NOT is_deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transação vinculada não encontrada.' USING ERRCODE='P0002'; END IF;
  IF round(p_valor,2)=t.valor THEN RETURN; END IF;
  IF NOT coalesce((SELECT habilitar_edicao_transacoes FROM public.config_geral ORDER BY id DESC LIMIT 1),false) THEN
    RAISE EXCEPTION 'A edição de transações está desativada nas configurações gerais.' USING ERRCODE='42501';
  END IF;
  IF p_valor IS NULL OR round(p_valor,2)<=0 OR t.valor<=0 OR t.baixa_de_transacao_id IS NOT NULL THEN
    RAISE EXCEPTION 'Valor ou título inválido para o ajuste.' USING ERRCODE='22023';
  END IF;
  IF NOT t.pendente OR EXISTS(SELECT 1 FROM public.transacao WHERE baixa_de_transacao_id=t.id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Pagamento existente exige uma transação de ajuste.' USING ERRCODE='22023';
  END IF;
  v_liquido := round(coalesce(nullif(t."valorLiquido",0),t.valor)*p_valor/t.valor,2);
  PERFORM public.ajustar_valores_transacao(jsonb_build_array(jsonb_build_object('id',t.id,'valor',round(p_valor,2),'valorLiquido',v_liquido,
    'valorAnterior',t.valor,'valorLiquidoAnterior',coalesce(nullif(t."valorLiquido",0),t.valor))),p_actor,'Edição de evento da reserva');
END $fn$;
REVOKE ALL ON FUNCTION public.imob_ajustar_transacao_reserva(bigint,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_ajustar_transacao_reserva(bigint,numeric,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.imob_criar_ajuste_financeiro_reserva(
  p_reserva_id bigint,p_delta numeric,p_descricao text,p_competencia timestamptz,p_actor uuid,p_grupo bigint,p_conta bigint
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_id bigint; t public.transacao%ROWTYPE;
BEGIN
  IF NOT coalesce((SELECT habilitar_edicao_transacoes FROM public.config_geral ORDER BY id DESC LIMIT 1),false) THEN
    RAISE EXCEPTION 'A edição de transações está desativada nas configurações gerais.' USING ERRCODE='42501';
  END IF;
  IF round(p_delta,2)=0 THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.transacao WHERE NOT is_deleted AND (lancamento_id=p_grupo
    OR id=(SELECT transacao_id FROM public.imovel_lancamento WHERE id=p_conta) OR imovel_lancamento_contabil_id=p_conta)
    ORDER BY id LIMIT 1;
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,vencimento_em,competencia_em,tipo,pendente,
    lancamento_id,imovel_lancamento_contabil_id,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador,fornecedor_id)
  VALUES('Ajuste: '||p_descricao||' · Reserva #'||p_reserva_id,abs(round(p_delta,2)),abs(round(p_delta,2)),
    now(),now(),p_competencia,CASE WHEN p_delta>0 THEN 'DESPESA'::public.tipos_transacao ELSE 'RECEITA'::public.tipos_transacao END,
    true,p_grupo,p_conta,p_conta IS NOT NULL,p_actor,coalesce(t.nomepagador,'Ajuste da reserva'),coalesce(t.cpfcnpjpagador,'NAO INFORMADO'),t.fornecedor_id) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.imob_criar_ajuste_financeiro_reserva(bigint,numeric,text,timestamptz,uuid,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_criar_ajuste_financeiro_reserva(bigint,numeric,text,timestamptz,uuid,bigint,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.imob_alterar_evento_reserva(
  p_reserva_id bigint,p_evento_id bigint,p_operacao text,p_payload jsonb,p_usuario uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='5s' AS $fn$
DECLARE
  e public.eventos_financeiros%ROWTYPE;
  t public.transacao%ROWTYPE;
  v_valor numeric;
  v_descricao text;
  v_detalhe text;
  v_competencia timestamptz;
  v_soma numeric;
  v_novo_total numeric;
  v_acumulado numeric := 0;
  v_anterior numeric := 0;
  v_parcela numeric;
  v_grupo bigint;
  v_snapshot jsonb;
  v_ajuste bigint;
BEGIN
  IF public.imob_definir_ator(p_usuario) IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE='42501'; END IF;
  IF p_operacao IS NULL OR p_operacao NOT IN ('EDITAR','EXCLUIR') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM public.eventos_financeiros WHERE id=p_evento_id;
  IF NOT FOUND OR ((e.source_type='RESERVA' AND e.source_id=p_reserva_id)
    OR (e.source_type='IMOVEL_TAXA' AND (e.dados_snapshot->>'reserva_id')::bigint=p_reserva_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Evento não encontrado nesta reserva.' USING ERRCODE='P0002';
  END IF;
  -- O gatilho da taxa já segura a transação antes de escrever o evento: mesma ordem aqui.
  IF e.source_type='IMOVEL_TAXA' THEN
    SELECT * INTO t FROM public.transacao WHERE id=e.source_id AND reserva_imovel_id=p_reserva_id AND NOT is_deleted FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento deste evento não encontrado.' USING ERRCODE='P0002'; END IF;
  END IF;
  v_grupo:=e.lancamento_id;
  IF v_grupo IS NOT NULL THEN
    PERFORM 1 FROM public.lancamento_de_eventos WHERE id=v_grupo FOR UPDATE;
  END IF;
  SELECT * INTO e FROM public.eventos_financeiros WHERE id=p_evento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento não encontrado nesta reserva.' USING ERRCODE='P0002'; END IF;
  IF e.lancamento_id IS DISTINCT FROM v_grupo THEN
    RAISE EXCEPTION 'O vínculo financeiro mudou. Atualize a lista.' USING ERRCODE='40001';
  END IF;
  IF e.status NOT IN ('ATIVO','CONVERTIDO') THEN RAISE EXCEPTION 'Somente eventos ativos podem ser alterados.' USING ERRCODE='P0001'; END IF;
  IF p_payload ? 'atualizado_em' AND e.updated_at IS DISTINCT FROM (p_payload->>'atualizado_em')::timestamptz THEN
    RAISE EXCEPTION 'O evento mudou. Atualize a lista.' USING ERRCODE='40001';
  END IF;
  IF p_operacao='EXCLUIR' THEN
    IF e.source_type<>'RESERVA' OR e.origem<>'DESPESA_RESERVA' OR NOT coalesce(e.is_manual,false)
      OR e.status<>'ATIVO' OR e.transacaoid IS NOT NULL OR e.lancamento_id IS NOT NULL THEN
      RAISE EXCEPTION 'Desfaça o lançamento ou use o cancelamento na origem antes de excluir.' USING ERRCODE='P0001';
    END IF;
    DELETE FROM public.eventos_financeiros WHERE id=e.id;
    RETURN jsonb_build_object('evento_id',e.id,'excluido',true,'competencia_em',e.competencia_em);
  END IF;
  IF (e.lancamento_id IS NOT NULL OR e.transacaoid IS NOT NULL) AND (p_payload->>'pode_editar_financeiro') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Você não tem permissão para editar transações vinculadas.' USING ERRCODE='42501';
  END IF;
  IF NOT ((e.source_type='RESERVA' AND e.origem IN ('DESPESA_RESERVA','CONSUMO'))
    OR (e.source_type='IMOVEL_TAXA' AND e.origem IN ('ADMINISTRACAO_IMOBILIARIA','ESTORNO_ADMINISTRACAO_IMOBILIARIA'))) THEN
    RAISE EXCEPTION 'Tipo de evento inválido para esta reserva.' USING ERRCODE='22023';
  END IF;
  v_valor:=round(CASE WHEN p_payload ? 'valor' THEN (p_payload->>'valor')::numeric ELSE e.valor END,2);
  v_descricao:=btrim(coalesce(p_payload->>'descricao',e.descricao));
  v_detalhe:=CASE WHEN p_payload ? 'detalhe' THEN nullif(btrim(p_payload->>'detalhe'),'') ELSE e.detalhe END;
  v_competencia:=coalesce((nullif(p_payload->>'data','')::date+time '12:00') AT TIME ZONE 'America/Fortaleza',e.competencia_em);
  IF v_valor IS NULL OR v_valor::text IN ('NaN','Infinity','-Infinity') OR v_valor<=0
    OR nullif(v_descricao,'') IS NULL OR char_length(v_descricao)>200 OR char_length(v_detalhe)>2000 THEN
    RAISE EXCEPTION 'Informe o título e um valor positivo para o evento.' USING ERRCODE='22023';
  END IF;
  v_snapshot:=coalesce(e.dados_snapshot,'{}') || jsonb_build_object('ajuste_manual',true,'ajustado_em',clock_timestamp(),'ajustado_por',p_usuario,
    'data_ajustada',v_competencia IS DISTINCT FROM e.competencia_em OR coalesce((e.dados_snapshot->>'data_ajustada')::boolean,false));
  IF e.source_type='IMOVEL_TAXA' AND v_valor IS DISTINCT FROM e.valor THEN
    -- O bruto pago pelo hóspede não muda. Só a receita da administradora é corrigida.
    UPDATE public.transacao SET imovel_taxa_admin_ajustada=v_valor,updated_by=p_usuario,updated_at=clock_timestamp() WHERE id=t.id;
    SELECT dados_snapshot INTO v_snapshot FROM public.eventos_financeiros WHERE id=e.id;
    v_snapshot:=v_snapshot || jsonb_build_object('ajuste_manual',true,'ajustado_em',clock_timestamp(),'ajustado_por',p_usuario,
      'data_ajustada',v_competencia IS DISTINCT FROM e.competencia_em OR coalesce((e.dados_snapshot->>'data_ajustada')::boolean,false));
  ELSIF v_grupo IS NOT NULL AND v_valor IS DISTINCT FROM e.valor THEN
    PERFORM 1 FROM public.transacao WHERE lancamento_id=v_grupo AND NOT is_deleted ORDER BY id FOR UPDATE;
    SELECT sum(CASE WHEN tipo::text='DESPESA' THEN valor ELSE -valor END) INTO v_soma FROM public.transacao
      WHERE lancamento_id=v_grupo AND NOT is_deleted AND baixa_de_transacao_id IS NULL;
    v_novo_total:=v_soma+v_valor-e.valor;
    IF v_soma IS NULL OR v_novo_total<=0 THEN RAISE EXCEPTION 'Parcelas vinculadas inválidas.' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.transacao WHERE lancamento_id=v_grupo AND NOT is_deleted
      AND (NOT pendente OR baixa_de_transacao_id IS NOT NULL OR tipo::text<>'DESPESA'))
      OR EXISTS(SELECT 1 FROM public.transacao c JOIN public.transacao pai ON pai.id=c.baixa_de_transacao_id
        WHERE pai.lancamento_id=v_grupo AND NOT c.is_deleted)
      OR v_novo_total < (SELECT count(*)*.01 FROM public.transacao WHERE lancamento_id=v_grupo AND NOT is_deleted) THEN
      v_ajuste:=public.imob_criar_ajuste_financeiro_reserva(p_reserva_id,v_valor-e.valor,v_descricao,v_competencia,p_usuario,v_grupo,NULL);
    ELSE
      FOR t IN SELECT * FROM public.transacao WHERE lancamento_id=v_grupo AND NOT is_deleted AND baixa_de_transacao_id IS NULL ORDER BY id LOOP
        v_acumulado:=v_acumulado+t.valor;
        v_parcela:=round(v_acumulado*v_novo_total/v_soma,2)-v_anterior;
        v_anterior:=v_anterior+v_parcela;
        PERFORM public.imob_ajustar_transacao_reserva(t.id,v_parcela,p_usuario);
      END LOOP;
    END IF;
  ELSIF e.transacaoid IS NOT NULL AND v_valor IS DISTINCT FROM e.valor THEN
    PERFORM public.imob_ajustar_transacao_reserva(e.transacaoid,v_valor,p_usuario);
  END IF;
  UPDATE public.eventos_financeiros SET descricao=v_descricao,detalhe=v_detalhe,valor=v_valor,
    data_evento=v_competencia,competencia_em=v_competencia,dados_snapshot=v_snapshot,updated_at=clock_timestamp()
    WHERE id=e.id RETURNING * INTO e;
  PERFORM public.imob_classificar_evento_reserva(e.id,p_usuario);
  RETURN to_jsonb(e) || jsonb_build_object('ajuste_transacao_id',v_ajuste);
END $fn$;
REVOKE ALL ON FUNCTION public.imob_alterar_evento_reserva(bigint,bigint,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_alterar_evento_reserva(bigint,bigint,text,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.imob_editar_lancamento_reserva(p_reserva_id bigint,p_lancamento_id bigint,p_payload jsonb,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='5s' AS $fn$
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
  -- Estorna a versão anterior e registra a nova, preservando o histórico do extrato.
  IF ROW(l.valor,l.data,l.descricao) IS DISTINCT FROM ROW(v_valor,v_data,v_descricao) THEN
    INSERT INTO public.imovel_movimento(imovel_id,proprietario_id,lancamento_id,transacao_chave,tipo,valor,competencia_em,data_movimento,descricao,chave_unica,created_by)
    VALUES(l.imovel_id,l.proprietario_id,l.id,NULL,l.natureza,-l.valor,l.competencia_em,
      (l.data+time '12:00') AT TIME ZONE 'America/Fortaleza','Ajuste: '||l.descricao,gen_random_uuid()::text,p_actor),
      (l.imovel_id,l.proprietario_id,l.id,NULL,l.natureza,v_valor,v_data,
      (v_data+time '12:00') AT TIME ZONE 'America/Fortaleza',v_descricao,gen_random_uuid()::text,p_actor);
  END IF;
  UPDATE public.imovel_lancamento SET valor=v_valor,descricao=v_descricao,data=v_data,competencia_em=v_data,updated_at=clock_timestamp()
    WHERE id=l.id RETURNING * INTO l;
  RETURN to_jsonb(l) || jsonb_build_object('ajuste_transacao_id',v_ajuste);
END $fn$;
REVOKE ALL ON FUNCTION public.imob_editar_lancamento_reserva(bigint,bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_editar_lancamento_reserva(bigint,bigint,jsonb,uuid) TO service_role;

-- Transações de ajuste também impedem estorno ou novo vínculo do mesmo lançamento.
DO $patch$
DECLARE v_sql text;
BEGIN
  SELECT pg_get_functiondef('public.imob_cancelar_lancamento(bigint,uuid)'::regprocedure) INTO v_sql;
  IF strpos(v_sql,'imovel_lancamento_contabil_id')=0 THEN
    IF strpos(v_sql,'IF l.transacao_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.transacao WHERE id = l.transacao_id AND NOT is_deleted) THEN')=0 THEN
      RAISE EXCEPTION 'Guarda de estorno do lançamento contábil não encontrada.';
    END IF;
    EXECUTE replace(v_sql,
      'IF l.transacao_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.transacao WHERE id = l.transacao_id AND NOT is_deleted) THEN',
      'IF EXISTS (SELECT 1 FROM public.transacao WHERE (id = l.transacao_id OR imovel_lancamento_contabil_id=l.id) AND NOT is_deleted) THEN');
  END IF;
  SELECT pg_get_functiondef('public.imob_vincular_lancamento(bigint,bigint)'::regprocedure) INTO v_sql;
  IF strpos(v_sql,'imovel_lancamento_contabil_id')=0 THEN
    IF strpos(v_sql,'SELECT * INTO t FROM public.transacao WHERE id = p_transacao_id;')=0 THEN
      RAISE EXCEPTION 'Guarda de vínculo do lançamento contábil não encontrada.';
    END IF;
    EXECUTE replace(v_sql,'SELECT * INTO t FROM public.transacao WHERE id = p_transacao_id;',
      'IF EXISTS(SELECT 1 FROM public.transacao WHERE imovel_lancamento_contabil_id=l.id AND NOT is_deleted) THEN '
      || 'RAISE EXCEPTION ''Este lançamento possui ajustes ativos no financeiro.'' USING ERRCODE=''23505''; END IF; '
      || 'SELECT * INTO t FROM public.transacao WHERE id = p_transacao_id;');
  END IF;
END $patch$;

NOTIFY pgrst,'reload schema';
COMMIT;
