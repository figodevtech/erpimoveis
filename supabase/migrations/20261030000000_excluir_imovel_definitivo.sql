-- Exclusão de imóvel decidida no próprio ato: sem reserva, locação, venda nem lançamento
-- financeiro, o imóvel some de vez com o que é só dele (fotos, anexos, tarifas, agenda,
-- cotações e visitas). Com qualquer um desses vínculos, ele é inativado e sai do site.
CREATE OR REPLACE FUNCTION public.imob_excluir_imovel(p_id bigint,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_vinculos text[]:='{}'; v_arquivos jsonb;
BEGIN
 PERFORM public.imob_definir_ator(p_actor);
 -- A trava faz uma reserva, locação ou venda criada ao mesmo tempo esperar por esta decisão:
 -- se o imóvel for apagado, ela falha pela chave estrangeira; se chegar antes, é vista abaixo.
 PERFORM 1 FROM public.imovel WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Imóvel não encontrado.' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM public.reserva_imovel WHERE imovel_id=p_id) THEN v_vinculos:=v_vinculos||'reservas'::text; END IF;
 IF EXISTS(SELECT 1 FROM public.locacao_imovel WHERE imovel_id=p_id) THEN v_vinculos:=v_vinculos||'locações'::text; END IF;
 IF EXISTS(SELECT 1 FROM public.venda_imovel WHERE imovel_id=p_id) THEN v_vinculos:=v_vinculos||'vendas'::text; END IF;
 -- Lançamento avulso (despesa, repasse) também é histórico contábil e não pode sumir.
 IF EXISTS(SELECT 1 FROM public.transacao WHERE imovel_id=p_id)
  OR EXISTS(SELECT 1 FROM public.imovel_movimento WHERE imovel_id=p_id)
  OR EXISTS(SELECT 1 FROM public.imovel_nfse_origem WHERE imovel_id=p_id)
 THEN v_vinculos:=v_vinculos||'lançamentos financeiros'::text; END IF;

 IF cardinality(v_vinculos)>0 THEN
  UPDATE public.imovel SET ativo=false,publicado=false,updated_by=p_actor,updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('excluido',false,'inativado',true,'vinculos',to_jsonb(v_vinculos));
 END IF;

 -- Arquivos saem do storage depois do commit, pela API; aqui só a lista do que remover.
 SELECT coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'path',path)),'[]'::jsonb) INTO v_arquivos
 FROM public.imovel_arquivo WHERE imovel_id=p_id;
 DELETE FROM public.imovel_visita WHERE imovel_id=p_id;
 -- O lead é um contato do cliente: fica no comercial, só sem o imóvel que deixou de existir.
 UPDATE public.imovel_lead SET imovel_id=NULL WHERE imovel_id=p_id;
 DELETE FROM public.imovel_ocupacao WHERE imovel_id=p_id;
 DELETE FROM public.imovel_tarifa WHERE imovel_id=p_id;
 DELETE FROM public.imovel_cotacao WHERE imovel_id=p_id;
 DELETE FROM public.imovel_arquivo WHERE imovel_id=p_id;
 DELETE FROM public.imovel WHERE id=p_id;
 RETURN jsonb_build_object('excluido',true,'inativado',false,'arquivos',v_arquivos);
END $$;
REVOKE ALL ON FUNCTION public.imob_excluir_imovel(bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_excluir_imovel(bigint,uuid) TO service_role;
