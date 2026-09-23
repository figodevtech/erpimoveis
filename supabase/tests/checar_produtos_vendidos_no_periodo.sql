-- Conferencia do ranking de produtos mais vendidos contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/checar_produtos_vendidos_no_periodo.sql demir
--
-- Somente leitura. Tudo dentro de uma transacao que termina em ROLLBACK.
--
-- Este arquivo e o outro caminho para o mesmo numero que a rota
-- GET /api/dashboard/produtos-vendidos devolve. Os dois tem que bater linha a
-- linha; e o que prova que a agregacao em JS nao inventou nem perdeu nada.
--
-- Compare com:
--   /api/dashboard/produtos-vendidos?dateFrom=<v_inicio>&dateTo=<v_fim>
--
-- AS REGRAS QUE ESTE SQL REPETE, E POR QUE
--
--   Venda   — eixo `pagamento_em` e filtro de status obrigatorio. O trigger
--             `tg_venda_carimbar_marcos` preserva o carimbo no cancelamento, entao
--             venda CANCELADA continua com `pagamento_em` e so o status a exclui.
--
--   OS      — eixo `execucao_fim_em` e SEM filtro de status. Aqui e o contrario:
--             `fn_os_execucao_set_times` apaga o carimbo quando a OS e cancelada
--             ou reiniciada, entao o carimbo ja e a definicao de concluida.
--
--   Valor   — na venda, `valor_total - valor_frete`: o CHECK de
--             `fn_criar_venda_com_itens` e `valor_total = sub_total - desconto
--             + valor_frete`, entao o frete do item esta la dentro. Na OS,
--             `subtotal` puro, que ja vem liquido do desconto do item.
--
-- O intervalo e semiaberto: o inicio entra, a meia-noite seguinte ao fim fica de
-- fora. Fuso da oficina, America/Fortaleza (-03:00).

BEGIN;

DO $t$
DECLARE
  -- Ajuste aqui o periodo a conferir. O padrao e o mes corrente ate hoje,
  -- que e o mesmo padrao do filtro da tela.
  v_inicio date := date_trunc('month', (now() AT TIME ZONE 'America/Fortaleza'))::date;
  v_fim    date := (now() AT TIME ZONE 'America/Fortaleza')::date;

  v_de     timestamptz;
  v_ate    timestamptz;

  r        record;
  v_n      bigint;
