-- Padrao fiscal dos itens de NF-e/NFC-e.
--
-- Hoje o snapshot fiscal de cada item nasce so do cadastro do produto, e o
-- cadastro esta vazio: nos 47 produtos do banco de demonstracao havia 2 com
-- origem_mercadoria, 2 com csosn, 1 com cst_pis e nenhum com cst, aliquota de
-- ICMS ou cClassTrib. Na pratica o operador redigita o mesmo perfil tributario
-- em cada item de cada nota -- as notas ja emitidas sairam todas com
-- cfop=5102 csosn=102.
--
-- A NFS-e ja resolveu isso com nfse_config.padroes_emissao. Esta coluna e o
-- equivalente para os modelos 55 e 65: o perfil tributario passa a viver na
-- configuracao fiscal, e no produto sobra o que e mesmo do item (NCM e CEST).
--
-- Como nfe_config ja tem UNIQUE (empresaid, modelo), a coluna nao precisa saber
-- de modelo: a linha NFE guarda o padrao da 55 e a linha NFCE o da 65. Por
-- dentro, so a operacao:
--
--   { "SAIDA": { ... }, "ENTRADA": { ... } }
--
-- A linha NFCE so usa SAIDA -- NFC-e nao e documento de entrada.
--
-- O padrao NAO sobrescreve o produto: campo preenchido no produto vence, campo
-- vazio recebe o padrao. Quem resolve isso e src/lib/nfe/padraoFiscalItem.ts;
-- aqui so mora o dado.
BEGIN;

ALTER TABLE public.nfe_config
  ADD COLUMN IF NOT EXISTS padroes_emissao jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.nfe_config
  DROP CONSTRAINT IF EXISTS nfe_config_padroes_emissao_object_check;

ALTER TABLE public.nfe_config
  ADD CONSTRAINT nfe_config_padroes_emissao_object_check
  CHECK (jsonb_typeof(padroes_emissao) = 'object');

COMMENT ON COLUMN public.nfe_config.padroes_emissao IS
  'Padrao fiscal dos itens, chaveado por tipo de operacao (SAIDA, ENTRADA). O modelo vem da propria linha. Preenche o que o produto deixou vazio; produto preenchido vence.';

COMMIT;
