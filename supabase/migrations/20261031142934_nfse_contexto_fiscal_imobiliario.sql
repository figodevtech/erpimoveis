-- CGSN 191/2026: /v2/nfsen também atende autorizador municipal próprio.
-- Snapshot somente de emissões novas; não inferir destino de XML histórico.
begin;
alter table public.nfse add column if not exists autorizador_emissao text;
alter table public.nfse add column if not exists data_competencia date;
do $$ begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.nfse'::regclass and conname = 'nfse_autorizador_emissao_check') then
    alter table public.nfse add constraint nfse_autorizador_emissao_check
      check (autorizador_emissao in ('FOCUS_MUNICIPAL', 'FOCUS_NACIONAL', 'FOCUS_FORMATO_NACIONAL_MUNICIPAL')) not valid;
  end if;
end $$;
alter table public.nfse validate constraint nfse_autorizador_emissao_check;
comment on column public.nfse.autorizador_emissao is
  'Destino escolhido na emissão; null em registros históricos cujo modelo NACIONAL não distingue Sefin de município.';
comment on column public.nfse.data_competencia is
  'Competência preservada entre tentativas de emissão; sem backfill de documentos históricos.';

-- A reserva imobiliária grava o mesmo snapshot. Os parâmetros novos têm default:
-- o código anterior continua chamando a função até o deploy.
DROP FUNCTION IF EXISTS public.imob_reservar_nfse(bigint[],bigint[],integer,jsonb,text,text,uuid,boolean);
CREATE OR REPLACE FUNCTION public.imob_reservar_nfse(p_movimento_ids bigint[],p_transacao_ids bigint[],p_empresa_id integer,p_payload jsonb,p_modelo text,p_referencia text,p_actor uuid,p_reemitir boolean DEFAULT false,p_autorizador text DEFAULT NULL,p_data_competencia date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid; v_prop bigint; v_props integer; v_count integer; v_n integer; v_existing bigint; v_existing_count integer; v_ids bigint[]:=coalesce(p_movimento_ids,'{}'); v_txids bigint[]:=coalesce(p_transacao_ids,'{}'); v_total numeric; v_informado numeric; v_doc text; v_nfse public.nfse%ROWTYPE; v_itens jsonb;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor); IF v_actor IS NULL THEN RAISE EXCEPTION 'Emissão exige operador ERP.' USING ERRCODE='42501'; END IF;
 v_n:=cardinality(v_ids)+cardinality(v_txids);
 IF v_n=0 OR v_n>200 OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x)<>cardinality(v_ids) OR (SELECT count(DISTINCT x) FROM unnest(v_txids) x)<>cardinality(v_txids) THEN RAISE EXCEPTION 'Selecione fontes administrativas distintas.'; END IF;
 PERFORM 1 FROM public.imovel_movimento WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.transacao WHERE id=ANY(v_txids) ORDER BY id FOR UPDATE;
 SELECT count(*),count(DISTINCT nfse_id),min(nfse_id) INTO v_count,v_existing_count,v_existing FROM public.imovel_nfse_origem WHERE movimento_id=ANY(v_ids) OR transacao_id=ANY(v_txids);
 IF v_count>0 THEN
  IF v_existing_count<>1 OR v_count<>v_n THEN RAISE EXCEPTION 'Seleção mistura fontes já faturadas e novas; consulte a nota existente.'; END IF;
  SELECT * INTO v_nfse FROM public.nfse WHERE id=v_existing FOR UPDATE;
  IF v_nfse.empresaid<>p_empresa_id THEN RAISE EXCEPTION 'Fontes já vinculadas a outra empresa emissora.'; END IF;
  IF NOT p_reemitir THEN RETURN jsonb_build_object('id',v_nfse.id,'referencia',v_nfse.referencia,'already_exists',true,'status',v_nfse.status,'valor_total',v_nfse.valor_total,'proprietario_id',(SELECT proprietario_id FROM public.imovel_nfse_origem WHERE nfse_id=v_existing LIMIT 1)); END IF;
  IF upper(v_nfse.status)<>'REJEITADA' OR nullif(v_nfse.numero,'') IS NOT NULL OR nullif(v_nfse.protocolo,'') IS NOT NULL OR nullif(v_nfse.url_xml,'') IS NOT NULL THEN RAISE EXCEPTION 'Nova tentativa exige rejeição confirmada sem documento autorizado.'; END IF;
  IF (SELECT count(*) FROM public.imovel_nfse_origem WHERE nfse_id=v_existing)<>v_n THEN RAISE EXCEPTION 'Nova tentativa deve conservar todas as fontes originais.'; END IF;
  -- Uma competência já gravada não muda entre tentativas.
  IF v_nfse.data_competencia IS NOT NULL AND p_data_competencia IS DISTINCT FROM v_nfse.data_competencia THEN RAISE EXCEPTION 'Nova tentativa deve conservar a competência original da NFS-e.'; END IF;
 ELSIF p_reemitir THEN RAISE EXCEPTION 'Não existe nota rejeitada para essas fontes.';
 END IF;
 IF (SELECT count(*) FROM public.imovel_movimento WHERE id=ANY(v_ids) AND tipo='TAXA_ADMIN' AND valor>0 AND (nfse_id IS NULL OR nfse_id=v_existing))<>cardinality(v_ids) THEN RAISE EXCEPTION 'Somente taxas administrativas positivas e recebidas podem ser faturadas.'; END IF;
 IF (SELECT count(*) FROM public.transacao WHERE id=ANY(v_txids) AND imovel_natureza='COMISSAO' AND NOT is_deleted AND NOT pendente AND NOT abonado AND (imovel_nfse_id IS NULL OR imovel_nfse_id=v_existing))<>cardinality(v_txids) THEN RAISE EXCEPTION 'Somente comissões de venda recebidas podem ser faturadas.'; END IF;
 IF EXISTS(SELECT 1 FROM public.imovel_movimento m WHERE m.id=ANY(v_ids) GROUP BY m.transacao_chave HAVING sum(m.valor)>(SELECT coalesce(sum(x.valor),0) FROM public.imovel_movimento x WHERE x.transacao_chave=m.transacao_chave AND x.tipo='TAXA_ADMIN')) THEN RAISE EXCEPTION 'Taxa foi estornada; selecione apenas valores efetivamente recebidos.'; END IF;
 SELECT count(DISTINCT proprietario_id),min(proprietario_id),round(sum(valor),2),jsonb_agg(item) INTO v_props,v_prop,v_total,v_itens FROM (
  SELECT m.proprietario_id,m.valor,jsonb_build_object('tipo','TAXA_ADMIN','movimento_id',m.id,'imovel_id',m.imovel_id,'valor',m.valor) AS item FROM public.imovel_movimento m WHERE m.id=ANY(v_ids)
  UNION ALL SELECT t.proprietario_id,coalesce(nullif(t."valorLiquido",0),t.valor),jsonb_build_object('tipo','COMISSAO','transacao_id',t.id,'imovel_id',t.imovel_id,'valor',coalesce(nullif(t."valorLiquido",0),t.valor)) FROM public.transacao t WHERE t.id=ANY(v_txids)
 ) z;
 IF v_props<>1 THEN RAISE EXCEPTION 'Uma NFS-e deve ter um único proprietário tomador.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.empresa WHERE id=p_empresa_id) THEN RAISE EXCEPTION 'Empresa emissora não encontrada.'; END IF;
 SELECT cpfcnpj INTO v_doc FROM public.proprietario WHERE id=v_prop FOR UPDATE;
 IF coalesce(p_payload->>'cpf_tomador',p_payload->>'cnpj_tomador',p_payload->'tomador'->>'cpf',p_payload->'tomador'->>'cnpj','')<>v_doc THEN RAISE EXCEPTION 'Tomador da NFS-e deve corresponder ao proprietário das fontes.'; END IF;
 v_informado:=coalesce((p_payload->>'valor_servico')::numeric,(p_payload->'servico'->>'valor_servicos')::numeric);
 IF v_informado IS NULL OR round(v_informado,2)<>v_total OR v_total<=0 THEN RAISE EXCEPTION 'Valor fiscal diverge das receitas administrativas selecionadas.'; END IF;
 IF nullif(p_referencia,'') IS NULL THEN RAISE EXCEPTION 'Referência fiscal obrigatória.'; END IF;
 IF v_existing IS NULL THEN
  INSERT INTO public.nfse(empresaid,clienteid,status,referencia,valor_total,modelo_emissao,autorizador_emissao,data_competencia,servico_ids,itens,payload_enviado)
  VALUES(p_empresa_id,NULL,'PROCESSANDO',p_referencia,v_total,p_modelo,p_autorizador,p_data_competencia,ARRAY[]::integer[],v_itens,p_payload) RETURNING * INTO v_nfse;
  INSERT INTO public.imovel_nfse_origem(nfse_id,movimento_id,proprietario_id,imovel_id,valor,created_by) SELECT v_nfse.id,id,proprietario_id,imovel_id,valor,v_actor FROM public.imovel_movimento WHERE id=ANY(v_ids);
  INSERT INTO public.imovel_nfse_origem(nfse_id,transacao_id,proprietario_id,imovel_id,valor,created_by) SELECT v_nfse.id,id,proprietario_id,imovel_id,coalesce(nullif("valorLiquido",0),valor),v_actor FROM public.transacao WHERE id=ANY(v_txids);
 ELSE
  UPDATE public.nfse SET tentativas=tentativas||jsonb_build_array(jsonb_build_object('data',clock_timestamp(),'referencia',referencia,'status',status,'payload',payload_enviado,'erros',erros)),status='PROCESSANDO',referencia=p_referencia,valor_total=v_total,modelo_emissao=p_modelo,autorizador_emissao=coalesce(p_autorizador,autorizador_emissao),data_competencia=coalesce(data_competencia,p_data_competencia),itens=v_itens,payload_enviado=p_payload,erros=NULL,updatedat=now() WHERE id=v_existing RETURNING * INTO v_nfse;
 END IF;
 UPDATE public.imovel_movimento SET nfse_id=v_nfse.id WHERE id=ANY(v_ids);
 UPDATE public.transacao SET imovel_nfse_id=v_nfse.id WHERE id=ANY(v_txids);
 RETURN jsonb_build_object('id',v_nfse.id,'referencia',v_nfse.referencia,'already_exists',false,'status',v_nfse.status,'valor_total',v_total,'proprietario_id',v_prop);
END $$;
REVOKE ALL ON FUNCTION public.imob_reservar_nfse(bigint[],bigint[],integer,jsonb,text,text,uuid,boolean,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_reservar_nfse(bigint[],bigint[],integer,jsonb,text,text,uuid,boolean,text,date) TO service_role;
commit;
-- Rollback de estrutura (arquivar antes os snapshots criados após o deploy):
-- recriar imob_reservar_nfse com a assinatura de 20261029173114_dominio_imobiliario.sql;
-- alter table public.nfse drop constraint if exists nfse_autorizador_emissao_check;
-- alter table public.nfse drop column if exists autorizador_emissao;
-- alter table public.nfse drop column if exists data_competencia;
