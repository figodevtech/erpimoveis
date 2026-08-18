-- Conferencia do lado do CUSTO e da DESPESA da DRE contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/checar_custos_dre.sql demir
--
-- Somente leitura. Tudo dentro de uma transacao que termina em ROLLBACK.
--
-- Companheiro de `checar_receitas_dre.sql`. La a pergunta era "todo documento
-- virou receita?"; aqui sao duas:
--
--   CUSTO    — tudo que saiu do estoque virou custo, e todo custo tem saida?
--   DESPESA  — o que o financeiro lancou chegou inteiro, sem entrar duas vezes?
--
-- O principio que amarra os dois: comprar nao e despesa. A compra vira estoque,
-- e o resultado so a enxerga quando a mercadoria sai por VENDA ou por OS.
--
-- A BAIXA MANUAL DE ESTOQUE NAO ENTRA AQUI, DE PROPOSITO.
-- Ela serve para registrar que um produto saiu sem ser por venda nem por OS —
-- e controle de estoque, nao fato de resultado, e nao gera receita nem despesa.
-- O `valor_custo_aplicado` que a saida guarda e so um retrato do custo do
-- produto naquele instante (`ultimovalordecompra`, com queda para `precocompra`),
-- usado na tela de detalhe da saida e como preco de partida de uma NF-e emitida
-- a partir dela. Nao e lancamento contabil e nao deve ser somado como custo.

BEGIN;

DO $t$
DECLARE
  v_template   integer;
  r            record;
  v_n          bigint;
  v_total      numeric;
  v_falhas     int := 0;
