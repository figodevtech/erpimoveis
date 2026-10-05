BEGIN;

ALTER TABLE public.venda_comissao ADD COLUMN IF NOT EXISTS valor_comissao_manual numeric(14,2)
  CHECK (valor_comissao_manual >= 0);
COMMENT ON COLUMN public.venda_comissao.valor_comissao_manual IS
  'Valor corrigido no evento financeiro. Preservado para o mesmo beneficiario; transferir a venda reapura para o novo vendedor.';

CREATE OR REPLACE FUNCTION public.tg_espelhar_comissao_ajustada_venda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE public.venda_comissao SET valor_comissao_manual = new.valor,
    valor_comissao = new.valor, updated_at = now()
    WHERE vendaid = new.source_id AND integrada AND usuarioid IS NOT DISTINCT FROM new.usuarioid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A comissao nao possui apuracao integrada para este beneficiario.' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_espelhar_comissao_ajustada_venda() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS espelhar_comissao_ajustada_venda ON public.eventos_financeiros;
CREATE TRIGGER espelhar_comissao_ajustada_venda AFTER INSERT OR UPDATE OF valor, is_manual ON public.eventos_financeiros
FOR EACH ROW WHEN (new.source_type = 'VENDA' AND new.ordemservicoid IS NULL
  AND new.origem = 'COMISSAO' AND new.chave_origem = 'COMISSAO_VENDA' AND new.is_manual)
EXECUTE FUNCTION public.tg_espelhar_comissao_ajustada_venda();

-- Receitas automaticas continuam automaticas. Sua intervencao explicita precisa
-- de auditoria tambem, sem duplicar o gatilho que ja audita eventos is_manual.
DROP TRIGGER IF EXISTS auditoria_snapshot_venda ON public.eventos_financeiros;
CREATE TRIGGER auditoria_snapshot_venda AFTER UPDATE ON public.eventos_financeiros
FOR EACH ROW WHEN (new.source_type = 'VENDA' AND NOT old.is_manual AND NOT new.is_manual
  AND new.dados_snapshot->>'ajuste_manual' = 'true'
  AND (old.valor IS DISTINCT FROM new.valor OR old.dados_snapshot IS DISTINCT FROM new.dados_snapshot))
EXECUTE FUNCTION public.registrar_auditoria();

CREATE OR REPLACE FUNCTION public.editar_evento_financeiro_venda(
  p_venda_id bigint, p_evento_id bigint, p_payload jsonb, p_usuario uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_evento public.eventos_financeiros%ROWTYPE;
  v_manual boolean;
  v_comissao boolean;
  v_valor numeric;
  v_descricao text;
  v_detalhe text;
  v_snapshot jsonb;
BEGIN
  IF p_usuario IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Informe os dados do evento financeiro e o autor.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.venda WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_evento FROM public.eventos_financeiros
    WHERE id = p_evento_id AND source_type = 'VENDA' AND source_id = p_venda_id
      AND ordemservicoid IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento financeiro nao encontrado nesta venda.' USING ERRCODE = 'P0002'; END IF;
  IF v_evento.status = 'CONVERTIDO' OR v_evento.transacaoid IS NOT NULL OR v_evento.lancamento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Exclua primeiro a transacao ou o lancamento financeiro vinculado.' USING ERRCODE = 'P0001';
  END IF;
  IF v_evento.status <> 'ATIVO' THEN
    RAISE EXCEPTION 'Somente eventos ativos podem ser alterados.' USING ERRCODE = 'P0001';
  END IF;
  v_manual := coalesce(v_evento.is_manual,false) AND coalesce(v_evento.chave_origem,'') LIKE 'MANUAL:%';
  v_comissao := coalesce(v_evento.origem = 'COMISSAO' AND v_evento.natureza = 'DESPESA' AND v_evento.chave_origem = 'COMISSAO_VENDA',false);
  IF v_evento.consumo_saida_id IS NOT NULL OR v_evento.consumo_usoconsumo_saida_id IS NOT NULL
    OR NOT (v_manual AND v_evento.origem <> 'COMISSAO' AND NOT (v_evento.origem = 'FRETE' AND v_evento.natureza = 'RECEITA')
      OR v_evento.natureza = 'RECEITA' AND v_evento.origem = 'PRODUTO'
      OR v_evento.natureza = 'RECEITA' AND v_evento.origem = 'FRETE' AND v_evento.chave_origem = 'FRETE'
      OR v_comissao) THEN
    RAISE EXCEPTION 'Este evento deve ser corrigido na origem que o criou.' USING ERRCODE = 'P0001';
  END IF;
  IF v_comissao THEN
    PERFORM 1 FROM public.venda_comissao WHERE vendaid = p_venda_id AND integrada
      AND usuarioid IS NOT DISTINCT FROM v_evento.usuarioid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Comissao integrada nao encontrada para este beneficiario.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  v_valor := (p_payload->>'valor')::numeric;
  v_descricao := CASE WHEN v_manual AND NOT v_comissao THEN btrim(coalesce(p_payload->>'descricao',v_evento.descricao)) ELSE v_evento.descricao END;
  v_detalhe := CASE WHEN v_manual AND NOT v_comissao AND p_payload ? 'detalhe'
    THEN nullif(btrim(p_payload->>'detalhe'),'') ELSE v_evento.detalhe END;
  IF v_valor IS NULL OR v_valor::text IN ('NaN','Infinity','-Infinity') OR v_valor < 0
    OR nullif(v_descricao,'') IS NULL THEN
    RAISE EXCEPTION 'Informe titulo e valor valido, igual ou maior que zero.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.audit_user_id',p_usuario::text,true);
  v_snapshot := coalesce(v_evento.dados_snapshot,'{}'::jsonb)
    || jsonb_build_object('ajuste_manual',true,'ajustado_em',clock_timestamp(),'ajustado_por',p_usuario);
  IF v_comissao THEN
    v_snapshot := v_snapshot || jsonb_build_object('comissao_ajustada_a_mao',true,
      'valor_automatico',coalesce(v_evento.dados_snapshot->'valor_automatico',to_jsonb(v_evento.valor)),
      'valor_comissao',round(v_valor,2));
  END IF;
  UPDATE public.eventos_financeiros SET descricao = v_descricao, detalhe = v_detalhe,
    valor = round(v_valor,2), is_manual = v_evento.is_manual OR v_comissao,
    pode_gerar_transacao = CASE WHEN v_comissao THEN round(v_valor,2) > 0 AND usuarioid IS NOT NULL ELSE pode_gerar_transacao END,
    updated_at = now(), dados_snapshot = v_snapshot WHERE id = v_evento.id RETURNING * INTO v_evento;
  RETURN to_jsonb(v_evento);