BEGIN
  v_de  := (v_inicio::text || ' 00:00:00-03')::timestamptz;
  v_ate := ((v_fim + 1)::text || ' 00:00:00-03')::timestamptz;

  RAISE NOTICE '';
  RAISE NOTICE '=== PERIODO: % a % (limite superior exclusivo: %)', v_inicio, v_fim, v_ate;

  CREATE TEMP TABLE itens_vendidos ON COMMIT DROP AS
    SELECT 'VENDA'::text AS origem,
           v.id          AS documento_id,
           vp.produtoid  AS produto_id,
           vp.quantidade::numeric AS quantidade,
           round(coalesce(vp.valor_total, 0) - coalesce(vp.valor_frete, 0), 2) AS faturamento
      FROM public.vendaproduto vp
      JOIN public.venda v ON v.id = vp.venda_id
     WHERE v.status IN ('PAGAMENTO', 'FINALIZADA')
       AND v.pagamento_em >= v_de
       AND v.pagamento_em <  v_ate
       AND vp.quantidade > 0

    UNION ALL

    SELECT 'OS'::text,
           os.id,
           op.produtoid,
           op.quantidade::numeric,
           round(coalesce(op.subtotal, 0), 2)
      FROM public.osproduto op
      JOIN public.ordemservico os ON os.id = op.ordemservicoid
     WHERE os.is_deleted = false
       AND os.migracao_referencia IS NULL
       AND os.execucao_fim_em >= v_de
       AND os.execucao_fim_em <  v_ate
       AND op.quantidade > 0;

  /* ================================================== 1. totais por origem */

  RAISE NOTICE '';
  RAISE NOTICE '=== 1. TOTAIS (comparar com `totais` da resposta)';
  RAISE NOTICE '%', rpad('origem', 10) || rpad('unidades', 12) || rpad('faturamento', 16)
                 || rpad('produtos', 11) || 'documentos';

  FOR r IN
    SELECT origem,
           sum(quantidade)                   AS unidades,
           sum(faturamento)                  AS faturamento,
           count(DISTINCT produto_id)        AS produtos,
           count(DISTINCT documento_id)      AS documentos
      FROM itens_vendidos
     GROUP BY origem
     ORDER BY origem
  LOOP
    RAISE NOTICE '%', rpad(r.origem, 10) || rpad(to_char(r.unidades, 'FM999G999'), 12)
                   || rpad(to_char(r.faturamento, 'FM999G999G990D00'), 16)
                   || rpad(r.produtos::text, 11) || r.documentos::text;
  END LOOP;

  -- "todas" conta documento por origem: venda #7 e OS #7 sao papeis diferentes.
  FOR r IN
    SELECT sum(quantidade)              AS unidades,
           sum(faturamento)             AS faturamento,
           count(DISTINCT produto_id)   AS produtos,
           count(DISTINCT origem || ':' || documento_id) AS documentos
      FROM itens_vendidos
  LOOP
    RAISE NOTICE '%', rpad('TODAS', 10) || rpad(to_char(coalesce(r.unidades, 0), 'FM999G999'), 12)
                   || rpad(to_char(coalesce(r.faturamento, 0), 'FM999G999G990D00'), 16)
                   || rpad(coalesce(r.produtos, 0)::text, 11) || coalesce(r.documentos, 0)::text;
  END LOOP;

  /* ============================================= 2. top 15 por quantidade */

  RAISE NOTICE '';
  RAISE NOTICE '=== 2. TOP 15 POR UNIDADES (comparar com `ranking`)';
  RAISE NOTICE '%', rpad('produto', 10) || rpad('titulo', 34) || rpad('unid.', 9)
                 || rpad('faturamento', 16) || rpad('venda', 8) || rpad('os', 8) || 'docs';

  FOR r IN
    SELECT i.produto_id,
           coalesce(p.titulo, 'Produto #' || i.produto_id) AS titulo,
           sum(i.quantidade)  AS unidades,
           sum(i.faturamento) AS faturamento,
           sum(i.quantidade) FILTER (WHERE i.origem = 'VENDA') AS un_venda,
           sum(i.quantidade) FILTER (WHERE i.origem = 'OS')    AS un_os,
           count(DISTINCT i.documento_id) AS documentos
      FROM itens_vendidos i
      -- LEFT JOIN de proposito: produto excluido que ja vendeu tem que aparecer,
      -- senao o ranking deixa de fechar com o total de unidades.
      LEFT JOIN public.produto p ON p.id = i.produto_id
     GROUP BY i.produto_id, p.titulo
     ORDER BY sum(i.quantidade) DESC, sum(i.faturamento) DESC, i.produto_id ASC
     LIMIT 15
  LOOP
    RAISE NOTICE '%', rpad(r.produto_id::text, 10) || rpad(left(r.titulo, 32), 34)
                   || rpad(to_char(r.unidades, 'FM999G999'), 9)
                   || rpad(to_char(r.faturamento, 'FM999G999G990D00'), 16)
                   || rpad(to_char(coalesce(r.un_venda, 0), 'FM999G999'), 8)
                   || rpad(to_char(coalesce(r.un_os, 0), 'FM999G999'), 8)
                   || r.documentos::text;
  END LOOP;

  /* ============================================ 3. por grupo do cadastro */

  -- Alimenta o seletor de grupo do grafico. O grupo vem de
  -- `produto.grupo_produto_id` -> `produtogrupo`, o mesmo campo "Grupo" da aba
  -- Geral do cadastro. O enum legado `produto.grupo` NAO e usado pela aplicacao.
  -- LEFT JOIN nos dois lados: produto sem grupo, ou excluido, tem que aparecer.

  RAISE NOTICE '';
  RAISE NOTICE '=== 3. POR GRUPO (alimenta o seletor de grupo)';
  RAISE NOTICE '%', rpad('grupo', 30) || rpad('unidades', 12) || rpad('faturamento', 16) || 'produtos';

  FOR r IN
    SELECT coalesce(g.nome, 'Sem grupo') AS grupo,
           sum(i.quantidade)             AS unidades,
           sum(i.faturamento)            AS faturamento,
           count(DISTINCT i.produto_id)  AS produtos
      FROM itens_vendidos i
      LEFT JOIN public.produto p      ON p.id = i.produto_id
      LEFT JOIN public.produtogrupo g ON g.id = p.grupo_produto_id
     GROUP BY coalesce(g.nome, 'Sem grupo')
     ORDER BY sum(i.quantidade) DESC, coalesce(g.nome, 'Sem grupo')
  LOOP
    RAISE NOTICE '%', rpad(left(r.grupo, 28), 30) || rpad(to_char(r.unidades, 'FM999G999'), 12)
                   || rpad(to_char(r.faturamento, 'FM999G999G990D00'), 16) || r.produtos::text;
  END LOOP;

  /* ======================================= 4. diagnostico: carimbo faltando */

  -- Estes numeros sao sobre DADOS, nao sobre o codigo. Documento sem carimbo
  -- fica fora do grafico por construcao — e a regra certa. Se o numero for
  -- grande, ha operacao que nao esta passando pelo fluxo que carimba.

  RAISE NOTICE '';
  RAISE NOTICE '=== 4. DIAGNOSTICO — documentos que ficam de fora por falta de carimbo';

  SELECT count(*) INTO v_n
    FROM public.venda
   WHERE status IN ('PAGAMENTO', 'FINALIZADA')
     AND pagamento_em IS NULL;
  RAISE NOTICE 'vendas realizadas sem `pagamento_em`: %', v_n;

  SELECT count(*) INTO v_n
    FROM public.ordemservico
   WHERE is_deleted = false
     AND status IN ('PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO')
     AND execucao_fim_em IS NULL;
  RAISE NOTICE 'OS finalizadas sem `execucao_fim_em`: %', v_n;

  SELECT count(*) INTO v_n
    FROM public.osproduto_avulso a
    JOIN public.ordemservico os ON os.id = a.ordemservicoid
   WHERE os.is_deleted = false
     AND os.execucao_fim_em >= v_de
     AND os.execucao_fim_em <  v_ate;
  RAISE NOTICE 'itens avulsos no periodo (sem cadastro, ficam fora do ranking): %', v_n;

  RAISE NOTICE '';
END
$t$;

ROLLBACK;
