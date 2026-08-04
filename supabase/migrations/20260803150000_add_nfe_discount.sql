-- Desconto na NF-e.
--
-- O desconto ja existia em dois niveis na origem (item e geral da OS/venda),
-- mas se perdia na emissao: o motor gravava <vDesc>0.00</vDesc> e a nota saia
-- pelo valor bruto. Agora cada item leva seu desconto incondicional em
-- nfe_item.valor_desconto (soma do desconto do proprio item com a parcela do
-- desconto geral rateada para ele) e a nota consolida em nfe.valor_desconto.
--
-- nfe_item.valor_desconto ja existia como coluna nullable e nunca preenchida;
-- aqui ela ganha default 0 e guarda de nao-negativo, no mesmo padrao de
-- valor_frete.
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

-- total_nfe passa a seguir o vNF do leiaute 4.00:
-- vProd - vDesc + vFrete. total_produtos segue sendo o bruto, para a nota
-- continuar mostrando preco de tabela e abatimento em separado.
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
