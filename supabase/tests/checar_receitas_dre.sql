-- Conferencia do lado da RECEITA da DRE contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/checar_receitas_dre.sql demir
--
-- Somente leitura. Tudo dentro de uma transacao que termina em ROLLBACK.
--
-- A receita e o inicio da DRE: se ela nao fecha com o documento que a originou,
-- nenhuma linha abaixo dela significa coisa alguma. Este script verifica, na
-- ordem, as quatro maneiras de a receita estar errada:
--
--   1. origem de receita que existe no livro e nao esta mapeada no template
--      (o lancamento existe e nao entra em linha nenhuma — some sem erro);
--   2. receita sem competencia (existe, mas nao pertence a periodo algum);
--   3. receita que nao fecha com o total do documento de origem;
--   4. documento reconhecido que nao gerou receita nenhuma.

BEGIN;

DO $t$
DECLARE
  v_template   integer;
  v_tpl_codigo text;
  v_tpl_versao integer;
  r            record;
  v_n          bigint;
  v_total      numeric;
  v_linhas     numeric;
  v_falhas     int := 0;
BEGIN

  /* ============================================================ 0. template */

  SELECT id, codigo, versao INTO v_template, v_tpl_codigo, v_tpl_versao
    FROM public.dre_template
   WHERE ativo
   ORDER BY versao DESC, id DESC
   LIMIT 1;

  IF v_template IS NULL THEN
    RAISE EXCEPTION 'Nenhum template de DRE ativo. Rode as migrations primeiro.';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== TEMPLATE ATIVO: % v% (id %)', v_tpl_codigo, v_tpl_versao, v_template;

  /* ================================================ 1. origens de receita */

  -- Uma origem chega a uma linha por dois caminhos: `eventos_financeiros.
  -- dre_linha_id` (vinculo direto, usado pelos lancamentos de transacao, cuja
  -- linha depende do plano de contas) ou `dre_mapeamento` por origem de evento
  -- (usado por OS e venda). O vinculo direto tem precedencia. Sem nenhum dos
  -- dois, o lancamento existe e nao entra em linha alguma — some sem erro.

  RAISE NOTICE '';
  RAISE NOTICE '=== 1. ORIGENS DE RECEITA NO LIVRO';
  RAISE NOTICE '%', rpad('origem:natureza', 20) || rpad('lanc.', 7)
                 || rpad('valor', 15) || rpad('s/ linha', 10) || 'linha por mapeamento';

  FOR r IN
    SELECT g.chave,
           g.lancamentos,
           g.valor,
           g.sem_linha,
           (SELECT dl.codigo || ' ' || dl.nome
              FROM public.dre_mapeamento mp
              JOIN public.dre_linha dl ON dl.id = mp.linha_id
             WHERE mp.template_id = v_template
               AND mp.ativo
               AND mp.origem_tipo = 'EVENTO_ORIGEM'
               AND mp.origem_valor = g.chave
             LIMIT 1)                                        AS linha
      FROM (
        SELECT e.origem || ':' || e.natureza                     AS chave,
               count(*)                                          AS lancamentos,
               sum(e.valor)                                      AS valor,
               count(*) FILTER (WHERE e.dre_linha_id IS NULL)    AS sem_linha
          FROM public.eventos_financeiros e
         WHERE e.status IN ('ATIVO', 'CONVERTIDO')
           AND e.natureza = 'RECEITA'
         GROUP BY 1
      ) g
     ORDER BY g.chave
  LOOP
    RAISE NOTICE '%', rpad(r.chave, 20)
                   || rpad(r.lancamentos::text, 7)
                   || rpad(to_char(r.valor, 'FM999G999G990D00'), 15)
                   || rpad(r.sem_linha::text, 10)
                   || coalesce(r.linha,
                        CASE WHEN r.sem_linha = 0
                             THEN 'so por vinculo direto (dre_linha_id)'
                             ELSE '>>> SEM MAPEAMENTO — ' || r.sem_linha
                                  || ' lanc. FORA DA DRE' END);
    IF r.linha IS NULL AND r.sem_linha > 0 THEN
      v_falhas := v_falhas + 1;
    END IF;
  END LOOP;

  /* ================================================== 2. sem competencia */

  -- Receita de OS ainda em execucao *deve* ficar sem competencia: o servico nao
  -- foi entregue, entao nao pertence a periodo nenhum (migration 20260802170000).
  -- So e defeito quando o documento ja foi reconhecido e a competencia nao veio.

  RAISE NOTICE '';
  RAISE NOTICE '=== 2. RECEITA SEM COMPETENCIA';

  SELECT count(*), coalesce(sum(e.valor), 0) INTO v_n, v_total
    FROM public.eventos_financeiros e
    JOIN public.ordemservico o ON o.id = e.ordemservicoid
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.natureza = 'RECEITA'
     AND e.competencia_em IS NULL
     AND o.execucao_fim_em IS NULL;
  RAISE NOTICE '  OS ainda em execucao (esperado): % lanc., R$ %',
    v_n, to_char(v_total, 'FM999G999G990D00');

  v_n := 0;
  FOR r IN
    SELECT coalesce(e.source_type, 'ORDEM_SERVICO') AS tipo,
           count(*) AS lancamentos,
           sum(e.valor) AS valor
      FROM public.eventos_financeiros e
      LEFT JOIN public.ordemservico o ON o.id = e.ordemservicoid
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND e.natureza = 'RECEITA'
       AND e.competencia_em IS NULL
       AND (e.ordemservicoid IS NULL OR o.execucao_fim_em IS NOT NULL)
     GROUP BY 1 ORDER BY 1
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '  >>> % — % lancamento(s), R$ % SEM COMPETENCIA E JA RECONHECIDO',
      rpad(r.tipo, 16), r.lancamentos, to_char(r.valor, 'FM999G999G990D00');
    v_falhas := v_falhas + 1;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhum documento reconhecido sem competencia. OK';
  END IF;

  /* ============================ 2b. antecipacao/adiantamento como receita */

  -- Antecipar recebiveis e operacao de credito sobre titulos cuja receita ja
  -- foi reconhecida na OS ou na venda. Se a transacao virar evento de receita,
  -- o mesmo dinheiro entra duas vezes.

  RAISE NOTICE '';
  RAISE NOTICE '=== 2b. ANTECIPACAO / ADIANTAMENTO GERANDO RECEITA (dupla contagem)';

  v_n := 0;
  FOR r IN
    SELECT e.id, e.valor, e.dre_linha_id,
           coalesce(dl.codigo || ' ' || dl.nome, 'sem linha') AS linha,
           dl.natureza_dre AS linha_natureza,
           coalesce(t.plano_de_conta, '-') AS plano,
           left(coalesce(e.descricao, ''), 38) AS descricao
      FROM public.eventos_financeiros e
      JOIN public.transacao t ON t.id = e.source_id
      LEFT JOIN public.dre_linha dl ON dl.id = e.dre_linha_id
     WHERE e.source_type = 'TRANSACAO'
       AND e.status IN ('ATIVO', 'CONVERTIDO')
       AND e.natureza = 'RECEITA'
       AND (t.eh_adiantamento OR t.adiantamento_id IS NOT NULL)
     ORDER BY e.id
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '  evt % R$ % | plano "%" -> % %',
      rpad('#' || r.id, 8), rpad(to_char(r.valor, 'FM999G999G990D00'), 14),
      r.plano, r.linha,
      CASE WHEN r.linha_natureza IS DISTINCT FROM 'RECEITA'
           THEN '(!! evento RECEITA somando em linha ' || coalesce(r.linha_natureza, '?') || ')'
           ELSE '' END;
    RAISE NOTICE '      %', r.descricao;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhuma. OK';
  ELSE
    v_falhas := v_falhas + 1;
    SELECT coalesce(sum(e.valor), 0) INTO v_total
      FROM public.eventos_financeiros e
      JOIN public.transacao t ON t.id = e.source_id
     WHERE e.source_type = 'TRANSACAO' AND e.status IN ('ATIVO', 'CONVERTIDO')
       AND e.natureza = 'RECEITA'
       AND (t.eh_adiantamento OR t.adiantamento_id IS NOT NULL);
    RAISE NOTICE '  total contado em duplicidade: R$ %', to_char(v_total, 'FM999G999G990D00');
  END IF;

  /* ============================================ 3a. fechamento das VENDAS */

  RAISE NOTICE '';
  RAISE NOTICE '=== 3a. VENDAS: bruto - deducao = valortotal ?';

  CREATE TEMP TABLE _venda_check ON COMMIT DROP AS
  SELECT v.id,
         v.status::text                                       AS status,
         round(coalesce(v.valortotal, 0), 2)                  AS total_doc,
         round(coalesce(v.valor_frete, 0), 2)                 AS frete_venda,
         round(coalesce((SELECT sum(coalesce(vp.valor_frete, 0))
                           FROM public.vendaproduto vp
                          WHERE vp.venda_id = v.id), 0), 2)   AS frete_itens,
         round(coalesce(v.acrescimo_financeiro_valor, 0), 2)  AS acrescimo,
         round(coalesce((SELECT sum(e.valor) FROM public.eventos_financeiros e
                          WHERE e.source_type = 'VENDA' AND e.source_id = v.id
                            AND e.natureza = 'RECEITA'
                            AND e.status IN ('ATIVO','CONVERTIDO')), 0), 2) AS bruto,
         round(coalesce((SELECT sum(e.valor) FROM public.eventos_financeiros e
                          WHERE e.source_type = 'VENDA' AND e.source_id = v.id
                            AND e.natureza_dre = 'DEDUCAO'
                            AND e.status IN ('ATIVO','CONVERTIDO')), 0), 2) AS deducao
    FROM public.venda v
   WHERE public.venda_reconhece_receita(v.status::text);

  SELECT count(*) INTO v_n FROM _venda_check;
  RAISE NOTICE '  vendas reconhecidas: %', v_n;

  SELECT count(*) INTO v_n FROM _venda_check WHERE bruto - deducao <> total_doc;

  IF v_n = 0 THEN
    RAISE NOTICE '  todas fecham. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  % venda(s) NAO fecham:', v_n;
    RAISE NOTICE '%', '  ' || rpad('venda', 8) || rpad('bruto', 14) || rpad('deducao', 12)
                   || rpad('liquido', 14) || rpad('total doc', 14)
                   || rpad('difer.', 12) || 'frete(v+i)  acresc.';
    FOR r IN
      SELECT * FROM _venda_check WHERE bruto - deducao <> total_doc ORDER BY id LIMIT 25
    LOOP
      RAISE NOTICE '%', '  ' || rpad('#' || r.id, 8)
        || rpad(to_char(r.bruto, 'FM999G990D00'), 14)
        || rpad(to_char(r.deducao, 'FM999G990D00'), 12)
        || rpad(to_char(r.bruto - r.deducao, 'FM999G990D00'), 14)
        || rpad(to_char(r.total_doc, 'FM999G990D00'), 14)
        || rpad(to_char(r.bruto - r.deducao - r.total_doc, 'FMS999G990D00'), 12)
        || rpad(to_char(r.frete_venda, 'FM999G990D00') || '+' || to_char(r.frete_itens, 'FM999G990D00'), 12)
        || to_char(r.acrescimo, 'FM999G990D00');
    END LOOP;

    SELECT count(*), sum(total_doc - (bruto - deducao)) INTO v_n, v_total
      FROM _venda_check WHERE bruto - deducao <> total_doc;
    RAISE NOTICE '  receita de venda que nao chega na DRE: R$ % em % venda(s)',
      to_char(coalesce(v_total, 0), 'FM999G999G990D00'), v_n;

    SELECT count(*) INTO v_n FROM _venda_check
     WHERE bruto - deducao <> total_doc
       AND total_doc - (bruto - deducao) = frete_venda + frete_itens + acrescimo;
    RAISE NOTICE '  dessas, % explicadas exatamente por frete + acrescimo', v_n;
  END IF;

  /* =============================================== 3b. fechamento das OS */

  RAISE NOTICE '';
  RAISE NOTICE '=== 3b. ORDENS DE SERVICO: bruto + frete - deducao = orcamentototal ?';

  CREATE TEMP TABLE _os_check ON COMMIT DROP AS
  SELECT o.id,
         o.status::text                                      AS status,
         round(coalesce(o.orcamentototal, 0), 2)             AS total_doc,
         round(coalesce(o.valor_frete, 0), 2)                AS frete_doc,
         round(coalesce(o.acrescimo_financeiro_valor, 0), 2) AS acrescimo,
         round(coalesce(sum(e.valor) FILTER (
                 WHERE e.natureza = 'RECEITA' AND e.origem <> 'FRETE'), 0), 2) AS bruto,
         round(coalesce(sum(e.valor) FILTER (
                 WHERE e.natureza = 'RECEITA' AND e.origem = 'FRETE'), 0), 2)  AS frete_evt,
         round(coalesce(sum(e.valor) FILTER (
                 WHERE e.natureza_dre = 'DEDUCAO'), 0), 2)                     AS deducao
    FROM public.ordemservico o
    JOIN public.eventos_financeiros e ON e.ordemservicoid = o.id
                                     AND e.status IN ('ATIVO','CONVERTIDO')
   WHERE coalesce(o.is_deleted, false) = false
     AND o.execucao_fim_em IS NOT NULL
   GROUP BY o.id, o.status, o.orcamentototal, o.valor_frete, o.acrescimo_financeiro_valor;

  SELECT count(*) INTO v_n FROM _os_check;
  RAISE NOTICE '  OS com execucao encerrada e eventos: %', v_n;

  SELECT count(*) INTO v_n FROM _os_check WHERE bruto + frete_evt - deducao <> total_doc;

  IF v_n = 0 THEN
    RAISE NOTICE '  todas fecham. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  % OS NAO fecham:', v_n;
    RAISE NOTICE '%', '  ' || rpad('os', 8) || rpad('status', 14) || rpad('bruto', 14)
                   || rpad('frete', 11) || rpad('deducao', 12)
                   || rpad('liquido', 14) || rpad('orcamento', 14) || 'difer.';
    FOR r IN
      SELECT * FROM _os_check WHERE bruto + frete_evt - deducao <> total_doc ORDER BY id LIMIT 25
    LOOP
      RAISE NOTICE '%', '  ' || rpad('#' || r.id, 8)
        || rpad(r.status, 14)
        || rpad(to_char(r.bruto, 'FM999G990D00'), 14)
        || rpad(to_char(r.frete_evt, 'FM999G990D00'), 11)
        || rpad(to_char(r.deducao, 'FM999G990D00'), 12)
        || rpad(to_char(r.bruto + r.frete_evt - r.deducao, 'FM999G990D00'), 14)
        || rpad(to_char(r.total_doc, 'FM999G990D00'), 14)
        || to_char(r.bruto + r.frete_evt - r.deducao - r.total_doc, 'FMS999G990D00');
    END LOOP;
  END IF;

  /* ================================= 3c. receita de OS gravada pelo liquido */

  -- Desde a migration 20260802200000 o evento de receita da OS guarda o valor
  -- de TABELA (precounitario * quantidade) e o desconto vira evento proprio.
  -- Evento anterior a isso guardou o liquido e nunca foi reprocessado: com o
  -- evento de DESCONTO criado depois, o desconto passa a ser subtraido duas
  -- vezes. Nenhuma migration reescreve evento existente — so a reconciliacao.

  RAISE NOTICE '';
  RAISE NOTICE '=== 3c. OS COM RECEITA GRAVADA PELO LIQUIDO (evento defasado)';
  RAISE NOTICE '%', '  ' || rpad('os', 8) || rpad('criado em', 13)
                 || rpad('bruto itens', 14) || rpad('bruto evento', 14) || 'tem desconto?';

  v_n := 0;
  FOR r IN
    SELECT o.id,
           min(e.created_at)::date AS criado,
           round(coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                             FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
               + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                             FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
               + coalesce((SELECT sum(coalesce(osv.precounitario, 0) * coalesce(osv.quantidade, 0))
                             FROM public.osservico osv WHERE osv.ordemservicoid = o.id), 0), 2) AS bruto_itens,
           round(coalesce(sum(e.valor) FILTER (
                   WHERE e.natureza = 'RECEITA' AND e.origem <> 'FRETE'), 0), 2) AS bruto_evt,
           count(*) FILTER (WHERE e.origem = 'DESCONTO') AS tem_desconto
      FROM public.ordemservico o
      JOIN public.eventos_financeiros e ON e.ordemservicoid = o.id
                                       AND e.status IN ('ATIVO', 'CONVERTIDO')
     WHERE coalesce(o.is_deleted, false) = false
       AND o.execucao_fim_em IS NOT NULL
     GROUP BY o.id
    HAVING round(coalesce(sum(e.valor) FILTER (
                   WHERE e.natureza = 'RECEITA' AND e.origem <> 'FRETE'), 0), 2)
        <> round(coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                             FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
               + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                             FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
               + coalesce((SELECT sum(coalesce(osv.precounitario, 0) * coalesce(osv.quantidade, 0))
                             FROM public.osservico osv WHERE osv.ordemservicoid = o.id), 0), 2)
     ORDER BY o.id
     LIMIT 25
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '%', '  ' || rpad('#' || r.id, 8) || rpad(r.criado::text, 13)
      || rpad(to_char(r.bruto_itens, 'FM999G990D00'), 14)
      || rpad(to_char(r.bruto_evt, 'FM999G990D00'), 14)
      || CASE WHEN r.tem_desconto > 0 THEN 'SIM — desconto em dobro' ELSE 'nao' END;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhuma. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  corrija com: SELECT public.reconciliar_eventos_financeiros_os(<id>);';
  END IF;

  /* ================================== 4. documento reconhecido sem receita */

  RAISE NOTICE '';
  RAISE NOTICE '=== 4. DOCUMENTO RECONHECIDO SEM RECEITA NO LIVRO';

  SELECT count(*) INTO v_n
    FROM public.venda v
   WHERE public.venda_reconhece_receita(v.status::text)
     AND coalesce(v.valortotal, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.eventos_financeiros e
                      WHERE e.source_type = 'VENDA' AND e.source_id = v.id
                        AND e.natureza = 'RECEITA' AND e.status IN ('ATIVO','CONVERTIDO'));
  RAISE NOTICE '  vendas reconhecidas sem evento de receita: %', v_n;
  IF v_n > 0 THEN v_falhas := v_falhas + 1; END IF;

  -- CANCELADO e SEM_COBRANCA ficam de fora: nos dois a ausencia de receita e o
  -- comportamento correto (migrations 20260802170000 e 20260806250000).
  SELECT count(*) INTO v_n
    FROM public.ordemservico o
   WHERE coalesce(o.is_deleted, false) = false
     AND o.execucao_fim_em IS NOT NULL
     AND o.status::text NOT IN ('CANCELADO', 'SEM_COBRANCA')
     AND coalesce(o.orcamentototal, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM public.eventos_financeiros e
                      WHERE e.ordemservicoid = o.id
                        AND e.natureza = 'RECEITA' AND e.status IN ('ATIVO','CONVERTIDO'));
  RAISE NOTICE '  OS entregues sem evento de receita:       %', v_n;
  IF v_n > 0 THEN v_falhas := v_falhas + 1; END IF;

  /* ========================= 5. a receita como ela chega ao relatorio */

  RAISE NOTICE '';
  RAISE NOTICE '=== 5. RECEITA POR LINHA (todo o historico, via dre_somar_por_linha)';

  FOR r IN
    SELECT dl.codigo, dl.nome, s.valor, s.lancamentos
      FROM public.dre_somar_por_linha(v_template,
             '1900-01-01'::timestamptz, '2999-12-31'::timestamptz) s
      JOIN public.dre_linha dl ON dl.id = s.linha_id
     WHERE dl.natureza_dre IN ('RECEITA', 'DEDUCAO')
     ORDER BY dl.codigo
  LOOP
    RAISE NOTICE '  % % R$ % (% lanc.)',
      rpad(r.codigo, 6), rpad(r.nome, 40),
      to_char(r.valor, 'FM999G999G990D00'), r.lancamentos;
  END LOOP;

  SELECT coalesce(sum(e.valor), 0) INTO v_total
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO','CONVERTIDO')
     AND e.natureza = 'RECEITA'
     AND e.competencia_em IS NOT NULL;

  SELECT coalesce(sum(s.valor), 0) INTO v_linhas
    FROM public.dre_somar_por_linha(v_template,
           '1900-01-01'::timestamptz, '2999-12-31'::timestamptz) s
    JOIN public.dre_linha dl ON dl.id = s.linha_id
   WHERE dl.natureza_dre = 'RECEITA';

  RAISE NOTICE '';
  RAISE NOTICE '  eventos de receita com competencia: R$ %', to_char(v_total, 'FM999G999G990D00');
  RAISE NOTICE '  soma das linhas de receita:         R$ %', to_char(v_linhas, 'FM999G999G990D00');
  IF v_total <> v_linhas THEN
    RAISE NOTICE '  >>> DIVERGE em R$ % — ha receita fora das linhas de receita',
      to_char(v_total - v_linhas, 'FMS999G999G990D00');
    v_falhas := v_falhas + 1;
  ELSE
    RAISE NOTICE '  batem. OK';
  END IF;

  /* ======================== 6. natureza do lancamento x natureza da linha */

  -- `dre_somar_por_linha` soma `e.valor` sem olhar a natureza do lancamento.
  -- Uma despesa classificada numa conta de receita entra SOMANDO receita, e uma
  -- receita numa conta de despesa entra somando despesa. Nada avisa: o numero
  -- sai limpo e errado. A linha e escolhida pelo plano de contas da transacao,
  -- entao um erro de classificacao no financeiro chega aqui invertido.

  RAISE NOTICE '';
  RAISE NOTICE '=== 6. LANCAMENTO COM NATUREZA CONTRARIA A DA LINHA';

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
      rpad(r.codigo, 6), rpad(r.nome, 34), r.linha_natureza,
      r.lancamentos, r.natureza, to_char(r.valor, 'FM999G999G990D00');
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhum. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  a linha vem do plano de contas da transacao: revise a';
    RAISE NOTICE '  classificacao no financeiro, nao o mapeamento da DRE.';
  END IF;

  /* ================================ 7. cobertura do plano de contas */

  -- Cada empresa tem seu proprio plano de contas, e o mapeamento inicial e
  -- semeado por palavra-chave no nome do grupo. O que nao casa fica sem
  -- destino, e lancamento em grupo sem destino gera evento SEM LINHA: nao entra
  -- em total nenhum, nao aparece na tela e nao levanta erro. Some.
  --
  -- E o que mais importa quando entra cliente novo: um grupo chamado "Marketing
  -- e vendas" em vez de "Despesas comerciais" simplesmente nao casa, e o jeito
  -- de descobrir sem este bloco e alguem estranhar o lucro alto demais.

  RAISE NOTICE '';
  RAISE NOTICE '=== 7. COBERTURA DO PLANO DE CONTAS';

  SELECT count(*) INTO v_n FROM public.planosdecontagrupos;
  SELECT count(*) INTO v_linhas
    FROM public.planosdecontagrupos g
    JOIN public.dre_mapeamento mp
      ON mp.origem_tipo = 'PLANO_GRUPO' AND mp.origem_id = g.id
     AND mp.ativo AND mp.template_id = v_template;
  RAISE NOTICE '  grupos: % | com destino: % | sem destino: %',
    v_n, v_linhas, v_n - v_linhas;

  FOR r IN
    SELECT g.nome,
           (SELECT count(*) FROM public.planosdeconta pc WHERE pc.grupo_id = g.id) contas,
           (SELECT count(*) FROM public.transacao t
              JOIN public.planosdeconta pc ON pc.id = t.plano_de_conta_id
             WHERE pc.grupo_id = g.id AND coalesce(t.is_deleted, false) = false) tx
      FROM public.planosdecontagrupos g
     WHERE NOT EXISTS (SELECT 1 FROM public.dre_mapeamento mp
                        WHERE mp.origem_tipo = 'PLANO_GRUPO' AND mp.origem_id = g.id
                          AND mp.ativo AND mp.template_id = v_template)
     ORDER BY 3 DESC, 1
  LOOP
    RAISE NOTICE '  >>> "%" (% contas) sem destino — % transacao(oes) %',
      r.nome, r.contas, r.tx,
      CASE WHEN r.tx = 0 THEN '(latente)' ELSE '<<< PERDENDO DINHEIRO' END;
    v_falhas := v_falhas + 1;
  END LOOP;

  -- O sintoma final: o lancamento existe, tem competencia e nao entra em linha.
  SELECT count(*), coalesce(sum(e.valor), 0) INTO v_n, v_total
    FROM public.eventos_financeiros e
   WHERE e.source_type = 'TRANSACAO'
     AND e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em IS NOT NULL
     AND e.dre_linha_id IS NULL;

  IF v_n = 0 THEN
    RAISE NOTICE '  nenhum lancamento fora de linha. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> % lancamento(s) FORA DA DRE, R$ %:',
      v_n, to_char(v_total, 'FM999G999G990D00');
    FOR r IN
      SELECT e.id, e.valor, e.competencia_em::date AS comp,
             left(coalesce(e.descricao, ''), 44) AS descricao
        FROM public.eventos_financeiros e
       WHERE e.source_type = 'TRANSACAO'
         AND e.status IN ('ATIVO', 'CONVERTIDO')
         AND e.competencia_em IS NOT NULL
         AND e.dre_linha_id IS NULL
       ORDER BY e.valor DESC
       LIMIT 20
    LOOP
      RAISE NOTICE '        #% R$ % % | %',
        rpad(r.id::text, 6), lpad(to_char(r.valor, 'FM999G999G990D00'), 12),
        r.comp, r.descricao;
    END LOOP;
    RAISE NOTICE '        (falta escolher a conta do plano nessas transacoes)';
  END IF;

  -- Mapeamento que o banco aceita e o codigo nunca le. As funcoes so consultam
  -- PLANO_GRUPO e EVENTO_ORIGEM; uma linha PLANO_CONTA fica inerte, e quem a
  -- cadastrou acredita ter classificado — inclusive um `exclui_do_resultado`.
  SELECT count(*) INTO v_n
    FROM public.dre_mapeamento
   WHERE ativo AND origem_tipo IN ('PLANO_CONTA', 'CATEGORIA_TRANSACAO');

  IF v_n > 0 THEN
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> % mapeamento(s) inerte(s) (PLANO_CONTA/CATEGORIA_TRANSACAO):', v_n;
    RAISE NOTICE '      o banco aceita, o codigo nao le — a classificacao nao vale.';
  END IF;

  /* =============================================================== fim */

  RAISE NOTICE '';
  IF v_falhas = 0 THEN
    RAISE NOTICE '=== RESULTADO: receita integra.';
  ELSE
    RAISE NOTICE '=== RESULTADO: % problema(s) na receita.', v_falhas;
  END IF;
  RAISE NOTICE '';

END $t$;

ROLLBACK;
