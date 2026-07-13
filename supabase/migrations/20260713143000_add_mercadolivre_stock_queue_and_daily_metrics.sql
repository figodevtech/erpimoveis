CREATE TABLE IF NOT EXISTS public.mercadolivre_stock_sync_queue (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  product_link_id bigint NOT NULL REFERENCES public.mercadolivre_product_link(id) ON DELETE CASCADE,
  produto_id integer NOT NULL REFERENCES public.produto(id) ON DELETE CASCADE,
  desired_quantity integer NOT NULL CHECK (desired_quantity >= 0),
  status text NOT NULL DEFAULT 'PENDENTE',
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  locked_at timestamptz,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_link_id)
);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_stock_sync_queue_pending
  ON public.mercadolivre_stock_sync_queue(status, next_retry_at, updated_at);

ALTER TABLE public.mercadolivre_stock_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_enfileirar_estoque_mercadolivre()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.mercadolivre_stock_sync_queue (
    empresa_id,
    product_link_id,
    produto_id,
    desired_quantity,
    status,
    attempts,
    next_retry_at,
    locked_at,
    last_error,
    processed_at,
    updated_at
  )
  SELECT
    link.empresa_id,
    link.id,
    NEW.id,
    GREATEST(COALESCE(NEW.estoque, 0), 0),
    'PENDENTE',
    0,
    NULL,
    NULL,
    NULL,
    NULL,
    now()
  FROM public.mercadolivre_product_link link
  WHERE link.produto_id = NEW.id
  ON CONFLICT (product_link_id) DO UPDATE
    SET desired_quantity = EXCLUDED.desired_quantity,
        status = 'PENDENTE',
        attempts = 0,
        next_retry_at = NULL,
        locked_at = NULL,
        last_error = NULL,
        processed_at = NULL,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enfileirar_estoque_mercadolivre ON public.produto;
CREATE TRIGGER trg_enfileirar_estoque_mercadolivre
AFTER UPDATE OF estoque ON public.produto
FOR EACH ROW
WHEN (OLD.estoque IS DISTINCT FROM NEW.estoque)
EXECUTE FUNCTION public.fn_enfileirar_estoque_mercadolivre();

CREATE OR REPLACE FUNCTION public.fn_enfileirar_novo_vinculo_mercadolivre()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estoque integer;
BEGIN
  SELECT GREATEST(COALESCE(estoque, 0), 0)
    INTO v_estoque
    FROM public.produto
   WHERE id = NEW.produto_id;

  INSERT INTO public.mercadolivre_stock_sync_queue (
    empresa_id,
    product_link_id,
    produto_id,
    desired_quantity,
    status,
    updated_at
  )
  VALUES (
    NEW.empresa_id,
    NEW.id,
    NEW.produto_id,
    COALESCE(v_estoque, 0),
    'PENDENTE',
    now()
  )
  ON CONFLICT (product_link_id) DO UPDATE
    SET desired_quantity = EXCLUDED.desired_quantity,
        status = 'PENDENTE',
        attempts = 0,
        next_retry_at = NULL,
        locked_at = NULL,
        last_error = NULL,
        processed_at = NULL,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enfileirar_novo_vinculo_mercadolivre ON public.mercadolivre_product_link;
CREATE TRIGGER trg_enfileirar_novo_vinculo_mercadolivre
AFTER INSERT ON public.mercadolivre_product_link
FOR EACH ROW
EXECUTE FUNCTION public.fn_enfileirar_novo_vinculo_mercadolivre();

INSERT INTO public.mercadolivre_stock_sync_queue (
  empresa_id,
  product_link_id,
  produto_id,
  desired_quantity,
  status,
  updated_at
)
SELECT
  link.empresa_id,
  link.id,
  link.produto_id,
  GREATEST(COALESCE(produto.estoque, 0), 0),
  'PENDENTE',
  now()
FROM public.mercadolivre_product_link link
JOIN public.produto produto ON produto.id = link.produto_id
ON CONFLICT (product_link_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_reservar_sincronizacao_estoque_ml(
  p_limit integer DEFAULT 30,
  p_product_ids integer[] DEFAULT NULL
)
RETURNS TABLE (
  queue_id bigint,
  empresa_id integer,
  product_link_id bigint,
  produto_id integer,
  desired_quantity integer,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH selected AS (
    SELECT queue.id
      FROM public.mercadolivre_stock_sync_queue queue
     WHERE (
       queue.status IN ('PENDENTE', 'ERRO')
       OR (
         queue.status = 'PROCESSANDO'
         AND (queue.locked_at IS NULL OR queue.locked_at < now() - interval '10 minutes')
       )
     )
       AND (queue.next_retry_at IS NULL OR queue.next_retry_at <= now())
       AND (p_product_ids IS NULL OR queue.produto_id = ANY(p_product_ids))
     ORDER BY queue.updated_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
  )
  UPDATE public.mercadolivre_stock_sync_queue queue
     SET status = 'PROCESSANDO',
         attempts = queue.attempts + 1,
         locked_at = now(),
         last_error = NULL,
         updated_at = now()
    FROM selected
   WHERE queue.id = selected.id
  RETURNING
    queue.id,
    queue.empresa_id,
    queue.product_link_id,
    queue.produto_id,
    queue.desired_quantity,
    queue.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_enfileirar_estoque_mercadolivre() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_enfileirar_novo_vinculo_mercadolivre() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reservar_sincronizacao_estoque_ml(integer, integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reservar_sincronizacao_estoque_ml(integer, integer[]) TO service_role;

CREATE TABLE IF NOT EXISTS public.mercadolivre_listing_metric_daily (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  product_link_id bigint NOT NULL REFERENCES public.mercadolivre_product_link(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  visits integer NOT NULL DEFAULT 0 CHECK (visits >= 0),
  sold_quantity_total integer,
  available_quantity integer,
  raw_metric jsonb NOT NULL DEFAULT '{}'::jsonb,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_link_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_listing_metric_daily_company_date
  ON public.mercadolivre_listing_metric_daily(empresa_id, metric_date);

ALTER TABLE public.mercadolivre_listing_metric_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mercadolivre_product_link
  ADD COLUMN IF NOT EXISTS metrics_history_updated_at timestamptz;
