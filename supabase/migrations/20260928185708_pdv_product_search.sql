-- A normalização já usada no catálogo do marketplace é IMMUTABLE e cobre os
-- acentos portugueses. As funções abaixo permitem índices sem reescrever produto.
create function public.pdv_product_search_text(p public.produto)
returns text language sql immutable parallel safe set search_path = '' as $$
  select public.marketplace_search_normalize(
    coalesce(p.titulo, '') || ' ' || coalesce(p.descricao, '') || ' ' ||
    coalesce(p.referencia, '') || ' ' || coalesce(p.fabricante, '') || ' ' ||
    coalesce(p.codigobarras, '') || ' ' || coalesce(p.etiqueta, '') || ' ' ||
    coalesce(p.local, '') || ' ' || coalesce(p.unidade::text, '') || ' ' ||
    coalesce(p.ncm, '') || ' ' || coalesce(p.cfop, '') || ' ' ||
    coalesce(p.origem_mercadoria::text, '') || ' ' || coalesce(p.csosn, '') || ' ' ||
    coalesce(p.cst, '') || ' ' || coalesce(p.cest, '') || ' ' ||
    coalesce(p.cst_pis, '') || ' ' || coalesce(p.modo_pis::text, '') || ' ' ||
    coalesce(p.cst_cofins, '') || ' ' || coalesce(p.modo_cofins::text, '') || ' ' ||
    coalesce(p.cst_ibscbs, '') || ' ' || coalesce(p.cclass_trib, '') || ' ' ||
    coalesce(p.status_estoque::text, '') || ' ' || coalesce(p.conservacao::text, '') || ' ' ||
    coalesce(p."tituloMarketplace", '') || ' ' || coalesce(p."descricaoMarketplace", '')
  );
$$;

create function public.pdv_product_structured_text(p public.produto)
returns text language sql immutable parallel safe set search_path = '' as $$
  select public.marketplace_search_normalize(
    coalesce(p.etiqueta, '') || ' ' || coalesce(p.referencia, '') || ' ' ||
    coalesce(p.codigobarras, '') || ' ' || coalesce(p.ncm, '') || ' ' ||
    coalesce(p.cest, '')
  );
$$;

create function public.pdv_group_search_text(g public.produtogrupo)
returns text language sql immutable parallel safe set search_path = '' as $$
  select public.marketplace_search_normalize(
    g.id::text || ' ' || coalesce(g.nome, '') || ' ' || coalesce(g.descricao, '') || ' ' ||
    g.ativo::text || ' ' || g."exibirPdv"::text
  );
$$;

create index if not exists produto_pdv_visible_id_idx
  on public.produto (id desc) where is_deleted = false and "exibirPdv" = true;
create index if not exists produto_pdv_group_status_id_idx
  on public.produto (grupo_produto_id, status_estoque, id desc)
  where is_deleted = false and "exibirPdv" = true;
create index if not exists produto_pdv_status_id_idx
  on public.produto (status_estoque, id desc)
  where is_deleted = false and "exibirPdv" = true;
create index if not exists produto_pdv_search_trgm_idx
  on public.produto using gin (public.pdv_product_search_text(produto) gin_trgm_ops)
  where is_deleted = false and "exibirPdv" = true;
create index if not exists produto_pdv_structured_trgm_idx
  on public.produto using gin (public.pdv_product_structured_text(produto) gin_trgm_ops)
  where is_deleted = false and "exibirPdv" = true;
create index if not exists produtogrupo_pdv_search_trgm_idx
  on public.produtogrupo using gin (public.pdv_group_search_text(produtogrupo) gin_trgm_ops)
  where "exibirPdv" = true;

create function public.pdv_search_products(
  p_tokens jsonb default '[]'::jsonb,
  p_page integer default 1,
  p_limit integer default 48,
  p_group_id integer default null,
  p_status text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_where text := 'p.is_deleted = false and p."exibirPdv" = true and g."exibirPdv" = true';
  v_token jsonb;
  v_value text;
  v_pattern text;
  v_result jsonb;
begin
  if p_tokens is null or jsonb_typeof(p_tokens) <> 'array'
     or jsonb_array_length(p_tokens) > 20 or p_page is null or p_page < 1
     or p_limit is null or p_limit < 1 or p_limit > 100
     or (p_status is not null and p_status not in ('OK','CRITICO','BAIXO','SEM_ESTOQUE')) then
    raise exception 'Parâmetros de busca inválidos';
  end if;

  if p_group_id is not null then
    v_where := v_where || format(' and p.grupo_produto_id = %L', p_group_id);
  end if;
  if p_status is not null then
    v_where := v_where || format(' and p.status_estoque = %L::public.estoque_status', p_status);
  end if;

  for v_token in select value from jsonb_array_elements(p_tokens) loop
    v_value := public.marketplace_search_normalize(v_token->>'value');
    if v_value is null or length(v_value) > 100 or v_value = '' then
      raise exception 'Termo de busca inválido';
    end if;
    v_pattern := '%' || replace(replace(replace(v_value, '!', '!!'), '%', '!%'), '_', '!_') || '%';
    if coalesce((v_token->>'structured')::boolean, false) then
      v_where := v_where || format(
        ' and public.pdv_product_structured_text(p) like %L escape ''!''', v_pattern
      );
    else
      v_where := v_where || format(
        ' and (p.id::text = %L or public.pdv_product_search_text(p) like %L escape ''!'' or p.grupo_produto_id in (select sg.id from public.produtogrupo sg where sg."exibirPdv" = true and public.pdv_group_search_text(sg) like %L escape ''!''))',
        v_value, v_pattern, v_pattern
      );
    end if;
  end loop;

  execute format($query$
    with matched as materialized (
      select p.id from public.produto p
      join public.produtogrupo g on g.id = p.grupo_produto_id
      where %s
    ), page_rows as (
      select p.id, p.titulo, p.descricao, p.precovenda, p.estoque,
        p.estoqueminimo, p.unidade, p.referencia, p.codigobarras,
        p.ncm, p.cfop, p.fabricante, p.grupo_produto_id,
        jsonb_build_object('id', g.id, 'nome', g.nome, 'descricao', g.descricao,
          'ativo', g.ativo, 'exibirPdv', g."exibirPdv") as grupo,
        p.status_estoque, p."exibirPdv", p."tituloMarketplace",
        p."descricaoMarketplace", p."imgUrl"
      from matched m
      join public.produto p on p.id = m.id
      join public.produtogrupo g on g.id = p.grupo_produto_id
      order by m.id desc
      limit %s offset %s
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'data', coalesce((select jsonb_agg(to_jsonb(r) order by r.id desc) from page_rows r), '[]'::jsonb)
    )
  $query$, v_where, p_limit, (p_page::bigint - 1) * p_limit) into v_result;
  return v_result;
end;
$$;

revoke all on function public.pdv_search_products(jsonb,integer,integer,integer,text) from public, anon, authenticated;
grant execute on function public.pdv_search_products(jsonb,integer,integer,integer,text) to service_role;
revoke all on function public.pdv_product_search_text(public.produto) from public, anon, authenticated;
revoke all on function public.pdv_product_structured_text(public.produto) from public, anon, authenticated;
revoke all on function public.pdv_group_search_text(public.produtogrupo) from public, anon, authenticated;
grant execute on function public.pdv_product_search_text(public.produto) to service_role;
grant execute on function public.pdv_product_structured_text(public.produto) to service_role;
grant execute on function public.pdv_group_search_text(public.produtogrupo) to service_role;