END;
$fn$;
REVOKE ALL ON FUNCTION public.editar_evento_financeiro_venda(bigint,bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.editar_evento_financeiro_venda(bigint,bigint,jsonb,uuid) TO service_role;

-- Apuracao e evento usam o mesmo valor efetivo. Base e percentual ainda explicam
-- o calculo teorico; trocar o beneficiario descarta a correcao anterior.
CREATE OR REPLACE FUNCTION public.reconciliar_comissao_venda(p_vendaid bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_venda public.venda%ROWTYPE;
  v_snapshot public.venda_comissao%ROWTYPE;
  v_evento public.eventos_financeiros%ROWTYPE;
  v_usuario uuid; v_pct numeric; v_base numeric; v_valor numeric;
  v_manual numeric; v_calculado numeric; v_frete_itens numeric;
  v_reconhecida boolean; v_nome text;
BEGIN
  SELECT * INTO v_venda FROM public.venda WHERE id = p_vendaid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_snapshot FROM public.venda_comissao WHERE vendaid = p_vendaid FOR UPDATE;
  IF FOUND AND NOT v_snapshot.integrada THEN RETURN; END IF;
  v_reconhecida := public.venda_reconhece_receita(v_venda.status::text);
  v_usuario := coalesce(v_venda.vendedor,v_venda.created_by);
  IF v_reconhecida AND v_snapshot.congelada_em IS NOT NULL AND v_usuario IS NOT DISTINCT FROM v_snapshot.usuarioid THEN
    v_pct := v_snapshot.percentual;
  ELSE
    SELECT coalesce(comissao_venda_percent,0) INTO v_pct FROM public.usuario WHERE id = v_usuario;
  END IF;
  v_pct := coalesce(v_pct,0);
  SELECT coalesce(sum(valor_frete),0) INTO v_frete_itens FROM public.vendaproduto WHERE venda_id = p_vendaid;
  v_base := round(greatest(coalesce(v_venda.valortotal,0)-coalesce(v_venda.valor_frete,0)-v_frete_itens,0),2);
  v_calculado := round(v_base*v_pct/100,2);
  SELECT * INTO v_evento FROM public.eventos_financeiros
    WHERE source_type = 'VENDA' AND source_id = p_vendaid AND origem = 'COMISSAO' AND chave_origem = 'COMISSAO_VENDA' FOR UPDATE;
  -- Ajustes anteriores sao reconhecidos quando a venda for recalculada, sem
  -- backfill nem reescrita de historico durante a aplicacao desta migration.
  v_manual := CASE WHEN v_usuario IS NOT DISTINCT FROM v_snapshot.usuarioid THEN
    coalesce(v_snapshot.valor_comissao_manual,CASE WHEN v_evento.is_manual AND v_evento.usuarioid IS NOT DISTINCT FROM v_usuario THEN v_evento.valor END) END;
  v_valor := coalesce(v_manual,v_calculado);
  PERFORM 1 FROM public.eventos_financeiros WHERE source_type = 'VENDA' AND source_id = p_vendaid AND origem = 'COMISSAO' FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.eventos_financeiros e
    WHERE e.source_type = 'VENDA' AND e.source_id = p_vendaid AND e.origem = 'COMISSAO'
      AND (e.status = 'CONVERTIDO' OR e.transacaoid IS NOT NULL OR e.lancamento_id IS NOT NULL)
      AND (NOT v_reconhecida OR e.valor IS DISTINCT FROM v_valor OR e.usuarioid IS DISTINCT FROM v_usuario)) THEN
    RAISE EXCEPTION 'Desfaca o lancamento financeiro da comissao antes de alterar ou cancelar esta venda.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.venda_comissao(vendaid,usuarioid,base,percentual,valor_comissao,valor_comissao_manual,congelada_em)
    VALUES(p_vendaid,v_usuario,v_base,v_pct,v_valor,v_manual,
      CASE WHEN v_reconhecida THEN coalesce(v_snapshot.congelada_em,v_venda.pagamento_em,now()) END)
    ON CONFLICT(vendaid) DO UPDATE SET usuarioid = excluded.usuarioid,base = excluded.base,
      percentual = excluded.percentual,valor_comissao = excluded.valor_comissao,
      valor_comissao_manual = excluded.valor_comissao_manual,congelada_em = excluded.congelada_em,updated_at = now();
  IF NOT v_reconhecida THEN
    UPDATE public.eventos_financeiros SET status = 'CANCELADO',updated_at = now()
      WHERE source_type = 'VENDA' AND source_id = p_vendaid AND origem = 'COMISSAO' AND status = 'ATIVO';
    RETURN;
  END IF;
  SELECT coalesce(nullif(nome,''),'Vendedor') INTO v_nome FROM public.usuario WHERE id = v_usuario;
  INSERT INTO public.eventos_financeiros
    (source_type,source_id,origem,natureza,natureza_dre,chave_origem,descricao,detalhe,valor,usuarioid,
     valor_base_snapshot,percentual_snapshot,competencia_em,dados_snapshot,pode_gerar_transacao,is_manual)
    VALUES('VENDA',p_vendaid,'COMISSAO','DESPESA',public.natureza_dre_de_evento('COMISSAO','DESPESA'),
      'COMISSAO_VENDA','Comissão da venda #'||p_vendaid||' - '||coalesce(v_nome,'Sem vendedor'),
      'Base líquida sem frete: R$ '||v_base||' × '||v_pct||'%',v_valor,v_usuario,v_base,v_pct,
      coalesce(v_venda.datavenda,v_venda.createdat,now()),
      jsonb_build_object('vendaid',p_vendaid,'usuarioid',v_usuario,'base',v_base,'percentual',v_pct,'valor_comissao',v_valor)
        || CASE WHEN v_manual IS NOT NULL THEN jsonb_build_object('comissao_ajustada_a_mao',true,'valor_calculado',v_calculado) ELSE '{}'::jsonb END,
      v_valor > 0 AND v_usuario IS NOT NULL,v_manual IS NOT NULL)
    ON CONFLICT(source_type,source_id,origem,chave_origem,natureza) WHERE ordemservicoid IS NULL
    DO UPDATE SET valor = excluded.valor,usuarioid = excluded.usuarioid,descricao = excluded.descricao,
      detalhe = excluded.detalhe,valor_base_snapshot = excluded.valor_base_snapshot,
      percentual_snapshot = excluded.percentual_snapshot,competencia_em = excluded.competencia_em,
      dados_snapshot = CASE WHEN excluded.is_manual THEN coalesce(eventos_financeiros.dados_snapshot,'{}'::jsonb) || excluded.dados_snapshot ELSE excluded.dados_snapshot END,
      pode_gerar_transacao = excluded.pode_gerar_transacao,is_manual = excluded.is_manual,status = 'ATIVO',updated_at = now()
    WHERE eventos_financeiros.status <> 'CONVERTIDO' AND eventos_financeiros.transacaoid IS NULL AND eventos_financeiros.lancamento_id IS NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reconciliar_comissao_venda(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_comissao_venda(bigint) TO service_role;

COMMIT;
