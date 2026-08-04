-- Desconto na NF-e.
-- Mantem os descontos dos itens e o desconto geral rateado na emissao.
BEGIN;

ALTER TABLE public.nfe
  ADD COLUMN IF NOT EXISTS valor_desconto numeric(14,2) NOT NULL DEFAULT 0;

UPDATE public.nfe_item SET valor_desconto = 0 WHERE valor_desconto IS NULL;

ALTER TABLE public.nfe_item
  ALTER COLUMN valor_desconto SET DEFAULT 0;

ALTER TABLE public.nfe_item
  ALTER COLUMN valor_desconto SET NOT NULL;

ALTER TABLE public.nfe DROP CONSTRAINT IF EXISTS nfe_valor_desconto_nonnegative;
ALTER TABLE public.nfe
  ADD CONSTRAINT nfe_valor_desconto_nonnegative CHECK (valor_desconto >= 0);

ALTER TABLE public.nfe_item DROP CONSTRAINT IF EXISTS nfe_item_valor_desconto_valido;
ALTER TABLE public.nfe_item
  ADD CONSTRAINT nfe_item_valor_desconto_valido
  CHECK (valor_desconto >= 0 AND valor_desconto <= valor_total);

CREATE OR REPLACE FUNCTION public.atualizar_totais_nfe(p_nfe_id bigint)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.nfe
  SET
    total_produtos = coalesce((
      SELECT sum(ni.valor_total) FROM public.nfe_item ni WHERE ni.nfe_id = nfe.id
    ), 0),
    valor_frete = coalesce((
      SELECT sum(ni.valor_frete) FROM public.nfe_item ni WHERE ni.nfe_id = nfe.id
    ), 0),
    valor_desconto = coalesce((
      SELECT sum(ni.valor_desconto) FROM public.nfe_item ni WHERE ni.nfe_id = nfe.id
    ), 0),
    total_nfe = coalesce((
      SELECT sum(ni.valor_total - ni.valor_desconto + ni.valor_frete)
        FROM public.nfe_item ni WHERE ni.nfe_id = nfe.id
    ), 0),
    updatedat = now()
  WHERE id = p_nfe_id;
$$;

COMMIT;
