-- Dados do anúncio que o site já exibia e o ERP não guardava: o selo do card
-- ("Vista para o mar") e se as fotos são do imóvel real ou ambientação ilustrativa.
ALTER TABLE public.imovel
 ADD COLUMN selo_anuncio text CHECK(selo_anuncio IS NULL OR length(btrim(selo_anuncio)) BETWEEN 1 AND 60),
 ADD COLUMN fotos_reais boolean NOT NULL DEFAULT false;

-- A view expande i.* na criação; é recriada para incluir as colunas novas.
DROP VIEW public.imovel_resumo;
CREATE VIEW public.imovel_resumo WITH(security_invoker=true) AS
 SELECT i.*,
 CASE WHEN NOT i.ativo THEN 'INATIVO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='MANUTENCAO' AND o.periodo @> current_date) THEN 'MANUTENCAO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='LOCACAO' AND o.periodo @> current_date) THEN 'ALUGADO'
  WHEN EXISTS(SELECT 1 FROM public.reserva_imovel r WHERE r.imovel_id=i.id AND r.status='EM_ANDAMENTO' AND daterange(r.inicio,r.fim,'[)') @> current_date) THEN 'OCUPADO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.periodo @> current_date) THEN 'RESERVADO'
  ELSE 'DISPONIVEL' END::text AS situacao_operacional,
 CASE WHEN i.vendido_em IS NOT NULL THEN 'VENDIDO'
  WHEN EXISTS(SELECT 1 FROM public.venda_imovel v WHERE v.imovel_id=i.id AND v.status='RASCUNHO') OR EXISTS(SELECT 1 FROM public.imovel_lead l WHERE l.imovel_id=i.id AND l.modalidade='VENDA' AND l.status='EM_ATENDIMENTO') THEN 'EM_NEGOCIACAO'
  ELSE 'DISPONIVEL' END::text AS situacao_comercial
 FROM public.imovel i;
REVOKE ALL ON public.imovel_resumo FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.imovel_resumo TO service_role;
