-- Canais em que o produto esta anunciado, para o filtro da lista do Estoque.
--
-- E um campo calculado do PostgREST: a lista filtra com
-- canais_anuncio=ov.{SITE,MERCADO_LIVRE} sem mandar ids na URL. Todo produto
-- novo nasce publicado no site (20261002220000), entao uma lista de ids
-- cresceria junto com o catalogo inteiro.
--
-- O que conta como anunciado em cada canal:
-- * SITE: vinculo PUBLICADO. PAUSADO e RASCUNHO ficam fora da loja, que e o
--   que o "Exibir no site" desligado mostra na aba Marketplace.
-- * MERCADO_LIVRE: vinculo com o anuncio, qualquer status. E o mesmo criterio
--   do icone do Mercado Livre na lista de produtos.
-- * SHOPEE: vinculo com o anuncio, qualquer status.
--
-- Os nomes seguem enum_canal_venda. Um canal novo entra aqui e na lista de
-- opcoes do filtro.
begin;

create or replace function public.canais_anuncio(p public.produto)
returns text[] language sql stable parallel safe set search_path = '' as $$
  select array_remove(array[
    case when exists (
      select 1 from public.site_product_link s
      where s.produto_id = p.id and s.status = 'PUBLICADO'
    ) then 'SITE' end,
    case when exists (
      select 1 from public.mercadolivre_product_link m
      where m.produto_id = p.id
    ) then 'MERCADO_LIVRE' end,
    case when exists (
      select 1 from public.shopee_product_link sh
      where sh.produto_id = p.id
    ) then 'SHOPEE' end
  ], null);
$$;

-- Os vinculos so tinham indice por (empresa_id, produto_id); a consulta do
-- campo procura so pelo produto.
create index if not exists site_product_link_produto_publicado_idx
  on public.site_product_link (produto_id) where status = 'PUBLICADO';
create index if not exists mercadolivre_product_link_produto_idx
  on public.mercadolivre_product_link (produto_id);
create index if not exists shopee_product_link_produto_idx
  on public.shopee_product_link (produto_id);

revoke all on function public.canais_anuncio(public.produto) from public, anon, authenticated;
grant execute on function public.canais_anuncio(public.produto) to service_role;

commit;