BEGIN

  SELECT id INTO v_template
    FROM public.dre_template
   WHERE ativo ORDER BY versao DESC, id DESC LIMIT 1;

  IF v_template IS NULL THEN
    RAISE EXCEPTION 'Nenhum template de DRE ativo. Rode as migrations primeiro.';
  END IF;

  /* ============================================ 1. de onde vem o custo */

  RAISE NOTICE '';
  RAISE NOTICE '=== 1. COMPOSICAO DO CUSTO E DA DESPESA';
  RAISE NOTICE '%', rpad('fonte', 16) || rpad('origem', 11) || rpad('papel', 9)
                 || rpad('lanc.', 7) || rpad('valor', 15) || 'linha';

  -- Agrupado tambem pela linha: uma mesma origem se espalha por varias linhas
  -- (transacao avulsa vai para 4.3, 6.3, 6.6, 10.2...), e juntar tudo numa
  -- linha so daria a impressao de que a despesa inteira cai num lugar.
  FOR r IN
    SELECT coalesce(e.source_type, 'ORDEM_SERVICO') AS fonte,
           e.origem,
           e.natureza_dre,
           count(*)      AS lancamentos,
           sum(e.valor)  AS valor,
           coalesce(dl.codigo, '— sem linha') AS linha
      FROM public.eventos_financeiros e
      LEFT JOIN public.dre_linha dl
        ON dl.id = coalesce(
             e.dre_linha_id,
             (SELECT mp.linha_id FROM public.dre_mapeamento mp
               WHERE mp.template_id = v_template AND mp.ativo
                 AND mp.origem_tipo = 'EVENTO_ORIGEM'
                 AND mp.origem_valor = e.origem || ':' || e.natureza
               LIMIT 1))
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND e.natureza_dre IN ('CUSTO', 'DESPESA')
       AND e.competencia_em IS NOT NULL
     GROUP BY 1, 2, 3, 6
     ORDER BY 5 DESC
  LOOP
    RAISE NOTICE '%', rpad(r.fonte, 16) || rpad(r.origem, 11) || rpad(r.natureza_dre, 9)
                   || rpad(r.lancamentos::text, 7)
                   || rpad(to_char(r.valor, 'FM999G999G990D00'), 15)
                   || r.linha;
  END LOOP;

  /* =================================== 2. custo de item sem custo cadastrado */

  RAISE NOTICE '';
  RAISE NOTICE '=== 2. ITEM VENDIDO SEM CUSTO CADASTRADO';

  SELECT count(*) FILTER (WHERE dados_snapshot @> '{"custo_nao_informado": true}'),
         count(*)
    INTO v_n, v_total
    FROM public.eventos_financeiros
   WHERE status IN ('ATIVO', 'CONVERTIDO')
     AND natureza_dre = 'CUSTO'
     AND competencia_em IS NOT NULL;

  RAISE NOTICE '  % de % eventos de custo entram com valor zero', v_n, v_total;
  IF v_n > 0 THEN
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  a margem desses itens aparece como 100%%, que e falso.';
  END IF;

  /* ================================ 3. custo na DRE sem saida de estoque */

  -- So conta evento COM competencia: custo de OS ainda em execucao existe no
  -- livro de proposito (alimenta a rentabilidade da OS) e nao entra em periodo
  -- nenhum — nesse caso a mercadoria ainda nem saiu, e esta certo.

  RAISE NOTICE '';
  RAISE NOTICE '=== 3. CUSTO NA DRE SEM SAIDA DE ESTOQUE';

  SELECT count(*), coalesce(sum(e.valor), 0) INTO v_n, v_total
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.natureza_dre = 'CUSTO'
     AND e.origem = 'PRODUTO'
     AND e.competencia_em IS NOT NULL
     AND e.produtoid IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.estoque_movimento m
        WHERE m.produto_id = e.produtoid
          AND m.sentido::text = 'SAIDA'
          AND ((e.ordemservicoid IS NOT NULL AND m.ordemservicoid = e.ordemservicoid)
            OR (e.source_type = 'VENDA' AND m.venda_id = e.source_id)));

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhum. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> % evento(s), R$ % — custo lancado sem a mercadoria ter saido',
      v_n, to_char(v_total, 'FM999G999G990D00');
    FOR r IN
      SELECT e.id, e.valor, e.ordemservicoid os, e.source_id vd,
             left(coalesce(e.descricao, ''), 40) d
        FROM public.eventos_financeiros e
       WHERE e.status IN ('ATIVO', 'CONVERTIDO') AND e.natureza_dre = 'CUSTO'
         AND e.origem = 'PRODUTO' AND e.competencia_em IS NOT NULL
         AND e.produtoid IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.estoque_movimento m
            WHERE m.produto_id = e.produtoid AND m.sentido::text = 'SAIDA'
              AND ((e.ordemservicoid IS NOT NULL AND m.ordemservicoid = e.ordemservicoid)
                OR (e.source_type = 'VENDA' AND m.venda_id = e.source_id)))
       ORDER BY e.valor DESC LIMIT 15
    LOOP
      RAISE NOTICE '        evt #% R$ % os=% venda=% | %',
        rpad(r.id::text, 6), lpad(to_char(r.valor, 'FM999G990D00'), 10),
        coalesce(r.os::text, '-'), coalesce(r.vd::text, '-'), r.d;
    END LOOP;
  END IF;

  /* ================================ 4. saida de estoque sem custo na DRE */

  -- Conta o LIQUIDO por documento e produto, nao os movimentos soltos.
  --
  -- Toda devolucao gera um movimento de ENTRADA que anula a SAIDA. Contando so
  -- as saidas, uma venda cancelada com a peca devolvida aparecia como "saiu sem
  -- custo" — e nao saiu nada: voltou. Foi o que aconteceu com as tres primeiras
  -- acusacoes deste bloco no Demir, todas estornadas.
  --
  -- Liquido negativo tambem interessa: significa que voltou mais do que saiu, e
  -- ai o estoque esta maior do que deveria.

  RAISE NOTICE '';
  RAISE NOTICE '=== 4. SAIDA LIQUIDA DE OS/VENDA SEM CUSTO NO LIVRO';

  v_n := 0;
  FOR r IN
    WITH liquido AS (
      SELECT m.ordemservicoid AS os, m.venda_id AS venda, m.produto_id,
             sum(CASE WHEN m.sentido::text = 'SAIDA' THEN m.quantidade
                      ELSE -m.quantidade END) AS saldo
        FROM public.estoque_movimento m
       WHERE m.ordemservicoid IS NOT NULL OR m.venda_id IS NOT NULL
       GROUP BY 1, 2, 3
    )
    SELECT l.os, l.venda, l.produto_id, l.saldo,
           left(coalesce(nullif(p.titulo, ''), p.descricao, '?'), 30) AS produto
      FROM liquido l
      LEFT JOIN public.produto p ON p.id = l.produto_id
     WHERE l.saldo > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.eventos_financeiros e
          WHERE e.natureza_dre = 'CUSTO'
            AND e.status IN ('ATIVO', 'CONVERTIDO')
            AND e.produtoid = l.produto_id
            AND ((l.os IS NOT NULL AND e.ordemservicoid = l.os)
              OR (l.venda IS NOT NULL AND e.source_type = 'VENDA' AND e.source_id = l.venda)))
     ORDER BY l.saldo DESC
     LIMIT 15
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '  % #% produto #% "%" — saiu % sem custo no livro',
      CASE WHEN r.os IS NOT NULL THEN 'OS' ELSE 'venda' END,
      coalesce(r.os, r.venda), r.produto_id, r.produto, r.saldo;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhuma. OK';
  ELSE
    v_falhas := v_falhas + 1;
  END IF;

  /* ============================ 4b. voltou mais do que saiu */

  RAISE NOTICE '';
  RAISE NOTICE '=== 4b. DEVOLUCAO MAIOR QUE A SAIDA (estoque inflado)';

  v_n := 0;
  FOR r IN
    SELECT m.ordemservicoid AS os, m.venda_id AS venda, m.produto_id,
           sum(CASE WHEN m.sentido::text = 'SAIDA' THEN m.quantidade
                    ELSE -m.quantidade END) AS saldo,
           left(coalesce(nullif(p.titulo, ''), p.descricao, '?'), 30) AS produto
      FROM public.estoque_movimento m
      LEFT JOIN public.produto p ON p.id = m.produto_id
     WHERE m.ordemservicoid IS NOT NULL OR m.venda_id IS NOT NULL
     GROUP BY 1, 2, 3, 5
    HAVING sum(CASE WHEN m.sentido::text = 'SAIDA' THEN m.quantidade
                    ELSE -m.quantidade END) < 0
     ORDER BY 4
     LIMIT 15
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '  % #% produto #% "%" — voltou % a mais',
      CASE WHEN r.os IS NOT NULL THEN 'OS' ELSE 'venda' END,
      coalesce(r.os, r.venda), r.produto_id, r.produto, abs(r.saldo);
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhuma. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  o estoque desses produtos esta maior do que deveria.';
  END IF;

  /* ==================================== 5. despesa contada duas vezes */

  RAISE NOTICE '';
  RAISE NOTICE '=== 5. LANCAMENTO REPETIDO (mesmo valor, data e conta)';
  RAISE NOTICE '%', '  ' || rpad('valor', 14) || rpad('data', 12) || rpad('vezes', 7) || 'conta';

  v_n := 0;
  FOR r IN
    SELECT t.valor, t.data::date AS dia, t.plano_de_conta AS conta,
           count(*) AS vezes,
           string_agg(t.id::text, ', ' ORDER BY t.id) AS ids
      FROM public.transacao t
     WHERE coalesce(t.is_deleted, false) = false
       AND t.plano_de_conta_id IS NOT NULL
       AND t.ordemservicoid IS NULL
       AND t.vendaid IS NULL
     GROUP BY 1, 2, 3
    HAVING count(*) > 1
     ORDER BY t.valor * count(*) DESC
     LIMIT 15
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '%', '  ' || rpad(to_char(r.valor, 'FM999G999G990D00'), 14)
                   || rpad(to_char(r.dia, 'DD/MM/YYYY'), 12)
                   || rpad(r.vezes::text, 7)
                   || left(coalesce(r.conta, '-'), 28);
    RAISE NOTICE '%', '      #' || r.ids;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhum. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  repetir nao prova duplicata — duas notas de mesmo valor no';
    RAISE NOTICE '  mesmo dia acontecem. Serve para conferir uma a uma.';
  END IF;

  /* ============================ 6. natureza contraria a da linha */

  RAISE NOTICE '';
  RAISE NOTICE '=== 6. DESPESA EM LINHA DE RECEITA (e o contrario)';

  v_n := 0;
  FOR r IN
    SELECT dl.codigo, dl.nome, dl.natureza_dre AS linha_natureza,
           e.natureza, count(*) AS lancamentos, sum(e.valor) AS valor
      FROM public.eventos_financeiros e
      JOIN public.dre_linha dl ON dl.id = e.dre_linha_id
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND e.competencia_em IS NOT NULL
       AND ((dl.natureza_dre = 'RECEITA' AND e.natureza <> 'RECEITA')
         OR (dl.natureza_dre IN ('DESPESA', 'CUSTO', 'DEDUCAO') AND e.natureza = 'RECEITA'))
     GROUP BY 1, 2, 3, 4
     ORDER BY 1
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '  linha % % (%) recebe % lanc. de natureza % — R$ %',
      rpad(r.codigo, 6), rpad(left(r.nome, 32), 34), r.linha_natureza,
      r.lancamentos, r.natureza, to_char(r.valor, 'FM999G999G990D00');
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhum. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  a linha vem do plano de contas: revise a classificacao no';
    RAISE NOTICE '  financeiro, nao o mapeamento da DRE.';
  END IF;

  /* =============================================================== fim */

  RAISE NOTICE '';
  IF v_falhas = 0 THEN
    RAISE NOTICE '=== RESULTADO: custo e despesa integros.';
  ELSE
    RAISE NOTICE '=== RESULTADO: % ponto(s) de atencao.', v_falhas;
  END IF;
  RAISE NOTICE '';

END $t$;

ROLLBACK;
