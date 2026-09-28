begin;

-- Dashboard de estoque sem trafegar o catalogo inteiro.
--
-- A rota lia todos os produtos em blocos de 1.000 linhas so para somar e
-- escolher dois "top N". A funcao devolve o mesmo resultado calculado no banco,
-- com a mesma regra da rota:
--   custo    = ultimovalordecompra, caindo para precocompra quando for 0 ou nulo
--              (custo atual do cadastro, como os demais relatorios de estoque);
--   minimo   = estoqueminimo, nunca abaixo de 0;
--   valor    = max(0, estoque) * custo;
--   faixas   = zerado (estoque <= 0), abaixo do minimo (estoque <= minimo),
--              adequado (o resto);
--   reposicao = estoque <= minimo, zerados primeiro, maior reposicao sugerida,
--               menor estoque, id (a ordem estavel que a rota produzia), 10 itens;
--   maiorValor = valor > 0, maior valor e id, 8 itens.
create or replace function public.dashboard_estoque_resumo()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select
      p.id,
      coalesce(nullif(p.titulo, ''), 'Produto #' || p.id) as titulo,
      nullif(p.referencia, '') as referencia,
      p.estoque::numeric as estoque,
      greatest(0, p.estoqueminimo)::numeric as minimo,
      case
        when coalesce(p.ultimovalordecompra, 0) <> 0 then p.ultimovalordecompra
        else coalesce(p.precocompra, 0)
      end as custo
    from public.produto p
    where p.is_deleted = false
  ),
  calculado as (
    select
      b.*,
      greatest(0, b.estoque) * b.custo as valor,
      greatest(0, b.minimo - b.estoque) as reposicao_sugerida
    from base b
  ),
  reposicao as (
    select *
    from calculado
    where estoque <= minimo
    order by (estoque <= 0) desc, reposicao_sugerida desc, estoque asc, id asc
    limit 10
  ),
  maior_valor as (
    select *
    from calculado
    where valor > 0
    order by valor desc, id asc
    limit 8
  )
  select jsonb_build_object(
    'totais', (
      select jsonb_build_object(
        'produtos', count(*),
        'unidades', coalesce(sum(greatest(0, estoque)), 0),
        'valorEstoque', coalesce(sum(valor), 0),
        'zerados', count(*) filter (where estoque <= 0),
        'abaixoMinimo', count(*) filter (where estoque > 0 and estoque <= minimo),
        'adequados', count(*) filter (where estoque > 0 and estoque > minimo),
        'semCusto', count(*) filter (where custo <= 0)
      )
      from calculado
    ),
    'reposicao', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id, 'titulo', r.titulo, 'referencia', r.referencia,
          'estoque', r.estoque, 'minimo', r.minimo, 'custo', r.custo,
          'valor', r.valor, 'reposicaoSugerida', r.reposicao_sugerida
        )
        order by (r.estoque <= 0) desc, r.reposicao_sugerida desc, r.estoque asc, r.id asc
      )
      from reposicao r
    ), '[]'::jsonb),
    'maiorValor', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id, 'titulo', m.titulo, 'referencia', m.referencia,
          'estoque', m.estoque, 'minimo', m.minimo, 'custo', m.custo,
          'valor', m.valor, 'reposicaoSugerida', m.reposicao_sugerida
        )
        order by m.valor desc, m.id asc
      )
      from maior_valor m
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.dashboard_estoque_resumo() from public, anon, authenticated;
grant execute on function public.dashboard_estoque_resumo() to service_role;

commit;
