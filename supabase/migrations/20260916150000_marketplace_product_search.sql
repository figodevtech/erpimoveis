-- Pesquisa no servidor: retorna somente a página solicitada e o total filtrado.
create or replace function public.marketplace_search_normalize(p_text text)
returns text language sql immutable parallel safe set search_path = public as $$
  select translate(lower(coalesce(p_text, '')),
    'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn');
$$;

create or replace function public.marketplace_search_products(
  p_empresa_id bigint, p_tokens jsonb default '[]', p_page integer default 1,
  p_limit integer default 20, p_product_id bigint default null,
  p_linked boolean default false, p_unlinked boolean default false,
  p_include_zero boolean default false
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare result jsonb;
begin
  if p_empresa_id is null or p_empresa_id <= 0 or p_page is null or p_page < 1
    or p_page > 100000 or p_limit is null or p_limit < 1 or p_limit > 1000
    or p_tokens is null or jsonb_typeof(p_tokens) <> 'array' then
    raise exception 'Parâmetros de busca inválidos';
  end if;
  if jsonb_array_length(p_tokens) > 20 then raise exception 'Busca muito longa'; end if;

  with candidates as (
    select p.id, to_jsonb(p) as doc
    from public.produto p
    where p.is_deleted = false
      and (p_product_id is null or p.id = p_product_id)
      and (p_product_id is not null or (
        (not p_linked and not p_unlinked and (p_include_zero or p.estoque > 0))
        or (p_unlinked and not exists (select 1 from public.mercadolivre_product_link l
          where l.empresa_id = p_empresa_id and l.produto_id = p.id and l.ml_item_id is not null))
        or (p_linked and not p_unlinked and exists (select 1 from public.mercadolivre_product_link l
          where l.empresa_id = p_empresa_id and l.produto_id = p.id and l.ml_item_id is not null))
      ))
  ), matched as materialized (
    select c.id from candidates c
    where not exists (
      select 1 from jsonb_array_elements(p_tokens) token
      where not (
        (not coalesce((token->>'structured')::boolean, false) and c.id::text = token->>'value')
        or exists (
          select 1 from jsonb_each_text(c.doc) field
          where field.key = any(case when coalesce((token->>'structured')::boolean, false)
            then array['referencia','codigobarras','etiqueta','ncm','cest']
            else array['titulo','descricao','referencia','fabricante','codigobarras','etiqueta',
              'local','ncm','cest','status_estoque','conservacao','tituloMarketplace','descricaoMarketplace'] end)
            and strpos(public.marketplace_search_normalize(field.value), token->>'value') > 0
        )
      )
    )
  ), page_rows as (
    select p.* from public.produto p join (
      select id from matched order by id desc limit p_limit offset ((p_page - 1)::bigint * p_limit)
    ) ids on ids.id = p.id
  )
  select jsonb_build_object('total', (select count(*) from matched),
    'data', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'titulo', p.titulo, 'descricao', p.descricao, 'referencia', p.referencia,
      'precovenda', p.precovenda, 'estoque', p.estoque,
      'status_estoque', p.status_estoque, 'tituloMarketplace', p."tituloMarketplace",
      'descricaoMarketplace', p."descricaoMarketplace", 'imgUrl', p."imgUrl",
      'fabricante', p.fabricante, 'codigobarras', p.codigobarras, 'conservacao', p.conservacao,
      'etiqueta', p.etiqueta, 'local', p.local, 'ncm', p.ncm, 'cest', p.cest
    ) order by p.id desc) from page_rows p), '[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.marketplace_search_products(bigint,jsonb,integer,integer,bigint,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.marketplace_search_products(bigint,jsonb,integer,integer,bigint,boolean,boolean,boolean) to service_role;
