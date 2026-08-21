-- Uma NF-e de saída pode documentar várias baixas físicas que vieram da mesma
-- nota de entrada. A baixa continua unitária; esta tabela é somente o elo
-- fiscal, por item, entre o documento emitido e cada saída confirmada.
BEGIN;

ALTER TABLE public.entradaitens
  ADD COLUMN IF NOT EXISTS numero_item_fiscal integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.entradaitens'::regclass
       AND conname = 'entradaitens_numero_item_fiscal_check'
  ) THEN
    ALTER TABLE public.entradaitens
      ADD CONSTRAINT entradaitens_numero_item_fiscal_check
      CHECK (numero_item_fiscal IS NULL OR numero_item_fiscal BETWEEN 1 AND 990);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS entradaitens_entrada_numero_fiscal_idx
  ON public.entradaitens(entrada_id, numero_item_fiscal)
  WHERE numero_item_fiscal IS NOT NULL;

-- Preserva o motor transacional atual e o envolve apenas para guardar o nItem
-- que já chega no JSON. Isso evita copiar centenas de linhas da função de
-- estoque e reduz o risco de ela divergir das correções anteriores.
DO $$
BEGIN
  IF to_regprocedure('public.registrar_entrada_confirmada_sem_numero_item(jsonb,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.registrar_entrada_confirmada(jsonb, jsonb, jsonb)
      RENAME TO registrar_entrada_confirmada_sem_numero_item;
  END IF;
END;
$$;

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

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_entrada_confirmada(jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_entrada_confirmada(jsonb, jsonb, jsonb)
  TO service_role;

-- Nas entradas fiscais anteriores, a apropriação foi gravada na mesma ordem do
-- array que criou `entradaitens`. Usa essa ordem apenas para recuperar nItem de
-- linhas ainda vazias; nenhum valor já confirmado é sobrescrito.
WITH linhas_entrada AS (
  SELECT id,
         entrada_id,
         row_number() OVER (PARTITION BY entrada_id ORDER BY id) AS ordem
    FROM public.entradaitens
),
linhas_apropriadas AS (
  SELECT entrada_id,
         numero_item,
         row_number() OVER (PARTITION BY entrada_id ORDER BY id) AS ordem
    FROM public.fiscal_dfe_item_apropriacao
   WHERE destino = 'PRODUTO'
     AND entrada_id IS NOT NULL
     AND cancelada_at IS NULL
)
UPDATE public.entradaitens item
   SET numero_item_fiscal = apropriacao.numero_item
  FROM linhas_entrada linha
  JOIN linhas_apropriadas apropriacao
    ON apropriacao.entrada_id = linha.entrada_id
   AND apropriacao.ordem = linha.ordem
 WHERE item.id = linha.id
   AND item.numero_item_fiscal IS NULL;

CREATE TABLE IF NOT EXISTS public.nfe_saida_item_vinculo (
  nfe_id bigint NOT NULL REFERENCES public.nfe(id) ON DELETE CASCADE,
  saida_id bigint NOT NULL REFERENCES public.estoque_saida(id) ON DELETE RESTRICT,
  saida_item_id bigint NOT NULL REFERENCES public.estoque_saida_item(id) ON DELETE RESTRICT,
  entrada_item_origem_id bigint REFERENCES public.entradaitens(id) ON DELETE RESTRICT,
  quantidade numeric(14,4) NOT NULL CHECK (quantidade > 0),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (nfe_id, saida_item_id)
);

CREATE INDEX IF NOT EXISTS nfe_saida_item_vinculo_saida_idx
  ON public.nfe_saida_item_vinculo(saida_id, nfe_id);

CREATE INDEX IF NOT EXISTS nfe_saida_item_vinculo_entrada_idx
  ON public.nfe_saida_item_vinculo(entrada_item_origem_id)
  WHERE entrada_item_origem_id IS NOT NULL;

-- Protege inclusive rascunhos: enquanto a nota ocupar a saída, a mesma baixa
-- não pode ser escolhida por outro rascunho concorrente.
CREATE UNIQUE INDEX IF NOT EXISTS nfe_saida_item_vinculo_item_ativo_idx
  ON public.nfe_saida_item_vinculo(saida_item_id)
  WHERE ativo;

CREATE OR REPLACE FUNCTION public.nfe_saida_item_vinculo_validar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_modelo text;
  v_status text;
  v_excluida boolean;
  v_saida_id bigint;
  v_produto_id integer;
  v_quantidade numeric;
  v_entrada_produto_id integer;
BEGIN
  SELECT modelo::text, status::text, coalesce(is_deleted, false)
    INTO v_modelo, v_status, v_excluida
    FROM public.nfe
   WHERE id = NEW.nfe_id;

  IF NOT FOUND OR v_modelo <> 'NFE' THEN
    RAISE EXCEPTION 'O vínculo de saída exige uma NF-e existente.' USING ERRCODE = '23514';
  END IF;

  SELECT saida_id, produto_id, quantidade
    INTO v_saida_id, v_produto_id, v_quantidade
    FROM public.estoque_saida_item
   WHERE id = NEW.saida_item_id;

  IF NOT FOUND OR v_saida_id <> NEW.saida_id THEN
    RAISE EXCEPTION 'O item não pertence à saída informada.' USING ERRCODE = '23514';
  END IF;

  IF round(NEW.quantidade, 4) <> round(v_quantidade, 4) THEN
    RAISE EXCEPTION 'A quantidade fiscal deve corresponder à baixa da saída.' USING ERRCODE = '23514';
  END IF;

  IF NEW.entrada_item_origem_id IS NOT NULL THEN
    SELECT produto_id
      INTO v_entrada_produto_id
      FROM public.entradaitens
     WHERE id = NEW.entrada_item_origem_id;
    IF NOT FOUND OR v_entrada_produto_id <> v_produto_id THEN
      RAISE EXCEPTION 'A entrada fiscal vinculada pertence a outro produto.' USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.ativo := NOT v_excluida AND v_status IN (
    'RASCUNHO', 'ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO',
    'CONTINGENCIA', 'RESULTADO_INCERTO'
  );
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfe_saida_item_vinculo_validar
  ON public.nfe_saida_item_vinculo;
CREATE TRIGGER trg_nfe_saida_item_vinculo_validar
BEFORE INSERT OR UPDATE OF nfe_id, saida_id, saida_item_id, entrada_item_origem_id, quantidade
ON public.nfe_saida_item_vinculo
FOR EACH ROW
EXECUTE FUNCTION public.nfe_saida_item_vinculo_validar();

CREATE OR REPLACE FUNCTION public.nfe_saida_item_vinculo_sincronizar_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.nfe_saida_item_vinculo
     SET ativo = NOT coalesce(NEW.is_deleted, false) AND NEW.status::text IN (
           'RASCUNHO', 'ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO',
           'CONTINGENCIA', 'RESULTADO_INCERTO'
         ),
         updated_at = now()
   WHERE nfe_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfe_saida_item_vinculo_sincronizar_status ON public.nfe;
CREATE TRIGGER trg_nfe_saida_item_vinculo_sincronizar_status
AFTER UPDATE OF status, is_deleted ON public.nfe
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_deleted IS DISTINCT FROM NEW.is_deleted)
EXECUTE FUNCTION public.nfe_saida_item_vinculo_sincronizar_status();

-- Substitui todos os vínculos do rascunho numa única transação. As travas são
-- obtidas sempre na mesma ordem para duas emissões concorrentes não cruzarem.
CREATE OR REPLACE FUNCTION public.vincular_nfe_saidas(
  p_nfe_id bigint,
  p_itens jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_nfe_saida_id bigint;
  v_nfe_modelo text;
  v_nfe_excluida boolean;
BEGIN
  IF p_nfe_id IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe a NF-e e ao menos um item de saída.' USING ERRCODE = '22023';
  END IF;

  SELECT saidaid, modelo::text, coalesce(is_deleted, false)
    INTO v_nfe_saida_id, v_nfe_modelo, v_nfe_excluida
    FROM public.nfe
   WHERE id = p_nfe_id
   FOR UPDATE;

  IF NOT FOUND OR v_nfe_modelo <> 'NFE' OR v_nfe_excluida THEN
    RAISE EXCEPTION 'NF-e inválida para vínculo com saídas.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_itens) item
     WHERE nullif(item->>'saida_id', '')::bigint = v_nfe_saida_id
  ) THEN
    RAISE EXCEPTION 'A saída principal da NF-e precisa estar entre os itens.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('nfe:saida-item:%s', ids.saida_item_id), 0)
  )
  FROM (
    SELECT DISTINCT nullif(item->>'saida_item_id', '')::bigint AS saida_item_id
      FROM jsonb_array_elements(p_itens) item
     ORDER BY 1
  ) ids;

  DELETE FROM public.nfe_saida_item_vinculo WHERE nfe_id = p_nfe_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO public.nfe_saida_item_vinculo (
      nfe_id, saida_id, saida_item_id, entrada_item_origem_id, quantidade
    ) VALUES (
      p_nfe_id,
      nullif(v_item->>'saida_id', '')::bigint,
      nullif(v_item->>'saida_item_id', '')::bigint,
      nullif(v_item->>'entrada_item_origem_id', '')::bigint,
      nullif(v_item->>'quantidade', '')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object(
    'nfe_id', p_nfe_id,
    'saidas', (SELECT count(DISTINCT saida_id) FROM public.nfe_saida_item_vinculo WHERE nfe_id = p_nfe_id),
    'itens', (SELECT count(*) FROM public.nfe_saida_item_vinculo WHERE nfe_id = p_nfe_id)
  );
END;
$$;

ALTER TABLE public.nfe_saida_item_vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfe_saida_item_vinculo FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.nfe_saida_item_vinculo TO service_role;
REVOKE ALL ON FUNCTION public.vincular_nfe_saidas(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_nfe_saidas(bigint, jsonb) TO service_role;

COMMIT;
