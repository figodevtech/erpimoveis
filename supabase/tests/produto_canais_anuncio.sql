-- Campo calculado canais_anuncio, usado pelo filtro de canal da lista do Estoque.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) produto sem vinculo nao esta em canal nenhum;
--   2) no site so conta o vinculo PUBLICADO (RASCUNHO e PAUSADO ficam fora);
--   3) Mercado Livre e Shopee contam pelo vinculo, e a ordem e sempre a mesma;
--   4) o filtro por sobreposicao traz quem esta em qualquer um dos canais;
--   5) so o service_role executa a funcao.
begin;

do $test$
declare
  v_empresa integer;
  v_produto integer;
  v_outro integer;
  v_canais text[];
begin
  select min(id) into v_empresa from public.empresa;
  if v_empresa is null then
    raise exception 'o banco precisa de uma empresa para o teste';
  end if;

  -- "exibirPdv" = false: o cadastro nao publica sozinho no site.
  insert into public.produto (titulo, precovenda, estoque, grupo_produto_id, tipo_unidade_id, "exibirPdv")
  select 'Produto de teste dos canais', 10, 0, p.grupo_produto_id, p.tipo_unidade_id, false
    from public.produto p order by p.id limit 1
  returning id into v_produto;

  insert into public.produto (titulo, precovenda, estoque, grupo_produto_id, tipo_unidade_id, "exibirPdv")
  select 'Outro produto de teste dos canais', 10, 0, p.grupo_produto_id, p.tipo_unidade_id, false
    from public.produto p order by p.id limit 1
  returning id into v_outro;

  -- 1) sem vinculo
  select p.canais_anuncio into v_canais from public.produto p where p.id = v_produto;
  if v_canais <> '{}'::text[] then
    raise exception 'produto sem vinculo deveria estar sem canal, veio %', v_canais;
  end if;

  -- 2) site
  insert into public.site_product_link (empresa_id, produto_id, status)
  values (v_empresa, v_produto, 'RASCUNHO');
  select p.canais_anuncio into v_canais from public.produto p where p.id = v_produto;
  if v_canais <> '{}'::text[] then
    raise exception 'rascunho no site nao e anuncio, veio %', v_canais;
  end if;

  update public.site_product_link set status = 'PAUSADO' where produto_id = v_produto;
  select p.canais_anuncio into v_canais from public.produto p where p.id = v_produto;
  if v_canais <> '{}'::text[] then
    raise exception 'pausado no site nao e anuncio, veio %', v_canais;
  end if;

  update public.site_product_link set status = 'PUBLICADO' where produto_id = v_produto;
  select p.canais_anuncio into v_canais from public.produto p where p.id = v_produto;
  if v_canais <> array['SITE'] then
    raise exception 'publicado no site deveria dar {SITE}, veio %', v_canais;
  end if;

  -- 3) Mercado Livre e Shopee, na ordem fixa
  insert into public.shopee_product_link (empresa_id, produto_id, item_id)
  values (v_empresa, v_produto, 999999999001);
  insert into public.mercadolivre_product_link (empresa_id, produto_id, ml_item_id, status)
  values (v_empresa, v_produto, 'MLBTESTECANAIS', 'paused');
  select p.canais_anuncio into v_canais from public.produto p where p.id = v_produto;
  if v_canais <> array['SITE', 'MERCADO_LIVRE', 'SHOPEE'] then
    raise exception 'esperado {SITE,MERCADO_LIVRE,SHOPEE}, veio %', v_canais;
  end if;

  insert into public.site_product_link (empresa_id, produto_id, status)
  values (v_empresa, v_outro, 'PUBLICADO');

  -- 4) sobreposicao: qualquer um dos canais marcados
  if (select count(*) from public.produto p
       where p.id in (v_produto, v_outro) and p.canais_anuncio && array['SITE']) <> 2 then
    raise exception 'filtro {SITE} deveria trazer os dois produtos';
  end if;
  if (select array_agg(p.id) from public.produto p
       where p.id in (v_produto, v_outro) and p.canais_anuncio && array['MERCADO_LIVRE', 'SHOPEE'])
     is distinct from array[v_produto] then
    raise exception 'filtro {MERCADO_LIVRE,SHOPEE} deveria trazer so o produto %', v_produto;
  end if;

  -- 5) permissoes
  if has_function_privilege('anon', 'public.canais_anuncio(public.produto)', 'execute')
     or has_function_privilege('authenticated', 'public.canais_anuncio(public.produto)', 'execute') then
    raise exception 'anon e authenticated nao deveriam executar canais_anuncio';
  end if;
  if not has_function_privilege('service_role', 'public.canais_anuncio(public.produto)', 'execute') then
    raise exception 'service_role deveria executar canais_anuncio';
  end if;

  raise notice 'canais_anuncio: ok';
end;
$test$;

rollback;
