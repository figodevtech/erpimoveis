begin;

create or replace view public.site_catalog_export
with (security_invoker = true)
as
select
  link.id as product_link_id,
  link.empresa_id,
  p.id as produto_id,
  link.sync_version,
  link.status,
  link.sync_status,
  link.last_synced_at,
  link.last_sync_error,
  coalesce(nullif(btrim(link.titulo_site), ''), nullif(btrim(p."tituloMarketplace"), ''), p.titulo) as titulo,
  coalesce(nullif(btrim(link.descricao_site), ''), nullif(btrim(p."descricaoMarketplace"), ''), '') as descricao,
  case when link.usar_preco_erp then p.precovenda else link.preco_site end as preco,
  least(
    greatest(coalesce(p.estoque, 0) - link.estoque_seguranca, 0),
    coalesce(link.estoque_maximo_site, 2147483647)
  )::integer as estoque,
  p.referencia,
  p.fabricante,
  p.grupo_produto_id,
  grupo.nome as grupo_nome,
  p."imgUrl" as imagem_principal,
  p.conservacao,
  p.codigobarras,
  link.destaque,
  link.slug,
  (
    link.status = 'PUBLICADO'
    and coalesce(p.is_deleted, false) = false
  ) as visible,
  greatest(link.updated_at, coalesce(p.updatedat, p.createdat), coalesce(grupo.updatedat, grupo.createdat)) as source_updated_at
from public.site_product_link link
join public.produto p on p.id = link.produto_id
left join public.produtogrupo grupo on grupo.id = p.grupo_produto_id;

commit;
