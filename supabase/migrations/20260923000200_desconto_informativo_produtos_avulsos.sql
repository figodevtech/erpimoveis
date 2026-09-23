-- Anotação exclusiva do avulso. Não substitui desconto_tipo/desconto,
-- não entra nos subtotais e não é transferida para osproduto no vínculo.
ALTER TABLE public.osproduto_avulso
  ADD COLUMN desconto_informativo_tipo public.enum_tipo_desconto_venda,
  ADD COLUMN desconto_informativo numeric(15,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT osproduto_avulso_desconto_informativo_check CHECK (
    desconto_informativo >= 0 AND desconto_informativo < 'Infinity'::numeric
    AND (desconto_informativo_tipo IS NOT NULL OR desconto_informativo = 0)
    AND (desconto_informativo_tipo IS DISTINCT FROM 'PORCENTAGEM' OR desconto_informativo <= 100)
  );

ALTER TABLE public.orcamento_produto_avulso
  ADD COLUMN desconto_informativo_tipo public.enum_tipo_desconto_venda,
  ADD COLUMN desconto_informativo numeric(15,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT orcamento_produto_avulso_desconto_informativo_check CHECK (
    desconto_informativo >= 0 AND desconto_informativo < 'Infinity'::numeric
    AND (desconto_informativo_tipo IS NOT NULL OR desconto_informativo = 0)
    AND (desconto_informativo_tipo IS DISTINCT FROM 'PORCENTAGEM' OR desconto_informativo <= 100)
  );

COMMENT ON COLUMN public.osproduto_avulso.desconto_informativo IS
  'Desconto apenas informativo para impressão individual; não altera totais nem desconto comercial.';
COMMENT ON COLUMN public.orcamento_produto_avulso.desconto_informativo IS
  'Desconto apenas informativo para impressão individual; preservado ao gerar OS, sem alterar totais.';
