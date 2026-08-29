-- O imposto da compra passa a existir na DRE. A mercadoria continua esperando a baixa.
--
-- A regra da casa e que comprar nao e despesa: a compra vira estoque e chega ao
-- resultado como CMV quando o item sai por venda ou por OS. Ela vale para a
-- mercadoria e nao vale para o resto da nota.
--
-- ICMS-ST, FCP-ST, imposto de importacao, IPI devolvido, PIS-ST e COFINS-ST
-- compoem o `vNF`, sao pagos ao fornecedor e nunca viram mercadoria — logo nao
-- tem saida futura para esperar. Ate aqui eles saiam do caixa e nao chegavam a
-- lugar nenhum: contas a pagar registrava o `vNF` inteiro, `entradaitens` gravava
-- menos que isso, e a diferenca evaporava. Numa nota de teste de R$ 5.296,00 sao
-- R$ 236,00 que nao apareciam em relatorio nenhum.
--
-- Aqui essa diferenca vira lancamento em `eventos_financeiros`, na competencia da
-- nota. Tres cuidados que valem registrar:
--
-- 1. NAO HA CONTAGEM DUPLA. A transacao da compra continua fora do resultado —
--    `sincronizar_eventos_financeiros_transacao` cancela quem tem `entrada_id` ou
--    `usoconsumo_entrada_id`. O evento criado aqui e a unica representacao do
--    imposto na DRE, e `pode_gerar_transacao` e false porque o dinheiro ja esta
--    em contas a pagar.
--
-- 2. A COMPETENCIA E A DATA DE EMISSAO, nao o vencimento. E o mesmo eixo que
--    `tg_transacao_competencia_entrada` ja carimba na transacao da compra: sem
--    isso, uma nota de agosto em 10x espalharia o imposto por dez meses.
--
-- 3. O CANCELAMENTO ENCERRA, NAO APAGA. `status = 'CANCELADO'`, como todo o resto
--    do livro. Evento inverso inflaria a contagem de lancamentos do drill-down.
--    Fica num gatilho de `status`, e nao dentro das funcoes de cancelamento, para
--    valer tambem para qualquer caminho futuro que cancele uma entrada — mesma
--    forma de `fiscal_dfe_cancelar_apropriacao_comercial_trg`, na mesma tabela.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O livro passa a aceitar a entrada como fonte
-- ---------------------------------------------------------------------------
-- Dois `source_type` porque `entrada.id` e `usoconsumo_entrada.id` sao sequencias
-- distintas: um valor so colidiria entre os dois estoques.
ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_source_type_check;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_source_type_check
  CHECK (source_type IS NULL OR source_type IN (
    'ORDEM_SERVICO', 'VENDA', 'TRANSACAO', 'MANUAL', 'ENTRADA', 'USOCONSUMO_ENTRADA'));

ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_origem_check;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_origem_check
  CHECK (origem = ANY (ARRAY[
    'PRODUTO', 'SERVICO', 'COMISSAO', 'AVULSO', 'DESCONTO', 'FRETE', 'ENTRADA_FISCAL']));

-- ---------------------------------------------------------------------------
-- 2) Duas linhas novas no template ativo
-- ---------------------------------------------------------------------------
-- Sem versao nova do template: `dre_linha` e unica por (template, codigo) e a
-- arvore se monta por `parent_id`, entao acrescentar linha e dado, nao codigo.
--
-- 4.9 nasce com `sinal = +1` DENTRO de um grupo de `sinal = -1`. Nao e engano:
-- `agregarFilhos` soma os filhos com o sinal de cada um e inverte no grupo, entao
-- um filho positivo ABATE o custo. E o mesmo mecanismo do RESULTADO FINANCEIRO,
-- onde 10.1 soma e 10.2 subtrai.
--
-- E pela mesma razao que ela nasce com `natureza_dre = 'RECEITA'` mesmo morando
-- em CUSTOS: a convencao do template e que a natureza acompanha a direcao do
-- sinal (10.1 RECEITA/+1, 10.2 DESPESA/-1). Sem isso, `checar_receitas_dre.sql`
-- e `checar_custos_dre.sql` acusariam desoneracao como natureza contraria a linha.
WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
linhas(codigo, nome, nivel, ordem, tipo, natureza_dre, sinal) AS (VALUES
  ('4.8', 'Tributos nao recuperaveis sobre compras', 2, 48, 'DETALHE', 'CUSTO', -1),
  ('4.9', 'Recuperacoes e desoneracoes sobre compras', 2, 49, 'DETALHE', 'RECEITA', 1)
)
INSERT INTO public.dre_linha
  (template_id, codigo, nome, nivel, ordem, tipo, natureza_dre, sinal, sem_fonte, permite_manual)
