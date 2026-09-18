-- nfe_item passa a espelhar o grupo ICMS que foi para o XML.
--
-- Até aqui valor_bc_icms e valor_icms eram gravados sempre que o item tinha
-- alíquota, sem olhar o CST. Na NF-e 136 (CST 60, grupo ICMS60) o banco
-- guardou ICMS próprio de R$ 2.200 que o XML autorizado, corretamente, não
-- tem. Agora o núcleo de ICMS (src/lib/nfe/icms) decide o grupo e o que ele
-- contém, e estas colunas guardam exatamente o que foi serializado:
--
--   aliquotaicms, valor_bc_icms, valor_icms  ICMS próprio (pICMS, vBC, vICMS)
--   valor_bc_icms_st, valor_icms_st          ST retida nesta operação
--   valor_fcp, valor_fcp_st                  FCP próprio e FCP-ST
--   valor_*_st_retido                        ST cobrada anteriormente (ICMS60/SN500)
--   valor_icms_desonerado, valor_icms_diferido
--
-- NULL quer dizer "o grupo não tem esse campo". A alíquota do cadastro que não
-- entrou no cálculo fica em tributacao_snapshot.icmsDecisao.camposIgnorados.
--
-- Os CHECK são NOT VALID: notas já emitidas não são validadas nem alteradas
-- (grupo_icms_xml fica NULL nelas). Toda linha nova ou regravada é conferida,
-- de modo que nenhum caminho de gravação volta a produzir o estado da NF-e 136.
BEGIN;

ALTER TABLE public.nfe_item
  ADD COLUMN IF NOT EXISTS grupo_icms_xml text,
  ADD COLUMN IF NOT EXISTS valor_bc_icms_st numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_icms_st numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_fcp numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_fcp_st numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_bc_st_retido numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_icms_st_retido numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_fcp_st_retido numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_icms_desonerado numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_icms_diferido numeric(14,2);

COMMENT ON COLUMN public.nfe_item.grupo_icms_xml IS
  'Grupo ICMS serializado no XML (ICMS00..ICMS90, ICMSSN101..ICMSSN900). NULL em notas anteriores a 18/09/2026.';
COMMENT ON COLUMN public.nfe_item.valor_bc_icms IS
  'vBC do ICMS próprio, como no XML. NULL quando o grupo não tem ICMS próprio (60, 40, SN102...).';
COMMENT ON COLUMN public.nfe_item.valor_icms IS
  'vICMS do ICMS próprio, como no XML. NULL quando o grupo não tem ICMS próprio.';
COMMENT ON COLUMN public.nfe_item.aliquotaicms IS
  'pICMS usado no ICMS próprio. A alíquota do cadastro não usada fica no snapshot.';
COMMENT ON COLUMN public.nfe_item.valor_bc_icms_st IS 'vBCST: base do ICMS-ST retido nesta operação.';
COMMENT ON COLUMN public.nfe_item.valor_icms_st IS 'vICMSST: ICMS-ST retido nesta operação.';
COMMENT ON COLUMN public.nfe_item.valor_fcp IS 'vFCP: FCP sobre o ICMS próprio.';
COMMENT ON COLUMN public.nfe_item.valor_fcp_st IS 'vFCPST: FCP sobre o ICMS-ST desta operação.';
COMMENT ON COLUMN public.nfe_item.valor_bc_st_retido IS 'vBCSTRet: base do ICMS-ST cobrado anteriormente.';
COMMENT ON COLUMN public.nfe_item.valor_icms_st_retido IS 'vICMSSTRet: ICMS-ST cobrado anteriormente.';
COMMENT ON COLUMN public.nfe_item.valor_fcp_st_retido IS 'vFCPSTRet: FCP-ST cobrado anteriormente.';
COMMENT ON COLUMN public.nfe_item.valor_icms_desonerado IS 'vICMSDeson.';
COMMENT ON COLUMN public.nfe_item.valor_icms_diferido IS 'vICMSDif.';

ALTER TABLE public.nfe_item DROP CONSTRAINT IF EXISTS nfe_item_grupo_icms_xml_valido;
ALTER TABLE public.nfe_item
  ADD CONSTRAINT nfe_item_grupo_icms_xml_valido CHECK (
    grupo_icms_xml IS NULL OR grupo_icms_xml IN (
      'ICMS00', 'ICMS10', 'ICMS20', 'ICMS30', 'ICMS40', 'ICMS51', 'ICMS60', 'ICMS70', 'ICMS90',
      'ICMSSN101', 'ICMSSN102', 'ICMSSN201', 'ICMSSN202', 'ICMSSN500', 'ICMSSN900'
    )
  ) NOT VALID;

ALTER TABLE public.nfe_item DROP CONSTRAINT IF EXISTS nfe_item_icms_coerente_com_grupo;
ALTER TABLE public.nfe_item
  ADD CONSTRAINT nfe_item_icms_coerente_com_grupo CHECK (
    grupo_icms_xml IS NULL
    OR (
      -- ICMS próprio só nos grupos que têm vBC/pICMS/vICMS.
      (grupo_icms_xml IN ('ICMS00', 'ICMS10', 'ICMS20', 'ICMS51', 'ICMS70', 'ICMS90', 'ICMSSN900')
        OR (valor_bc_icms IS NULL AND valor_icms IS NULL AND aliquotaicms IS NULL))
      AND ((valor_bc_icms IS NULL) = (valor_icms IS NULL))
      -- ICMS-ST desta operação.
      AND (grupo_icms_xml IN ('ICMS10', 'ICMS30', 'ICMS70', 'ICMS90', 'ICMSSN201', 'ICMSSN202', 'ICMSSN900')
        OR (valor_bc_icms_st IS NULL AND valor_icms_st IS NULL AND valor_fcp_st IS NULL))
      -- ST cobrada anteriormente.
      AND (grupo_icms_xml IN ('ICMS60', 'ICMSSN500')
        OR (valor_bc_st_retido IS NULL AND valor_icms_st_retido IS NULL AND valor_fcp_st_retido IS NULL))
      AND (grupo_icms_xml IN ('ICMS00', 'ICMS10', 'ICMS20', 'ICMS51', 'ICMS70', 'ICMS90') OR valor_fcp IS NULL)
      AND (grupo_icms_xml IN ('ICMS20', 'ICMS30', 'ICMS40', 'ICMS70', 'ICMS90') OR valor_icms_desonerado IS NULL)
      AND (grupo_icms_xml IN ('ICMS51', 'ICMS90') OR valor_icms_diferido IS NULL)
    )
  ) NOT VALID;

COMMIT;
