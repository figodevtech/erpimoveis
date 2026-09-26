-- Separa a troca vinculada à compra da remessa de bem próprio em garantia.
-- A primeira continua exigindo o documento de origem; a segunda não o possui.
UPDATE public.fiscal_nfe_saida_operacao
SET nome = 'Garantia ou troca vinculada à compra', updated_at = now()
WHERE codigo = 'REMESSA_GARANTIA'
  AND nome = 'Remessa em garantia ou troca';

INSERT INTO public.fiscal_nfe_saida_operacao (
  codigo, nome, natureza_operacao, finalidade, cfop_interno,
  cfop_interestadual, exige_documento_referenciado, ordem
) VALUES (
  'REMESSA_BEM_PROPRIO_GARANTIA',
  'Remessa de bem próprio para garantia ou reparo',
  'REMESSA DE BEM PROPRIO PARA GARANTIA OU REPARO',
  'NORMAL', NULL, NULL, false, 55
)
ON CONFLICT (codigo) DO NOTHING;
