-- Espelha produtogrupo."exibirPdv" para o canal Loja propria: ao desligar
-- "exibirSite" num grupo, todos os produtos dele saem do site, mesmo os que
-- estao PUBLICADOS individualmente em site_product_link. Religar devolve cada
-- produto ao estado da sua propria publicacao.
--
-- "ativo" continua fora da regra de visibilidade (ver
-- 20261001153000_site_catalog_visibility_by_publication): ele diz se o grupo pode
-- ser usado em novos cadastros, nao se aparece na loja.
BEGIN;

ALTER TABLE public.produtogrupo
  ADD COLUMN IF NOT EXISTS "exibirSite" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.produtogrupo."exibirSite" IS
  'Quando false, oculta a categoria e todos os produtos do grupo no site, independentemente de site_product_link.status. Quando true, respeita a publicacao individual do produto.';

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
    and coalesce(grupo."exibirSite", true) = true
  ) as visible,
  greatest(link.updated_at, coalesce(p.updatedat, p.createdat), coalesce(grupo.updatedat, grupo.createdat)) as source_updated_at
from public.site_product_link link
join public.produto p on p.id = link.produto_id
left join public.produtogrupo grupo on grupo.id = p.grupo_produto_id;

-- Alternar "exibirSite" precisa reenfileirar os produtos publicados do grupo,
-- senao o site so descobre a mudanca quando cada produto mudar por outro motivo.
drop trigger if exists trg_site_product_group_changed on public.produtogrupo;
create trigger trg_site_product_group_changed
after update of nome, ativo, "exibirSite"
on public.produtogrupo
for each row
when (
  old.nome is distinct from new.nome
  or old.ativo is distinct from new.ativo
  or old."exibirSite" is distinct from new."exibirSite"
)
execute function public.fn_site_product_group_changed();

COMMIT;
