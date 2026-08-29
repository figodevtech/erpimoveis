-- O imposto da compra chega a DRE, a mercadoria nao — e o cancelamento desfaz.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/checar_tributos_entrada_dre.sql demo
--
-- Diferente dos outros dois arquivos desta pasta, este NAO confere dados que ja
-- existem: ele grava uma entrada de teste, mede, cancela e mede de novo. Tudo
-- dentro da transacao, e o ROLLBACK no fim desfaz inclusive a entrada.
--
-- As tres perguntas:
--
--   IDA        o tributo virou lancamento na linha 4.8, e a mercadoria nao virou
--              lancamento nenhum?
--   IDEMPOTENCIA  reprocessar a mesma entrada corrige valor em vez de duplicar?
--   VOLTA      cancelar a entrada encerra os lancamentos e zera a linha?

BEGIN;

DO $t$
DECLARE
  v_falhas      integer := 0;
  v_template    integer;
  v_linha_48    integer;
  v_linha_49    integer;
  v_produto     integer;
  v_fornecedor  integer;
  v_entrada_id  bigint;
  v_result      jsonb;
  v_eventos     integer;
  v_valor       numeric;
  v_de          timestamptz := date_trunc('month', now());
  v_ate         timestamptz := date_trunc('month', now()) + interval '1 month' - interval '1 second';
  v_tributos    jsonb := jsonb_build_array(
    jsonb_build_object(
      'tipo', 'ICMS_ST', 'natureza', 'DESPESA', 'valor', 124.34,
      'descricao', 'ICMS-ST na compra',
      'detalhe', 'retido pelo fornecedor; nao integra o estoque',
      'itens', jsonb_build_array(jsonb_build_object('numeroItem', 1, 'valor', 124.34))),
    jsonb_build_object(
      'tipo', 'ICMS_DESONERADO', 'natureza', 'RECEITA', 'valor', 10.00,
      'descricao', 'ICMS desonerado na compra', 'detalhe', 'desoneracao concedida',
      'itens', jsonb_build_array(jsonb_build_object('numeroItem', 1, 'valor', 10.00)))
  );
