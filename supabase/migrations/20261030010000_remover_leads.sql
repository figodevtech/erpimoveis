-- Contatos de interesse não são registrados: o site manda imóvel, visita e proprietário
-- direto para o WhatsApp da equipe. A tabela de leads sai junto com o que dependia dela.

-- "Em negociação" passa a vir só de venda em rascunho (antes também de lead de venda em atendimento).
CREATE OR REPLACE VIEW public.imovel_resumo WITH(security_invoker=true) AS
 SELECT i.*,
 CASE WHEN NOT i.ativo THEN 'INATIVO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='MANUTENCAO' AND o.periodo @> current_date) THEN 'MANUTENCAO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='LOCACAO' AND o.periodo @> current_date) THEN 'ALUGADO'
  WHEN EXISTS(SELECT 1 FROM public.reserva_imovel r WHERE r.imovel_id=i.id AND r.status='EM_ANDAMENTO' AND daterange(r.inicio,r.fim,'[)') @> current_date) THEN 'OCUPADO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.periodo @> current_date) THEN 'RESERVADO'
  ELSE 'DISPONIVEL' END::text AS situacao_operacional,
 CASE WHEN i.vendido_em IS NOT NULL THEN 'VENDIDO'
  WHEN EXISTS(SELECT 1 FROM public.venda_imovel v WHERE v.imovel_id=i.id AND v.status='RASCUNHO') THEN 'EM_NEGOCIACAO'
  ELSE 'DISPONIVEL' END::text AS situacao_comercial
 FROM public.imovel i;

-- Exclusão de imóvel sem o passo que desvinculava leads.
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
 DELETE FROM public.imovel_ocupacao WHERE imovel_id=p_id;
 DELETE FROM public.imovel_tarifa WHERE imovel_id=p_id;
 DELETE FROM public.imovel_cotacao WHERE imovel_id=p_id;
 DELETE FROM public.imovel_arquivo WHERE imovel_id=p_id;
 DELETE FROM public.imovel WHERE id=p_id;
 RETURN jsonb_build_object('excluido',true,'inativado',false,'arquivos',v_arquivos);
END $$;

ALTER TABLE public.imovel_visita DROP COLUMN lead_id;
DROP TABLE public.imovel_lead;
