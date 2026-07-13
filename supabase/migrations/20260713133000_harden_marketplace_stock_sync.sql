CREATE OR REPLACE FUNCTION public.fn_sincronizar_baixa_estoque_marketplace(
  p_venda_id integer,
  p_produto_id integer,
  p_quantidade_alvo integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estoque integer;
  v_quantidade_atual integer := 0;
  v_delta integer;
BEGIN
  IF p_venda_id IS NULL OR p_venda_id <= 0 OR p_produto_id IS NULL OR p_produto_id <= 0 THEN
    RAISE EXCEPTION 'Venda e produto são obrigatórios.';
  END IF;
  IF p_quantidade_alvo IS NULL OR p_quantidade_alvo < 0 THEN
    RAISE EXCEPTION 'Quantidade alvo inválida.';
  END IF;

  SELECT estoque
    INTO v_estoque
    FROM public.produto
   WHERE id = p_produto_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto % não encontrado.', p_produto_id;
  END IF;

  SELECT quantidade
    INTO v_quantidade_atual
    FROM public.vendaproduto_baixa
   WHERE venda_id = p_venda_id
     AND produtoid = p_produto_id
   FOR UPDATE;

  v_quantidade_atual := COALESCE(v_quantidade_atual, 0);
  v_delta := p_quantidade_alvo - v_quantidade_atual;

  IF v_delta > 0 THEN
    IF v_estoque < v_delta THEN
      RAISE EXCEPTION 'Estoque insuficiente para produto %, em estoque: %, necessário: %',
        p_produto_id, v_estoque, v_delta;
    END IF;

    UPDATE public.produto
       SET estoque = estoque - v_delta,
           updatedat = now()
     WHERE id = p_produto_id;
  ELSIF v_delta < 0 THEN
    UPDATE public.produto
       SET estoque = estoque + abs(v_delta),
           updatedat = now()
     WHERE id = p_produto_id;
  END IF;

  IF p_quantidade_alvo = 0 THEN
    DELETE FROM public.vendaproduto_baixa
     WHERE venda_id = p_venda_id
       AND produtoid = p_produto_id;
  ELSE
    INSERT INTO public.vendaproduto_baixa (venda_id, produtoid, quantidade, created_at, updated_at)
    VALUES (p_venda_id, p_produto_id, p_quantidade_alvo, now(), now())
    ON CONFLICT (venda_id, produtoid) DO UPDATE
      SET quantidade = EXCLUDED.quantidade,
          updated_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sincronizar_baixa_estoque_marketplace(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_sincronizar_baixa_estoque_marketplace(integer, integer, integer) TO service_role;

ALTER TABLE public.mercadolivre_order
  ADD COLUMN IF NOT EXISTS import_status text DEFAULT 'PENDENTE' NOT NULL,
  ADD COLUMN IF NOT EXISTS import_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_error text;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_import_status
  ON public.mercadolivre_order(import_status, import_locked_at);

UPDATE public.mercadolivre_order
SET import_status = 'IMPORTADA',
    import_locked_at = NULL,
    import_error = NULL
WHERE venda_id IS NOT NULL
  AND import_status <> 'IMPORTADA';

CREATE OR REPLACE FUNCTION public.fn_reservar_importacao_mercadolivre(
  p_ml_order_id bigint,
  p_empresa_id integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  UPDATE public.mercadolivre_order
     SET import_status = 'PROCESSANDO',
         import_locked_at = now(),
         import_error = NULL,
         updated_at = now()
   WHERE ml_order_id = p_ml_order_id
     AND empresa_id = p_empresa_id
     AND venda_id IS NULL
     AND (
       import_status IN ('PENDENTE', 'ERRO')
       OR (
         import_status = 'PROCESSANDO'
         AND (import_locked_at IS NULL OR import_locked_at < now() - interval '10 minutes')
       )
     );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reservar_importacao_mercadolivre(bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reservar_importacao_mercadolivre(bigint, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_criar_venda_mercadolivre_reservada(
  p_ml_order_id bigint,
  p_empresa_id integer,
  p_venda jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda_id integer;
  v_import_status text;
BEGIN
  SELECT venda_id, import_status
    INTO v_venda_id, v_import_status
    FROM public.mercadolivre_order
   WHERE ml_order_id = p_ml_order_id
     AND empresa_id = p_empresa_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido Mercado Livre % não encontrado.', p_ml_order_id;
  END IF;

  IF v_venda_id IS NOT NULL THEN
    RETURN v_venda_id;
  END IF;

  IF v_import_status <> 'PROCESSANDO' THEN
    RAISE EXCEPTION 'Pedido Mercado Livre % não está reservado para importação.', p_ml_order_id;
  END IF;

  v_venda_id := public.fn_criar_venda_marketplace_com_itens(p_venda);

  UPDATE public.mercadolivre_order
     SET venda_id = v_venda_id,
         import_status = 'IMPORTADA',
         import_locked_at = NULL,
         import_error = NULL,
         updated_at = now()
   WHERE ml_order_id = p_ml_order_id
     AND empresa_id = p_empresa_id;

  RETURN v_venda_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_criar_venda_mercadolivre_reservada(bigint, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_criar_venda_mercadolivre_reservada(bigint, integer, jsonb) TO service_role;
