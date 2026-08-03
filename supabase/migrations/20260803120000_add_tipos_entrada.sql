-- Cadastro de tipos de entrada (produto e uso/consumo), no mesmo formato ja usado
-- por tipos_motivo_saida: a lista deixa de viver hard-coded no enum do banco, no
-- service e no front, e passa a ser mantida pelo modulo de tipos.
--
-- Alem de nome/escopo/ativo, cada tipo carrega `exige_valor`: quando true, a
-- entrada so e aceita com valor unitario maior que zero. E o que hoje diferencia
-- COMPRA_FORNECEDOR de DEVOLUCAO (que pode entrar com valor zero).
BEGIN;

CREATE TABLE IF NOT EXISTS public.tipos_entrada (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  escopo text NOT NULL DEFAULT 'AMBOS',
  exige_valor boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  createdat timestamp with time zone NOT NULL DEFAULT now(),
  updatedat timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tipos_entrada_codigo_unique UNIQUE (codigo),
  CONSTRAINT tipos_entrada_escopo_check CHECK (escopo IN ('PRODUTO', 'USOCONSUMO', 'AMBOS'))
);

COMMENT ON COLUMN public.tipos_entrada.codigo IS
  'Valor gravado em entrada.tipo / usoconsumo_entrada.tipo. Imutavel apos a criacao.';
COMMENT ON COLUMN public.tipos_entrada.exige_valor IS
  'true: a entrada exige valor unitario maior que zero. false: aceita valor zero (devolucao/retorno).';

GRANT ALL ON TABLE public.tipos_entrada TO anon;
GRANT ALL ON TABLE public.tipos_entrada TO authenticated;
GRANT ALL ON TABLE public.tipos_entrada TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.tipos_entrada_id_seq TO anon, authenticated, service_role;

-- Seed com exatamente os tres tipos que hoje existem no enum enum_tipos_entrada,
-- preservando os codigos ja gravados nas entradas historicas.
INSERT INTO public.tipos_entrada (codigo, nome, escopo, exige_valor) VALUES
  ('COMPRA_FORNECEDOR', 'Compra fornecedor', 'AMBOS', true),
  ('COMPRA_PF', 'Compra PF', 'AMBOS', true),
  ('DEVOLUCAO', 'Devolução / retorno', 'AMBOS', false)
ON CONFLICT (codigo) DO NOTHING;

-- entrada.tipo era o enum public.enum_tipos_entrada: com tipos cadastraveis, um
-- codigo novo nunca caberia no enum. Vira text e a validacao passa a ser dinamica
-- (trigger abaixo), mesma escolha feita em estoque_saida.motivo.
-- O type enum_tipos_entrada nao e removido de proposito: pode haver outras
-- colunas/assinaturas legadas apontando para ele.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entrada'
      AND column_name = 'tipo' AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.entrada ALTER COLUMN tipo DROP DEFAULT;
    ALTER TABLE public.entrada ALTER COLUMN tipo TYPE text USING tipo::text;
    ALTER TABLE public.entrada ALTER COLUMN tipo SET DEFAULT 'COMPRA_FORNECEDOR';
  END IF;
END $$;

-- A lista fixa do uso/consumo tambem sai: quem valida agora e o trigger.
ALTER TABLE public.usoconsumo_entrada DROP CONSTRAINT IF EXISTS usoconsumo_entrada_tipo_check;

CREATE OR REPLACE FUNCTION public.validar_tipo_entrada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_escopo text := TG_ARGV[0];
  v_tipo text := upper(btrim(coalesce(NEW.tipo, '')));
BEGIN
  IF v_tipo = '' THEN
    RAISE EXCEPTION 'Informe o tipo da entrada.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tipos_entrada
    WHERE codigo = v_tipo AND ativo AND escopo IN (v_escopo, 'AMBOS')
  ) THEN
    RAISE EXCEPTION 'Tipo de entrada invalido: %.', v_tipo USING ERRCODE = '22023';
  END IF;
  NEW.tipo := v_tipo;
  RETURN NEW;
END;
$$;

-- Somente BEFORE INSERT: cancelamento e demais updates nao mexem em tipo, e
-- validar no update travaria entradas antigas gravadas com codigos ja removidos.
DROP TRIGGER IF EXISTS entrada_valida_tipo ON public.entrada;
CREATE TRIGGER entrada_valida_tipo
  BEFORE INSERT ON public.entrada
  FOR EACH ROW EXECUTE FUNCTION public.validar_tipo_entrada('PRODUTO');

DROP TRIGGER IF EXISTS usoconsumo_entrada_valida_tipo ON public.usoconsumo_entrada;
CREATE TRIGGER usoconsumo_entrada_valida_tipo
  BEFORE INSERT ON public.usoconsumo_entrada
  FOR EACH ROW EXECUTE FUNCTION public.validar_tipo_entrada('USOCONSUMO');

