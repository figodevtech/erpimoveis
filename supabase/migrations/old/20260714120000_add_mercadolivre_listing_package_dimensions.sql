ALTER TABLE public.mercadolivre_product_link
  ADD COLUMN IF NOT EXISTS package_length_cm numeric,
  ADD COLUMN IF NOT EXISTS package_width_cm numeric,
  ADD COLUMN IF NOT EXISTS package_height_cm numeric,
  ADD COLUMN IF NOT EXISTS package_weight_grams integer;