SELECT t.id, l.codigo, l.nome, l.nivel, l.ordem, l.tipo, l.natureza_dre, l.sinal, false, false
  FROM linhas l CROSS JOIN t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_linha d WHERE d.template_id = t.id AND d.codigo = l.codigo);

UPDATE public.dre_linha f
   SET parent_id = p.id
  FROM public.dre_linha p
 WHERE f.template_id = p.template_id
   AND f.parent_id IS NULL
   AND f.codigo IN ('4.8', '4.9')
   AND p.codigo = '4';

WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
regras(origem, natureza, linha_codigo) AS (VALUES
  ('ENTRADA_FISCAL', 'DESPESA', '4.8'),
  ('ENTRADA_FISCAL', 'RECEITA', '4.9')
)
INSERT INTO public.dre_mapeamento (template_id, linha_id, origem_tipo, origem_valor, percentual, observacao)
SELECT t.id, dl.id, 'EVENTO_ORIGEM', r.origem || ':' || r.natureza, 100,
       'Tributo da nota de entrada que nao integra o custo do estoque.'
  FROM regras r CROSS JOIN t
  JOIN public.dre_linha dl ON dl.template_id = t.id AND dl.codigo = r.linha_codigo
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento x
    WHERE x.template_id = t.id AND x.origem_tipo = 'EVENTO_ORIGEM'
      AND x.origem_valor = r.origem || ':' || r.natureza);