-- Recriada apenas para remover o cast `::public.enum_tipos_entrada` do INSERT
-- (linha do `tipo`). O restante e identico a 20260731180000_add_entrada_observacao.
CREATE OR REPLACE FUNCTION public.registrar_entrada_confirmada(p_entrada jsonb, p_itens jsonb, p_transacoes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entrada_id bigint;
  v_item jsonb;
  v_item_id bigint;
  v_produto public.produto%ROWTYPE;
  v_produto_id integer;
  v_quantidade integer;
  v_custo numeric(14,4);
  v_desconto numeric(14,2);
  v_frete numeric(14,2);
  v_outras numeric(14,2);
  v_total_item numeric(14,2);
  v_total numeric(14,2) := 0;
  v_total_documento numeric(14,2) := nullif(p_entrada->>'valor_total_documento', '')::numeric;
  v_total_financeiro numeric(14,2) := 0;
  v_transacao jsonb;
  v_chave text := nullif(regexp_replace(coalesce(p_entrada->>'notachave', ''), '\D', '', 'g'), '');
  v_fiscal boolean := coalesce((p_entrada->>'fiscal')::boolean, false);
  v_origem text := coalesce(nullif(p_entrada->>'origem', ''), 'MANUAL');
  v_created_by uuid := nullif(p_entrada->>'created_by', '')::uuid;
BEGIN
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item para a entrada.' USING ERRCODE = '22023';
  END IF;

  IF v_origem NOT IN ('AJUSTE_RAPIDO', 'MANUAL', 'NFE_TERCEIRO') THEN
    RAISE EXCEPTION 'Origem da entrada inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_total_documento IS NOT NULL AND v_total_documento < 0 THEN
    RAISE EXCEPTION 'O total do documento fiscal não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF v_fiscal AND (v_chave IS NULL OR length(v_chave) <> 44) THEN
    RAISE EXCEPTION 'A entrada fiscal exige uma chave de acesso com 44 dígitos.' USING ERRCODE = '22023';
  END IF;
  IF v_fiscal AND nullif(p_entrada->>'fornecedorid', '') IS NULL THEN
    RAISE EXCEPTION 'A entrada fiscal exige um fornecedor vinculado.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.entrada (
    fornecedorid, fiscal, notachave, tipo, status, origem,
    numero_nota, serie_nota, data_emissao, fiscal_dfe_documento_id, valor_total,
    created_by, observacao
  ) VALUES (
    nullif(p_entrada->>'fornecedorid', '')::integer,
    v_fiscal,
    v_chave,
    coalesce(nullif(p_entrada->>'tipo', ''), 'COMPRA_FORNECEDOR'),
    'CONFIRMADA'::public.enum_status_entrada,
    v_origem,
    nullif(p_entrada->>'numero_nota', ''),
    nullif(p_entrada->>'serie_nota', ''),
    nullif(p_entrada->>'data_emissao', '')::timestamp with time zone,
    nullif(p_entrada->>'fiscal_dfe_documento_id', '')::bigint,
    0,
    v_created_by,
    nullif(btrim(coalesce(p_entrada->>'observacao', '')), '')
  ) RETURNING id INTO v_entrada_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    v_produto_id := nullif(v_item->>'produto_id', '')::integer;
    v_quantidade := nullif(v_item->>'quantidade', '')::integer;
    v_custo := nullif(v_item->>'valor_unitario_compra', '')::numeric;
    v_desconto := coalesce(nullif(v_item->>'valor_desconto', '')::numeric, 0);
    v_frete := coalesce(nullif(v_item->>'valor_frete', '')::numeric, 0);
    v_outras := coalesce(nullif(v_item->>'outras_despesas', '')::numeric, 0);

    IF v_produto_id IS NULL OR v_quantidade IS NULL OR v_quantidade <= 0 THEN
      RAISE EXCEPTION 'Produto e quantidade inteira positiva são obrigatórios.' USING ERRCODE = '22023';
    END IF;
    IF v_custo IS NULL OR v_custo < 0 OR v_desconto < 0 OR v_frete < 0 OR v_outras < 0 THEN
      RAISE EXCEPTION 'Os valores de compra do item são inválidos.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_produto FROM public.produto WHERE id = v_produto_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id USING ERRCODE = 'P0002';
    END IF;

    v_total_item := round((v_quantidade * v_custo) - v_desconto + v_frete + v_outras, 2);
    IF v_total_item < 0 THEN
      RAISE EXCEPTION 'O total do item não pode ser negativo.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.entradaitens (
      entrada_id, produto_id, quantidade, precovenda, unidade,
      valor_unitario_compra, valor_desconto, valor_frete, outras_despesas, valor_total,
      ncm, cest, csosn, referencia, titulo, "cClassTrib", "cstIbs", "cstCbs",
      cst, aliquotaicms, cfop, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins
    ) VALUES (
      v_entrada_id, v_produto_id, v_quantidade, coalesce(v_produto.precovenda, 0),
      coalesce(nullif(v_item->>'unidade', '')::public.unidade_medida, v_produto.unidade, 'UN'),
      v_custo, v_desconto, v_frete, v_outras, v_total_item,
      coalesce(nullif(v_item->>'ncm', ''), v_produto.ncm),
      coalesce(nullif(v_item->>'cest', ''), v_produto.cest),
      coalesce(nullif(v_item->>'csosn', ''), v_produto.csosn),
      coalesce(nullif(v_item->>'referencia', ''), v_produto.referencia),
      coalesce(nullif(v_item->>'titulo', ''), v_produto.titulo),
      coalesce(nullif(v_item->>'cClassTrib', ''), v_produto."cClassTrib"),
      coalesce(nullif(v_item->>'cstIbs', ''), v_produto."cstIbs"),
      coalesce(nullif(v_item->>'cstCbs', ''), v_produto."cstCbs"),
      coalesce(nullif(v_item->>'cst', ''), v_produto.cst),
      coalesce(nullif(v_item->>'aliquotaicms', '')::numeric, v_produto.aliquotaicms),
      coalesce(nullif(v_item->>'cfop', ''), v_produto.cfop),
      coalesce(nullif(v_item->>'cst_pis', ''), v_produto.cst_pis),
      coalesce(nullif(v_item->>'aliquota_pis', '')::numeric, v_produto.aliquota_pis),
      coalesce(nullif(v_item->>'cst_cofins', ''), v_produto.cst_cofins),
      coalesce(nullif(v_item->>'aliquota_cofins', '')::numeric, v_produto.aliquota_cofins)
    ) RETURNING id INTO v_item_id;

    UPDATE public.produto
    SET estoque = coalesce(estoque, 0) + v_quantidade,
        ultimovalordecompra = v_custo,
        updatedat = now()
    WHERE id = v_produto_id;

    INSERT INTO public.estoque_movimento_entrada (
      entrada_id, entrada_item_id, produto_id, tipo, quantidade,
      saldo_anterior, saldo_resultante, valor_unitario_compra
    ) VALUES (
      v_entrada_id, v_item_id, v_produto_id, 'ENTRADA', v_quantidade,
      coalesce(v_produto.estoque, 0), coalesce(v_produto.estoque, 0) + v_quantidade, v_custo
    );

    v_total := v_total + v_total_item;
  END LOOP;

  UPDATE public.entrada
  SET valor_total = round(coalesce(v_total_documento, v_total), 2)
  WHERE id = v_entrada_id;

  IF p_transacoes IS NOT NULL AND jsonb_typeof(p_transacoes) = 'array'
     AND jsonb_array_length(p_transacoes) > 0 THEN
    SELECT round(coalesce(sum((value->>'valor')::numeric), 0), 2)
      INTO v_total_financeiro
    FROM jsonb_array_elements(p_transacoes);
    IF v_total_financeiro <> round(coalesce(v_total_documento, v_total), 2) THEN
      RAISE EXCEPTION 'A soma dos lançamentos financeiros (%) difere do total da entrada (%).',
        v_total_financeiro, round(coalesce(v_total_documento, v_total), 2) USING ERRCODE = '22023';
    END IF;

    FOR v_transacao IN SELECT value FROM jsonb_array_elements(p_transacoes)
    LOOP
      IF coalesce((v_transacao->>'valor')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'O valor do lançamento financeiro deve ser positivo.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.transacao (
        descricao, valor, "valorLiquido", data, metodopagamento, categoria, categoria_id,
        tipo, cliente_id, banco_id, nomepagador, cpfcnpjpagador, pendente,
        plano_de_conta_id, plano_de_conta, centro_custo_id, centro_custo, entrada_id
      ) VALUES (
        coalesce(nullif(v_transacao->>'descricao', ''), 'Compra de mercadorias'),
        (v_transacao->>'valor')::numeric,
        (v_transacao->>'valor')::numeric,
        coalesce(nullif(v_transacao->>'data', '')::timestamp with time zone, now()),
        nullif(v_transacao->>'metodopagamento', '')::public.metodo_pagamento,
        coalesce(nullif(v_transacao->>'categoria', ''), 'NÃO RELACIONADO'),
        nullif(v_transacao->>'categoria_id', '')::integer,
        'DESPESA'::public.tipos_transacao,
        NULL,
        nullif(v_transacao->>'banco_id', '')::bigint,
        coalesce(nullif(v_transacao->>'nomepagador', ''), 'Fornecedor'),
        coalesce(nullif(regexp_replace(v_transacao->>'cpfcnpjpagador', '\D', '', 'g'), ''), 'NÃO INFORMADO'),
        coalesce((v_transacao->>'pendente')::boolean, false),
        nullif(v_transacao->>'plano_de_conta_id', '')::integer,
        nullif(v_transacao->>'plano_de_conta', ''),
        nullif(v_transacao->>'centro_custo_id', '')::integer,
        nullif(v_transacao->>'centro_custo', ''),
        v_entrada_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'entrada_id', v_entrada_id,
    'valor_total', round(coalesce(v_total_documento, v_total), 2)
  );
END;
$function$;

COMMIT;