BEGIN

  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC, id DESC LIMIT 1;
  SELECT id INTO v_linha_48 FROM public.dre_linha WHERE template_id = v_template AND codigo = '4.8';
  SELECT id INTO v_linha_49 FROM public.dre_linha WHERE template_id = v_template AND codigo = '4.9';

  RAISE NOTICE '';
  RAISE NOTICE '=== 0. AS LINHAS EXISTEM E ESTAO MAPEADAS';

  IF v_linha_48 IS NULL OR v_linha_49 IS NULL THEN
    RAISE NOTICE '  >>> faltam as linhas 4.8/4.9 no template ativo. Migration nao aplicada?';
    v_falhas := v_falhas + 1;
  ELSE
    RAISE NOTICE '  4.8 id=%  4.9 id=%  OK', v_linha_48, v_linha_49;
  END IF;

  FOR v_valor IN
    SELECT 1 FROM (VALUES ('DESPESA'), ('RECEITA')) AS n(nat)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.dre_mapeamento mp
        WHERE mp.template_id = v_template AND mp.ativo
          AND mp.origem_tipo = 'EVENTO_ORIGEM'
          AND mp.origem_valor = 'ENTRADA_FISCAL:' || n.nat)
  LOOP
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> falta mapeamento EVENTO_ORIGEM para ENTRADA_FISCAL';
  END LOOP;

  /* ================================================== 1. grava a entrada */

  SELECT id INTO v_produto FROM public.produto WHERE coalesce(is_deleted, false) = false ORDER BY id LIMIT 1;
  SELECT id INTO v_fornecedor FROM public.fornecedor ORDER BY id LIMIT 1;

  IF v_produto IS NULL THEN
    RAISE NOTICE '';
    RAISE NOTICE '  >>> banco sem produto: nao da para gravar a entrada de teste.';
    RAISE NOTICE '=== RESULTADO: teste inconclusivo.';
    RETURN;
  END IF;

  SELECT public.registrar_entrada_confirmada(
    jsonb_build_object(
      'fornecedorid', v_fornecedor,
      'fiscal', false,
      'tipo', 'COMPRA_FORNECEDOR',
      'origem', 'MANUAL',
      'data_emissao', to_char(v_de + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'observacao', 'Teste automatizado de tributos na DRE',
      'tributos', v_tributos),
    jsonb_build_array(jsonb_build_object(
      'produto_id', v_produto, 'quantidade', 1,
      'valor_unitario_compra', 334.00, 'unidade', 'UN')),
    '[]'::jsonb
  ) INTO v_result;

  v_entrada_id := (v_result->>'entrada_id')::bigint;

  RAISE NOTICE '';
  RAISE NOTICE '=== 1. IDA: o tributo virou lancamento, a mercadoria nao';
  RAISE NOTICE '  entrada #% gravada, valor_total R$ %',
    v_entrada_id, to_char((v_result->>'valor_total')::numeric, 'FM999G999G990D00');

  SELECT count(*), coalesce(sum(valor), 0) INTO v_eventos, v_valor
    FROM public.eventos_financeiros
   WHERE source_type = 'ENTRADA' AND source_id = v_entrada_id AND status = 'ATIVO';

  IF v_eventos = 2 AND v_valor = 134.34 THEN
    RAISE NOTICE '  2 lancamentos, R$ 134,34 no total. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> esperado 2 lancamentos somando 134,34; veio % somando %',
      v_eventos, to_char(v_valor, 'FM999G999G990D00');
  END IF;

  -- A mercadoria de R$ 334,00 nao pode ter virado evento: ela vira estoque e so
  -- chega ao resultado como CMV quando o item sair.
  SELECT count(*) INTO v_eventos
    FROM public.eventos_financeiros
   WHERE source_type = 'ENTRADA' AND source_id = v_entrada_id
     AND origem <> 'ENTRADA_FISCAL';

  IF v_eventos = 0 THEN
    RAISE NOTICE '  nenhum lancamento para a mercadoria. OK — comprar nao e despesa.';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> % lancamento(s) de mercadoria na compra. A compra virou despesa.', v_eventos;
  END IF;

  -- A transacao da compra continua fora do resultado: e o que impede a contagem
  -- dupla entre contas a pagar e este lancamento.
  SELECT count(*) INTO v_eventos
    FROM public.eventos_financeiros e
    JOIN public.transacao t ON t.id = e.source_id AND e.source_type = 'TRANSACAO'
   WHERE t.entrada_id = v_entrada_id AND e.status IN ('ATIVO', 'CONVERTIDO');

  IF v_eventos = 0 THEN
    RAISE NOTICE '  a transacao da compra segue fora do resultado. OK — sem contagem dupla.';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> % evento(s) vindos da transacao da compra: contagem dupla.', v_eventos;
  END IF;

  /* ======================================== 2. cai na linha certa da DRE */

  RAISE NOTICE '';
  RAISE NOTICE '=== 2. O LANCAMENTO CAI NA LINHA 4.8 / 4.9';

  SELECT coalesce(sum(s.valor), 0) INTO v_valor
    FROM public.dre_somar_por_linha(v_template, v_de, v_ate) s
   WHERE s.linha_id = v_linha_48;
  RAISE NOTICE '  4.8 no mes: R$ %', to_char(v_valor, 'FM999G999G990D00');
  IF v_valor < 124.34 THEN
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> a linha 4.8 nao recebeu os R$ 124,34.';
  END IF;

  SELECT coalesce(sum(s.valor), 0) INTO v_valor
    FROM public.dre_somar_por_linha(v_template, v_de, v_ate) s
   WHERE s.linha_id = v_linha_49;
  RAISE NOTICE '  4.9 no mes: R$ %', to_char(v_valor, 'FM999G999G990D00');
  IF v_valor < 10.00 THEN
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> a linha 4.9 nao recebeu os R$ 10,00.';
  END IF;

  /* ============================================== 3. reprocesso e idempotente */

  RAISE NOTICE '';
  RAISE NOTICE '=== 3. REPROCESSAR CORRIGE, NAO DUPLICA';

  PERFORM public.registrar_eventos_dre_entrada(
    'ENTRADA', v_entrada_id, v_de + interval '1 day',
    jsonb_build_array(jsonb_build_object(
      'tipo', 'ICMS_ST', 'natureza', 'DESPESA', 'valor', 130.00,
      'descricao', 'ICMS-ST na compra', 'detalhe', 'valor corrigido',
      'itens', '[]'::jsonb)),
    NULL);

  SELECT count(*), coalesce(sum(valor), 0) INTO v_eventos, v_valor
    FROM public.eventos_financeiros
   WHERE source_type = 'ENTRADA' AND source_id = v_entrada_id
     AND chave_origem = 'ICMS_ST' AND status = 'ATIVO';

  IF v_eventos = 1 AND v_valor = 130.00 THEN
    RAISE NOTICE '  segue 1 lancamento de ICMS-ST, agora R$ 130,00. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> esperado 1 lancamento de 130,00; veio % somando %',
      v_eventos, to_char(v_valor, 'FM999G999G990D00');
  END IF;

  /* ==================================================== 4. o caminho de volta */

  RAISE NOTICE '';
  RAISE NOTICE '=== 4. VOLTA: cancelar a entrada encerra os lancamentos';

  PERFORM public.cancelar_entrada_confirmada(
    v_entrada_id, 'Cancelamento do teste automatizado', NULL);

  SELECT count(*) INTO v_eventos
    FROM public.eventos_financeiros
   WHERE source_type = 'ENTRADA' AND source_id = v_entrada_id AND status = 'ATIVO';

  IF v_eventos = 0 THEN
    RAISE NOTICE '  nenhum lancamento ativo apos o cancelamento. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> % lancamento(s) sobreviveram ao cancelamento.', v_eventos;
  END IF;

  -- Encerra, nao apaga: o livro guarda o que existiu.
  SELECT count(*) INTO v_eventos
    FROM public.eventos_financeiros
   WHERE source_type = 'ENTRADA' AND source_id = v_entrada_id AND status = 'CANCELADO';

  IF v_eventos = 2 THEN
    RAISE NOTICE '  os 2 lancamentos continuam no livro como CANCELADO. OK';
  ELSE
    v_falhas := v_falhas + 1;
    RAISE NOTICE '  >>> esperados 2 lancamentos CANCELADO; ha %.', v_eventos;
  END IF;

  SELECT coalesce(sum(s.valor), 0) INTO v_valor
    FROM public.dre_somar_por_linha(v_template, v_de, v_ate) s
   WHERE s.linha_id IN (v_linha_48, v_linha_49);
  RAISE NOTICE '  4.8 + 4.9 no mes, depois do cancelamento: R$ %',
    to_char(v_valor, 'FM999G999G990D00');

  /* =============================================================== fim */

  RAISE NOTICE '';
  IF v_falhas = 0 THEN
    RAISE NOTICE '=== RESULTADO: ida e volta integras.';
  ELSE
    RAISE NOTICE '=== RESULTADO: % ponto(s) de atencao.', v_falhas;
  END IF;
  RAISE NOTICE '';

END $t$;

ROLLBACK;
