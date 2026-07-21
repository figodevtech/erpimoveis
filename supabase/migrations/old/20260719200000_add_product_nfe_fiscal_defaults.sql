ALTER TABLE public.produto
  ADD COLUMN IF NOT EXISTS modo_pis text,
  ADD COLUMN IF NOT EXISTS aliquota_por_unidade_pis numeric,
  ADD COLUMN IF NOT EXISTS modo_cofins text,
  ADD COLUMN IF NOT EXISTS aliquota_por_unidade_cofins numeric,
  ADD COLUMN IF NOT EXISTS rtc_habilitado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cst_ibscbs text,
  ADD COLUMN IF NOT EXISTS cclass_trib text,
  ADD COLUMN IF NOT EXISTS aliquota_ibs_uf numeric,
  ADD COLUMN IF NOT EXISTS aliquota_ibs_municipio numeric,
  ADD COLUMN IF NOT EXISTS aliquota_cbs numeric;

ALTER TABLE public.produto
  DROP CONSTRAINT IF EXISTS produto_modo_pis_check,
  DROP CONSTRAINT IF EXISTS produto_modo_cofins_check,
  DROP CONSTRAINT IF EXISTS produto_cst_ibscbs_check,
  DROP CONSTRAINT IF EXISTS produto_cclass_trib_check,
  DROP CONSTRAINT IF EXISTS produto_fiscal_rates_nonnegative_check;

ALTER TABLE public.produto
  ADD CONSTRAINT produto_modo_pis_check
    CHECK (modo_pis IS NULL OR modo_pis IN ('PERCENTUAL', 'QUANTIDADE', 'NAO_TRIBUTADO')),
  ADD CONSTRAINT produto_modo_cofins_check
    CHECK (modo_cofins IS NULL OR modo_cofins IN ('PERCENTUAL', 'QUANTIDADE', 'NAO_TRIBUTADO')),
  ADD CONSTRAINT produto_cst_ibscbs_check
    CHECK (cst_ibscbs IS NULL OR cst_ibscbs ~ '^\d{3}$'),
  ADD CONSTRAINT produto_cclass_trib_check
    CHECK (cclass_trib IS NULL OR cclass_trib ~ '^\d{6}$'),
  ADD CONSTRAINT produto_fiscal_rates_nonnegative_check
    CHECK (
      COALESCE(aliquota_por_unidade_pis, 0) >= 0
      AND COALESCE(aliquota_por_unidade_cofins, 0) >= 0
      AND COALESCE(aliquota_ibs_uf, 0) >= 0
      AND COALESCE(aliquota_ibs_municipio, 0) >= 0
      AND COALESCE(aliquota_cbs, 0) >= 0
    );

COMMENT ON COLUMN public.produto.modo_pis IS
  'Modo padrão de cálculo do PIS para novos itens de NF-e; pode ser sobrescrito no rascunho.';
COMMENT ON COLUMN public.produto.modo_cofins IS
  'Modo padrão de cálculo da COFINS para novos itens de NF-e; pode ser sobrescrito no rascunho.';
COMMENT ON COLUMN public.produto.cclass_trib IS
  'Classificação IBS/CBS padrão do produto; deve ser revalidada na tabela oficial vigente na emissão.';
