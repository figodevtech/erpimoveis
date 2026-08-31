-- Controla, por origem e modelo, se a garantia comercial deve ser carregada no
-- texto livre da nota. Todos os flags nascem desligados para preservar o
-- comportamento das empresas que já emitem documentos fiscais.

ALTER TABLE public.nfe_config
  ADD COLUMN IF NOT EXISTS incluir_garantia_venda boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incluir_garantia_os boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.nfe_config.incluir_garantia_venda IS
  'Preenche as observacoes da NF-e/NFC-e deste modelo com a garantia da venda.';

COMMENT ON COLUMN public.nfe_config.incluir_garantia_os IS
  'Preenche as observacoes da NF-e/NFC-e deste modelo com a garantia da ordem de servico.';

ALTER TABLE public.nfse_config
  ADD COLUMN IF NOT EXISTS incluir_garantia_os boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.nfse_config.incluir_garantia_os IS
  'Preenche as informacoes complementares da NFS-e com a garantia da ordem de servico.';
