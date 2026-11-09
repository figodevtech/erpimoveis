-- Exclusão por item na aba de eventos da reserva. Mantém baixas e trilha de auditoria.
BEGIN;

-- Remove compromissos ainda em aberto. Dinheiro já pago fica no histórico e gera
-- um ajuste a receber/pagar, sem apagar a baixa nem alterar outros eventos do grupo.
CREATE OR REPLACE FUNCTION public.imob_excluir_vinculo_financeiro_reserva(
  p_reserva_id bigint,p_valor numeric,p_descricao text,p_usuario uuid,p_grupo bigint,p_conta bigint
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='5s' AS $fn$
DECLARE
  v_ids bigint[];
  v_total numeric;
  v_alvo numeric;
  v_acumulado numeric:=0;
  v_distribuido numeric:=0;
  v_novo numeric;
  v_liquido numeric;
  v_id bigint;
  t public.transacao%ROWTYPE;
BEGIN
  IF (p_grupo IS NULL)=(p_conta IS NULL) THEN RAISE EXCEPTION 'Vínculo financeiro inválido.' USING ERRCODE='22023'; END IF;
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM public.transacao WHERE NOT is_deleted AND baixa_de_transacao_id IS NULL
    AND (lancamento_id=p_grupo OR imovel_lancamento_contabil_id=p_conta
      OR id=(SELECT transacao_id FROM public.imovel_lancamento WHERE id=p_conta));
  IF coalesce(cardinality(v_ids),0)=0 THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.transacao WHERE (id=ANY(v_ids) OR baixa_de_transacao_id=ANY(v_ids)) AND NOT is_deleted ORDER BY id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN tipo::text='DESPESA' THEN valor ELSE -valor END),0) INTO v_total
    FROM public.transacao WHERE id=ANY(v_ids) AND NOT is_deleted;
  v_alvo:=CASE WHEN p_conta IS NOT NULL THEN 0 ELSE round(v_total-p_valor,2) END;
  IF NOT EXISTS(SELECT 1 FROM public.transacao WHERE NOT is_deleted AND
    ((id=ANY(v_ids) AND (NOT pendente OR tipo::text<>'DESPESA')) OR baixa_de_transacao_id=ANY(v_ids)))
    AND v_alvo>=0 AND v_total>0 THEN
    FOR t IN SELECT * FROM public.transacao WHERE id=ANY(v_ids) AND NOT is_deleted ORDER BY id LOOP
      v_acumulado:=v_acumulado+t.valor;
      v_novo:=round(v_acumulado*v_alvo/v_total,2)-v_distribuido;
      v_distribuido:=v_distribuido+v_novo;
      IF v_novo=0 THEN
        UPDATE public.transacao SET is_deleted=true,updated_by=p_usuario,updated_at=clock_timestamp() WHERE id=t.id;
      ELSE
        v_liquido:=greatest(.01,round(coalesce(nullif(t."valorLiquido",0),t.valor)*v_novo/t.valor,2));
        PERFORM public.ajustar_valores_transacao(jsonb_build_array(jsonb_build_object(
          'id',t.id,'valor',v_novo,'valorLiquido',v_liquido,
          'valorAnterior',t.valor,'valorLiquidoAnterior',coalesce(nullif(t."valorLiquido",0),t.valor))),p_usuario,'Exclusão de lançamento da reserva');
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;
  IF v_alvo=v_total THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.transacao WHERE id=ANY(v_ids) AND NOT is_deleted ORDER BY id LIMIT 1;
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,vencimento_em,competencia_em,tipo,pendente,
    lancamento_id,imovel_lancamento_contabil_id,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador,fornecedor_id)
  VALUES('Ajuste de exclusão: '||p_descricao||' · Reserva #'||p_reserva_id,abs(v_alvo-v_total),abs(v_alvo-v_total),now(),now(),now(),
    CASE WHEN v_alvo>v_total THEN 'DESPESA'::public.tipos_transacao ELSE 'RECEITA'::public.tipos_transacao END,
    true,p_grupo,p_conta,p_conta IS NOT NULL,p_usuario,t.nomepagador,t.cpfcnpjpagador,t.fornecedor_id)
    RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.imob_excluir_vinculo_financeiro_reserva(bigint,numeric,text,uuid,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_excluir_vinculo_financeiro_reserva(bigint,numeric,text,uuid,bigint,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.imob_excluir_evento_reserva(p_reserva_id bigint,p_evento_id bigint,p_payload jsonb,p_usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='5s' AS $fn$
DECLARE
  e public.eventos_financeiros%ROWTYPE;
  t public.transacao%ROWTYPE;
  v_grupo bigint;
  v_ajuste bigint;
BEGIN
  IF public.imob_definir_ator(p_usuario) IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.eventos_financeiros WHERE id=p_evento_id;
  IF NOT FOUND OR ((e.source_type='RESERVA' AND e.source_id=p_reserva_id)
    OR (e.source_type='IMOVEL_TAXA' AND (e.dados_snapshot->>'reserva_id')::bigint=p_reserva_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'Lançamento não encontrado nesta reserva.' USING ERRCODE='P0002';
  END IF;
  IF e.status='CANCELADO' THEN RETURN jsonb_build_object('evento_id',e.id,'excluido',true); END IF;
  IF e.source_type='IMOVEL_TAXA' THEN
    SELECT * INTO t FROM public.transacao WHERE id=e.source_id AND reserva_imovel_id=p_reserva_id AND NOT is_deleted FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento deste evento não encontrado.' USING ERRCODE='P0002'; END IF;
  END IF;
  v_grupo:=e.lancamento_id;
  IF v_grupo IS NOT NULL THEN PERFORM 1 FROM public.lancamento_de_eventos WHERE id=v_grupo FOR UPDATE; END IF;
  SELECT * INTO e FROM public.eventos_financeiros WHERE id=p_evento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado nesta reserva.' USING ERRCODE='P0002'; END IF;
  IF e.status='CANCELADO' THEN RETURN jsonb_build_object('evento_id',e.id,'excluido',true); END IF;
  IF e.lancamento_id IS DISTINCT FROM v_grupo OR (p_payload ? 'atualizado_em' AND e.updated_at IS DISTINCT FROM (p_payload->>'atualizado_em')::timestamptz) THEN
    RAISE EXCEPTION 'O lançamento mudou. Atualize a lista.' USING ERRCODE='40001';
  END IF;
  IF (e.lancamento_id IS NOT NULL OR e.transacaoid IS NOT NULL) AND (p_payload->>'pode_excluir_financeiro') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Você não tem permissão para excluir lançamentos vinculados ao financeiro.' USING ERRCODE='42501';
  END IF;
  IF e.source_type='IMOVEL_TAXA' THEN
    -- Zera somente a taxa deste recebimento. O gatilho corrige DRE e extrato e não
    -- recria a taxa excluída ao sincronizar novamente o mesmo pagamento.
    UPDATE public.transacao SET imovel_taxa_admin_ajustada=0,updated_by=p_usuario,updated_at=clock_timestamp() WHERE id=t.id;
  ELSIF e.origem='CONSUMO' THEN
    PERFORM public.imob_cancelar_consumo_reserva(p_reserva_id,e.id,'Exclusão do lançamento da reserva',p_usuario);
  ELSIF e.origem='DESPESA_RESERVA' THEN
    IF v_grupo IS NOT NULL THEN
      v_ajuste:=public.imob_excluir_vinculo_financeiro_reserva(p_reserva_id,e.valor,e.descricao,p_usuario,v_grupo,NULL);
    ELSIF e.transacaoid IS NOT NULL THEN
      RAISE EXCEPTION 'Vínculo financeiro individual não suportado para este custo.' USING ERRCODE='22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de lançamento inválido para esta reserva.' USING ERRCODE='22023';
  END IF;
  UPDATE public.eventos_financeiros SET status='CANCELADO',updated_at=clock_timestamp(),
    dados_snapshot=coalesce(dados_snapshot,'{}')||jsonb_build_object('excluido_manualmente',true,'excluido_em',clock_timestamp(),'excluido_por',p_usuario)
    WHERE id=e.id;
  RETURN jsonb_build_object('evento_id',e.id,'excluido',true,'ajuste_transacao_id',v_ajuste);
END $fn$;
REVOKE ALL ON FUNCTION public.imob_excluir_evento_reserva(bigint,bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_excluir_evento_reserva(bigint,bigint,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.imob_excluir_lancamento_reserva(p_reserva_id bigint,p_lancamento_id bigint,p_payload jsonb,p_usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp SET lock_timeout='5s' AS $fn$
DECLARE
  l public.imovel_lancamento%ROWTYPE;
  v_ajuste bigint;
  v_saldo numeric;
BEGIN
  IF public.imob_definir_ator(p_usuario) IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE='42501'; END IF;
  SELECT * INTO l FROM public.imovel_lancamento WHERE id=p_lancamento_id AND reserva_id=p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado nesta reserva.' USING ERRCODE='P0002'; END IF;
  IF l.cancelado_em IS NOT NULL THEN RETURN jsonb_build_object('lancamento_id',l.id,'excluido',true); END IF;
  IF p_payload ? 'atualizado_em' AND l.updated_at IS DISTINCT FROM (p_payload->>'atualizado_em')::timestamptz THEN
    RAISE EXCEPTION 'O lançamento mudou. Atualize a lista.' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.transacao WHERE NOT is_deleted AND (id=l.transacao_id OR imovel_lancamento_contabil_id=l.id) ORDER BY id FOR UPDATE;
  IF FOUND THEN
    IF (p_payload->>'pode_excluir_financeiro') IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Você não tem permissão para excluir lançamentos vinculados ao financeiro.' USING ERRCODE='42501';
    END IF;
    v_ajuste:=public.imob_excluir_vinculo_financeiro_reserva(p_reserva_id,l.valor,l.descricao,p_usuario,NULL,l.id);
  END IF;
  SELECT coalesce(sum(valor),0) INTO v_saldo FROM public.imovel_movimento WHERE lancamento_id=l.id;
  IF v_saldo<>0 THEN
    INSERT INTO public.imovel_movimento(imovel_id,proprietario_id,lancamento_id,transacao_chave,tipo,valor,competencia_em,data_movimento,descricao,chave_unica,created_by)
    VALUES(l.imovel_id,l.proprietario_id,l.id,NULL,l.natureza,-v_saldo,l.competencia_em,clock_timestamp(),
      'Exclusão: '||l.descricao,gen_random_uuid()::text,p_usuario);
  END IF;
  UPDATE public.imovel_lancamento SET cancelado_em=clock_timestamp(),cancelado_por=p_usuario,updated_at=clock_timestamp() WHERE id=l.id;
  RETURN jsonb_build_object('lancamento_id',l.id,'excluido',true,'ajuste_transacao_id',v_ajuste);
END $fn$;
REVOKE ALL ON FUNCTION public.imob_excluir_lancamento_reserva(bigint,bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_excluir_lancamento_reserva(bigint,bigint,jsonb,uuid) TO service_role;

-- Desfazer depois o grupo financeiro não pode trazer um item excluído de volta à DRE.
DO $patch$
DECLARE v_sql text;
BEGIN
  SELECT pg_get_functiondef('public.excluir_lancamento_de_eventos(bigint,uuid)'::regprocedure) INTO v_sql;
  IF strpos(v_sql,'excluido_manualmente')=0 THEN
    IF strpos(v_sql,'SET status = ''ATIVO'', lancamento_id = NULL')=0 THEN
      RAISE EXCEPTION 'Ponto de restauração dos eventos financeiros não encontrado.';
    END IF;
    EXECUTE replace(v_sql,'SET status = ''ATIVO'', lancamento_id = NULL',
      'SET status = CASE WHEN dados_snapshot->>''excluido_manualmente''=''true'' THEN ''CANCELADO'' ELSE ''ATIVO'' END, lancamento_id = NULL');
  END IF;
END $patch$;

NOTIFY pgrst,'reload schema';
COMMIT;
