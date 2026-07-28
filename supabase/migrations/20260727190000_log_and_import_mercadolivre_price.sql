CREATE TABLE IF NOT EXISTS public.mercadolivre_price_sync_log (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  product_link_id bigint REFERENCES public.mercadolivre_product_link(id) ON DELETE SET NULL,
  produto_id integer REFERENCES public.produto(id) ON DELETE SET NULL,
  notification_id bigint REFERENCES public.mercadolivre_notification(id) ON DELETE SET NULL,
  ml_item_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('ERP_PARA_ML', 'ML_PARA_ERP')),
  source text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSANDO', 'SUCESSO', 'SEM_ALTERACAO', 'ERRO')),
  erp_price_before numeric,
  erp_price_after numeric,
  ml_price_before numeric,
  ml_price_after numeric,
  message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_price_sync_log_empresa_created
  ON public.mercadolivre_price_sync_log(empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_price_sync_log_item_created
  ON public.mercadolivre_price_sync_log(ml_item_id, created_at DESC);

ALTER TABLE public.mercadolivre_price_sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mercadolivre_price_sync_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_aplicar_preco_mercadolivre_no_erp(
  p_product_link_id bigint,
  p_price numeric,
  p_source text DEFAULT 'WEBHOOK',
  p_notification_id bigint DEFAULT NULL,
  p_ml_price_before numeric DEFAULT NULL
)
RETURNS TABLE(changed boolean, log_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.mercadolivre_product_link%ROWTYPE;
  v_old_price numeric;
  v_changed boolean;
  v_log_id bigint;
BEGIN
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Preço inválido recebido do Mercado Livre.';
  END IF;

  SELECT *
    INTO v_link
    FROM public.mercadolivre_product_link
   WHERE id = p_product_link_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vínculo Mercado Livre % não encontrado.', p_product_link_id;
  END IF;

  SELECT precovenda
    INTO v_old_price
    FROM public.produto
   WHERE id = v_link.produto_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto % não encontrado.', v_link.produto_id;
  END IF;

  v_changed := v_old_price IS DISTINCT FROM p_price;

  IF v_changed THEN
    UPDATE public.produto
       SET precovenda = p_price,
           updatedat = now()
     WHERE id = v_link.produto_id;
  END IF;

  -- O UPDATE do produto pode acionar o trigger ERP -> ML. Como esta alteração
  -- veio do próprio Mercado Livre, neutralizamos a fila dentro da transação.
  UPDATE public.mercadolivre_stock_sync_queue
     SET status = 'PROCESSADA',
         locked_at = NULL,
         next_retry_at = NULL,
         last_error = NULL,
         processed_at = now(),
         updated_at = now()
   WHERE product_link_id = v_link.id;

  INSERT INTO public.mercadolivre_price_sync_log (
    empresa_id,
    product_link_id,
    produto_id,
    notification_id,
    ml_item_id,
    direction,
    source,
    status,
    erp_price_before,
    erp_price_after,
    ml_price_before,
    ml_price_after,
    message,
    completed_at
  )
  VALUES (
    v_link.empresa_id,
    v_link.id,
    v_link.produto_id,
    p_notification_id,
    v_link.ml_item_id,
    'ML_PARA_ERP',
    COALESCE(NULLIF(btrim(p_source), ''), 'WEBHOOK'),
    CASE WHEN v_changed THEN 'SUCESSO' ELSE 'SEM_ALTERACAO' END,
    v_old_price,
    p_price,
    p_ml_price_before,
    p_price,
    CASE
      WHEN v_changed THEN 'Preço do ERP atualizado a partir do Mercado Livre.'
      ELSE 'ERP e Mercado Livre já possuíam o mesmo preço.'
    END,
    now()
  )
  RETURNING id INTO v_log_id;

  RETURN QUERY SELECT v_changed, v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_aplicar_preco_mercadolivre_no_erp(bigint, numeric, text, bigint, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_preco_mercadolivre_no_erp(bigint, numeric, text, bigint, numeric)
  TO service_role;
