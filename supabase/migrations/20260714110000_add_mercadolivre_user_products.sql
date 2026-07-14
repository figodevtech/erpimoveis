ALTER TABLE public.mercadolivre_product_link
  ADD COLUMN IF NOT EXISTS user_product_id text,
  ADD COLUMN IF NOT EXISTS family_id text,
  ADD COLUMN IF NOT EXISTS family_name text,
  ADD COLUMN IF NOT EXISTS domain_id text,
  ADD COLUMN IF NOT EXISTS catalog_product_id text,
  ADD COLUMN IF NOT EXISTS user_product_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS item_tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_mercadolivre_product_link_user_product
  ON public.mercadolivre_product_link(empresa_id, user_product_id)
  WHERE user_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_product_link_family
  ON public.mercadolivre_product_link(empresa_id, family_id)
  WHERE family_id IS NOT NULL;