-- ---------------------------------------------------------------------------
-- 3) Gravacao dos eventos
-- ---------------------------------------------------------------------------
-- Um evento por TIPO de componente, nao por item: a DRE soma por linha, e o
-- detalhamento por item viaja em `dados_snapshot` para o drill-down. E o que faz
-- `chave_origem = tipo` casar com o indice de idempotencia
-- `eventos_financeiros_fonte_uk`, entao reprocessar a mesma entrada corrige
-- valores em vez de duplicar lancamentos.
CREATE OR REPLACE FUNCTION public.registrar_eventos_dre_entrada(
  p_source_type   text,
  p_source_id     bigint,
  p_competencia   timestamptz,
  p_tributos      jsonb,
  p_user          uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tributo   jsonb;
  v_tipo      text;
  v_natureza  text;
  v_valor     numeric(14,2);
  v_gravados  integer := 0;
BEGIN
  IF p_source_type NOT IN ('ENTRADA', 'USOCONSUMO_ENTRADA') THEN
    RAISE EXCEPTION 'Fonte invalida para lancamento de entrada: %.', p_source_type
      USING ERRCODE = '22023';
  END IF;
  IF p_tributos IS NULL OR jsonb_typeof(p_tributos) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_tributo IN SELECT value FROM jsonb_array_elements(p_tributos) LOOP
    v_tipo     := nullif(btrim(v_tributo->>'tipo'), '');
    v_natureza := upper(coalesce(nullif(btrim(v_tributo->>'natureza'), ''), 'DESPESA'));
    v_valor    := round(coalesce((v_tributo->>'valor')::numeric, 0), 2);

    IF v_tipo IS NULL THEN
      RAISE EXCEPTION 'Tributo da entrada sem tipo.' USING ERRCODE = '22023';
    END IF;
    IF v_natureza NOT IN ('RECEITA', 'DESPESA') THEN
      RAISE EXCEPTION 'Natureza invalida no tributo %: %.', v_tipo, v_natureza
        USING ERRCODE = '22023';
    END IF;
    -- Valor negativo nao existe aqui: o sinal mora na linha da DRE. Zero e
    -- ignorado em vez de virar lancamento vazio no relatorio.
    IF v_valor <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.eventos_financeiros (
      ordemservicoid, source_type, source_id, source_item_id,
      origem, natureza, natureza_dre, chave_origem,
      descricao, detalhe, valor, competencia_em,
      dados_snapshot, pode_gerar_transacao, status, created_by
    ) VALUES (
      NULL, p_source_type, p_source_id, NULL,
      'ENTRADA_FISCAL', v_natureza,
      public.natureza_dre_de_evento('ENTRADA_FISCAL', v_natureza), v_tipo,
      coalesce(nullif(btrim(v_tributo->>'descricao'), ''), v_tipo || ' na compra'),
      nullif(btrim(v_tributo->>'detalhe'), ''),
      v_valor, p_competencia,
      jsonb_build_object('tipo', v_tipo, 'itens', coalesce(v_tributo->'itens', '[]'::jsonb)),
      false, 'ATIVO', p_user
    )
    ON CONFLICT (source_type, source_id, origem, chave_origem, natureza)
      WHERE ordemservicoid IS NULL
    DO UPDATE SET valor          = excluded.valor,
                  descricao      = excluded.descricao,
                  detalhe        = excluded.detalhe,
                  competencia_em = excluded.competencia_em,
                  dados_snapshot = excluded.dados_snapshot,
                  natureza_dre   = excluded.natureza_dre,
                  status         = 'ATIVO',
                  updated_at     = now()
    WHERE public.eventos_financeiros.status <> 'CONVERTIDO';

    v_gravados := v_gravados + 1;
  END LOOP;

  RETURN v_gravados;
END $function$;

COMMENT ON FUNCTION public.registrar_eventos_dre_entrada(text, bigint, timestamptz, jsonb, uuid) IS
  'Lanca na DRE o que a nota de entrada cobrou e nao virou custo de estoque. A mercadoria nao passa por aqui: ela espera a baixa e chega como CMV.';

ALTER FUNCTION public.registrar_eventos_dre_entrada(text, bigint, timestamptz, jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.registrar_eventos_dre_entrada(text, bigint, timestamptz, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_eventos_dre_entrada(text, bigint, timestamptz, jsonb, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4) O caminho de volta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_eventos_dre_entrada(
  p_source_type text,
  p_source_id   bigint
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cancelados integer;
BEGIN
  -- Encerra, nao apaga: o livro guarda o que existiu. CONVERTIDO ficaria de fora
  -- pela razao de sempre, mas nem chega a acontecer aqui — estes eventos nascem
  -- com `pode_gerar_transacao = false`, ja que a compra ja esta em contas a pagar.
  UPDATE public.eventos_financeiros
     SET status = 'CANCELADO', updated_at = now()
   WHERE source_type = p_source_type
     AND source_id = p_source_id
     AND origem = 'ENTRADA_FISCAL'
     AND status = 'ATIVO';

  GET DIAGNOSTICS v_cancelados = ROW_COUNT;
  RETURN v_cancelados;
END $function$;

COMMENT ON FUNCTION public.cancelar_eventos_dre_entrada(text, bigint) IS
  'Encerra os lancamentos de DRE de uma entrada cancelada. Marca CANCELADO em vez de criar evento inverso, para o drill-down nao contar o lancamento duas vezes.';

ALTER FUNCTION public.cancelar_eventos_dre_entrada(text, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancelar_eventos_dre_entrada(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_eventos_dre_entrada(text, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_cancelar_eventos_dre_entrada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'entrada' THEN
    PERFORM public.cancelar_eventos_dre_entrada('ENTRADA', NEW.id);
  ELSE
    PERFORM public.cancelar_eventos_dre_entrada('USOCONSUMO_ENTRADA', NEW.id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS cancelar_eventos_dre_entrada_trg ON public.entrada;
CREATE TRIGGER cancelar_eventos_dre_entrada_trg
  AFTER UPDATE OF status ON public.entrada
  FOR EACH ROW
  WHEN (NEW.status::text = 'CANCELADA' AND OLD.status::text <> 'CANCELADA')
  EXECUTE FUNCTION public.tg_cancelar_eventos_dre_entrada();

DROP TRIGGER IF EXISTS cancelar_eventos_dre_usoconsumo_trg ON public.usoconsumo_entrada;
CREATE TRIGGER cancelar_eventos_dre_usoconsumo_trg
  AFTER UPDATE OF status ON public.usoconsumo_entrada
  FOR EACH ROW
  WHEN (NEW.status = 'CANCELADA' AND OLD.status <> 'CANCELADA')
  EXECUTE FUNCTION public.tg_cancelar_eventos_dre_entrada();

-- ---------------------------------------------------------------------------
-- 5) As duas portas de gravacao chamam o lancamento
-- ---------------------------------------------------------------------------
-- Os tributos viajam dentro de `p_entrada->'tributos'`, e nao num parametro novo:
-- as funcoes leem `p_entrada` por chave nomeada, entao a chave e inerte para quem
-- nao a conhece, e a aridade intacta evita overload ambiguo.

-- Estoque de revenda: o ponto de entrada e o embrulho do nItem, por onde passam
-- tambem `registrar_entrada_comercial_apropriada` e a NF-e mista. Sem tocar no
-- motor de 150 linhas, que nao precisa saber disto.
CREATE OR REPLACE FUNCTION public.registrar_entrada_confirmada(
  p_entrada jsonb,
  p_itens jsonb,
  p_transacoes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_entrada_id bigint;
  v_item record;
  v_entrada_item_id bigint;
  v_numero_item integer;
  v_competencia timestamptz;
BEGIN
  SELECT public.registrar_entrada_confirmada_sem_numero_item(
    p_entrada,
    p_itens,
    p_transacoes
  ) INTO v_result;
  v_entrada_id := (v_result->>'entrada_id')::bigint;

  FOR v_item IN
    SELECT value, ordinality
      FROM jsonb_array_elements(p_itens) WITH ORDINALITY
  LOOP
    v_numero_item := nullif(v_item.value->>'numero_item_fiscal', '')::integer;
    IF v_numero_item IS NOT NULL AND (v_numero_item < 1 OR v_numero_item > 990) THEN
      RAISE EXCEPTION 'O número fiscal do item deve ficar entre 1 e 990.' USING ERRCODE = '22023';
    END IF;

    SELECT id
      INTO v_entrada_item_id
      FROM public.entradaitens
     WHERE entrada_id = v_entrada_id
     ORDER BY id
     OFFSET (v_item.ordinality - 1)
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não foi possível reconciliar os itens da entrada fiscal.' USING ERRCODE = '23514';
    END IF;

    UPDATE public.entradaitens
       SET numero_item_fiscal = v_numero_item
     WHERE id = v_entrada_item_id;
  END LOOP;

  IF p_entrada ? 'tributos' THEN
    SELECT coalesce(data_emissao, created_at) INTO v_competencia
      FROM public.entrada WHERE id = v_entrada_id;
    PERFORM public.registrar_eventos_dre_entrada(
      'ENTRADA', v_entrada_id, v_competencia, p_entrada->'tributos',
      nullif(p_entrada->>'created_by', '')::uuid
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_entrada_confirmada(jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_entrada_confirmada(jsonb, jsonb, jsonb)
  TO service_role;

-- Uso e consumo: mesmo recurso do nItem — renomeia o motor e embrulha, para nao
-- existirem duas copias de 110 linhas que divergem na proxima correcao.
DO $$
BEGIN
  IF to_regprocedure('public.registrar_entrada_usoconsumo_sem_dre(jsonb,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.registrar_entrada_usoconsumo(jsonb, jsonb, jsonb)
      RENAME TO registrar_entrada_usoconsumo_sem_dre;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_entrada_usoconsumo(
  p_entrada jsonb,
  p_itens jsonb,
  p_transacoes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_entrada_id bigint;
  v_competencia timestamptz;
BEGIN
  SELECT public.registrar_entrada_usoconsumo_sem_dre(p_entrada, p_itens, p_transacoes)
    INTO v_result;
  v_entrada_id := (v_result->>'entrada_id')::bigint;

  IF p_entrada ? 'tributos' THEN
    SELECT coalesce(data_emissao, created_at) INTO v_competencia
      FROM public.usoconsumo_entrada WHERE id = v_entrada_id;
    PERFORM public.registrar_eventos_dre_entrada(
      'USOCONSUMO_ENTRADA', v_entrada_id, v_competencia, p_entrada->'tributos',
      nullif(p_entrada->>'created_by', '')::uuid
    );
  END IF;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.registrar_entrada_usoconsumo(jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.registrar_entrada_usoconsumo(jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_entrada_usoconsumo(jsonb, jsonb, jsonb)
  TO service_role;

COMMIT;

-- O PostgREST so enxerga a mudanca depois de recarregar o cache de schema.
NOTIFY pgrst, 'reload schema';
