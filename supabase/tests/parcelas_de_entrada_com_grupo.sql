-- Teste de 20261021120000: parcelas gravadas pelos motores de entrada nascem
-- com grupo e podem ser reparceladas.
--
-- Como rodar (aplica as migrations pendentes e reverte tudo):
--   npm run db:test:parcelas-de-entrada
--   npm run db:test:parcelas-de-entrada -- demir
BEGIN;

DO $test$
DECLARE
  v_fornecedor bigint;
  v_autor uuid;
  v_produto integer;
  v_item integer;
  v_resultado jsonb;
  v_uso bigint;
  v_entrada bigint;
  v_posterior bigint;
  v_grupo bigint;
  v_grupos_antes bigint;
  v_qtd int;
  v_soma numeric;
  v_p1 bigint;
  v_base text;
BEGIN
  SELECT id INTO v_fornecedor FROM public.fornecedor ORDER BY id LIMIT 1;
  SELECT id INTO v_autor FROM public.usuario ORDER BY id LIMIT 1;
  IF v_autor IS NULL THEN RAISE EXCEPTION 'Teste exige usuário.'; END IF;
  -- Banco recém-provisionado pode não ter fornecedor; o ROLLBACK leva este junto.
  IF v_fornecedor IS NULL THEN
    INSERT INTO public.fornecedor (cpfcnpj, nomerazaosocial)
    VALUES ('00000000000191', 'FORNECEDOR TESTE PARCELAS') RETURNING id INTO v_fornecedor;
  END IF;

  /* -------- uso e consumo em 3x, pelo motor (o caso da NF 22555) -------- */
  SELECT id INTO v_item FROM public.criar_item_usoconsumo(jsonb_build_object(
    'titulo', 'TESTE PARCELAS COM GRUPO', 'escopo', 'GERAL', 'precocompra', 0), 0, v_autor);
  v_resultado := public.registrar_entrada_usoconsumo(
    jsonb_build_object('fornecedor_id', v_fornecedor, 'tipo', 'COMPRA_FORNECEDOR',
      'origem', 'MANUAL', 'escopo', 'GERAL', 'created_by', v_autor),
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantidade', 1, 'valor_unitario_compra', 990.50)),
    jsonb_build_array(
      jsonb_build_object('descricao', 'Compra NF 99001 - Parcela 1/3', 'valor', 330.17,
        'data', now() + interval '30 days', 'pendente', true, 'categoria', 'DESPESAS OPERACIONAIS'),
      jsonb_build_object('descricao', 'Compra NF 99001 - Parcela 2/3', 'valor', 330.17,
        'data', now() + interval '60 days', 'pendente', true, 'categoria', 'DESPESAS OPERACIONAIS'),
      jsonb_build_object('descricao', 'Compra NF 99001 - Parcela 3/3', 'valor', 330.16,
        'data', now() + interval '90 days', 'pendente', true, 'categoria', 'DESPESAS OPERACIONAIS')));
  v_uso := (v_resultado->>'entrada_id')::bigint;

  SELECT count(*), count(DISTINCT parcelamento_id), min(parcelamento_id), count(*) FILTER (WHERE parcelamento_id IS NULL)
    INTO v_qtd, v_soma, v_grupo, v_p1
    FROM public.transacao WHERE usoconsumo_entrada_id = v_uso AND NOT is_deleted;
  IF v_qtd <> 3 OR v_soma <> 1 OR v_p1 <> 0 THEN
    RAISE EXCEPTION 'Uso e consumo: esperava 3 parcelas num grupo só (linhas %, grupos %, sem grupo %).', v_qtd, v_soma, v_p1;
  END IF;
  SELECT descricao INTO v_base FROM public.transacao_parcelamento WHERE id = v_grupo;
  IF v_base IS DISTINCT FROM 'Compra NF 99001' THEN
    RAISE EXCEPTION 'Descrição do grupo deveria ser a base sem sufixo, veio %.', v_base;
  END IF;
  RAISE NOTICE 'ok: motor de uso e consumo agrupa as 3 parcelas (grupo %)', v_grupo;

  /* -------- e o grupo aceita reparcelar: 3x vira 2x, total igual -------- */
  SELECT min(id) INTO v_p1 FROM public.transacao WHERE parcelamento_id = v_grupo;
  PERFORM public.reparcelar_transacao(v_p1, jsonb_build_array(
    jsonb_build_object('valor', 495.25, 'data', now() + interval '30 days'),
    jsonb_build_object('valor', 495.25, 'data', now() + interval '60 days')));
  SELECT count(*), sum(valor) INTO v_qtd, v_soma
    FROM public.transacao WHERE parcelamento_id = v_grupo AND NOT is_deleted;
  IF v_qtd <> 2 OR v_soma <> 990.50 THEN
    RAISE EXCEPTION 'Reparcelamento: esperava 2 parcelas somando 990,50 (veio % somando %).', v_qtd, v_soma;
  END IF;
  RAISE NOTICE 'ok: reparcelamento aceito no grupo da entrada';

  /* -------- produto em 2x, pagas, e o estorno do cancelamento -------- */
  -- O default de grupo_produto_id aponta para um catálogo que banco provisionado
  -- pode não ter: usa um grupo que exista.
  INSERT INTO public.produto(titulo, precovenda, estoque, grupo_produto_id)
  VALUES ('TESTE PARCELAS COM GRUPO', 200, 0, (SELECT min(id) FROM public.produtogrupo))
    RETURNING id INTO v_produto;
  v_resultado := public.registrar_entrada_confirmada(
    jsonb_build_object('fornecedorid', v_fornecedor, 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'MANUAL', 'created_by', v_autor),
    jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1, 'valor_unitario_compra', 100)),
    jsonb_build_array(
      jsonb_build_object('descricao', 'Compra NF 99002 - Parcela 1/2', 'valor', 50, 'data', now(), 'pendente', false,
        'categoria', 'DESPESAS OPERACIONAIS'),
      jsonb_build_object('descricao', 'Compra NF 99002 - Parcela 2/2', 'valor', 50, 'data', now(), 'pendente', false,
        'categoria', 'DESPESAS OPERACIONAIS')));
  v_entrada := (v_resultado->>'entrada_id')::bigint;
  SELECT count(DISTINCT parcelamento_id), count(*) FILTER (WHERE parcelamento_id IS NULL)
    INTO v_qtd, v_p1 FROM public.transacao WHERE entrada_id = v_entrada AND NOT is_deleted;
  IF v_qtd <> 1 OR v_p1 <> 0 THEN
    RAISE EXCEPTION 'Produto: esperava as 2 parcelas num grupo (grupos %, sem grupo %).', v_qtd, v_p1;
  END IF;
  RAISE NOTICE 'ok: motor de produto agrupa as 2 parcelas';

  PERFORM public.cancelar_entrada_confirmada(v_entrada, 'Teste de estorno', v_autor);
  SELECT count(*), count(*) FILTER (WHERE parcelamento_id IS NOT NULL) INTO v_qtd, v_p1
    FROM public.transacao WHERE entrada_id = v_entrada AND estorno_transacao_id IS NOT NULL;
  IF v_qtd <> 2 OR v_p1 <> 0 THEN
    RAISE EXCEPTION 'Estorno: esperava 2 estornos sem grupo (estornos %, com grupo %).', v_qtd, v_p1;
  END IF;
  RAISE NOTICE 'ok: estorno do cancelamento não ganha grupo';

  /* -------- lançamento à vista: nada a agrupar -------- */
  v_resultado := public.registrar_entrada_confirmada(
    jsonb_build_object('fornecedorid', v_fornecedor, 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'MANUAL', 'created_by', v_autor),
    jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1, 'valor_unitario_compra', 80)),
    jsonb_build_array(jsonb_build_object('descricao', 'Compra NF 99003', 'valor', 80, 'data', now(),
      'pendente', true, 'categoria', 'DESPESAS OPERACIONAIS')));
  IF EXISTS (SELECT 1 FROM public.transacao WHERE entrada_id = (v_resultado->>'entrada_id')::bigint
              AND parcelamento_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Lançamento à vista ganhou grupo.';
  END IF;
  RAISE NOTICE 'ok: lançamento à vista continua sem grupo';

  /* -------- lançamento posterior: o grupo é o que a função já cria -------- */
  v_resultado := public.registrar_entrada_confirmada(
    jsonb_build_object('fornecedorid', v_fornecedor, 'tipo', 'COMPRA_FORNECEDOR', 'origem', 'MANUAL', 'created_by', v_autor),
    jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 1, 'valor_unitario_compra', 60)),
    '[]'::jsonb);
  v_posterior := (v_resultado->>'entrada_id')::bigint;
  SELECT count(*) INTO v_grupos_antes FROM public.transacao_parcelamento;
  PERFORM public.registrar_financeiro_entrada('produto', v_posterior, jsonb_build_array(
      jsonb_build_object('descricao', 'Compra NF 99004 - Parcela 1/2', 'valor', 30, 'data', now(), 'categoria', 'DESPESAS OPERACIONAIS',
        'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO'),
      jsonb_build_object('descricao', 'Compra NF 99004 - Parcela 2/2', 'valor', 30, 'data', now(), 'categoria', 'DESPESAS OPERACIONAIS',
        'nomepagador', 'Fornecedor teste', 'cpfcnpjpagador', 'NAO INFORMADO')),
    NULL, v_autor);
  SELECT count(DISTINCT parcelamento_id), count(*) FILTER (WHERE parcelamento_id IS NULL)
    INTO v_qtd, v_p1 FROM public.transacao WHERE entrada_id = v_posterior AND NOT is_deleted;
  IF v_qtd <> 1 OR v_p1 <> 0 OR (SELECT count(*) FROM public.transacao_parcelamento) <> v_grupos_antes + 1 THEN
    RAISE EXCEPTION 'Lançamento posterior: esperava exatamente um grupo novo (grupos %, sem grupo %).', v_qtd, v_p1;
  END IF;
  RAISE NOTICE 'ok: lançamento posterior mantém um grupo só';

  /* -------- o backfill não deixou parcela de entrada para trás -------- */
  SELECT count(*) INTO v_qtd
    FROM (
      SELECT 1 FROM public.transacao
       WHERE is_deleted = false AND parcelamento_id IS NULL
         AND descricao ~ ' - Parcela [0-9]+/[0-9]+$'
         AND (entrada_id IS NOT NULL OR usoconsumo_entrada_id IS NOT NULL)
         AND estorno_transacao_id IS NULL AND ordemservicoid IS NULL AND vendaid IS NULL
         AND pagamento_multiplo_id IS NULL AND evento_financeiro_id IS NULL
         AND adiantamento_id IS NULL AND transferencia_id IS NULL
         AND coalesce(eh_adiantamento, false) = false
       GROUP BY entrada_id, usoconsumo_entrada_id,
                regexp_replace(descricao, ' - Parcela [0-9]+/([0-9]+)$', ' - Parcela /\1')
      HAVING count(*) > 1
    ) restantes;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'Backfill deixou % grupo(s) de parcelas de entrada sem registro.', v_qtd;
  END IF;
  RAISE NOTICE 'ok: nenhuma parcela de entrada agrupável ficou sem grupo';

  IF has_function_privilege('anon', 'public.tg_transacao_agrupar_parcelas_de_entrada()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_transacao_agrupar_parcelas_de_entrada()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Função do gatilho executável por anon/authenticated.';
  END IF;
END;
$test$;

ROLLBACK;
