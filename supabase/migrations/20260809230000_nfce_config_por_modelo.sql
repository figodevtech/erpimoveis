-- Configuração fiscal por MODELO de documento, para a NFC-e (65) conviver com a
-- NF-e (55) sem disputar numeração.
--
-- Até aqui `nfe_config` tinha UNIQUE (empresaid): uma única configuração por
-- empresa, sempre modelo NFE. A coluna `modelo` existia e o enum já previa
-- 'NFCE', mas não havia como guardar duas séries — e todo o código que procura a
-- config faz `WHERE empresaid = ? ORDER BY id LIMIT 1`, ou seja, pegaria a linha
-- errada assim que existisse uma segunda.
--
-- Depois desta migration:
--   * a chave passa a ser (empresaid, modelo);
--   * cada empresa com NF-e ganha uma linha NFCE com série própria e contador
--     zerado;
--   * `nfe_liberar_numero` devolve o número para a fila do modelo certo.
--
-- O CSC também entra aqui. Ele vivia em `empresa.cschomologacao/cscproducao`,
-- sem o ID do CSC e sem separação por ambiente na prática. CSC é credencial de
-- estabelecimento POR AMBIENTE e só serve para a NFC-e, então o lugar dele é a
-- configuração fiscal do modelo 65.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Uma configuração por empresa E modelo
-- ---------------------------------------------------------------------------
ALTER TABLE public.nfe_config
  DROP CONSTRAINT IF EXISTS nfe_config_empresaid_key;

ALTER TABLE public.nfe_config
  DROP CONSTRAINT IF EXISTS nfe_config_empresaid_modelo_key;

ALTER TABLE public.nfe_config
  ADD CONSTRAINT nfe_config_empresaid_modelo_key UNIQUE (empresaid, modelo);

COMMENT ON CONSTRAINT nfe_config_empresaid_modelo_key ON public.nfe_config IS
  'Cada empresa tem uma configuracao por modelo: 55 (NFE) e 65 (NFCE) com series e contadores independentes.';

-- ---------------------------------------------------------------------------
-- 2) CSC e QR Code (exclusivos da NFC-e)
-- ---------------------------------------------------------------------------
ALTER TABLE public.nfe_config
  ADD COLUMN IF NOT EXISTS csc_homologacao text,
  ADD COLUMN IF NOT EXISTS csc_id_homologacao text,
  ADD COLUMN IF NOT EXISTS csc_producao text,
  ADD COLUMN IF NOT EXISTS csc_id_producao text,
  ADD COLUMN IF NOT EXISTS qrcode_versao smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS natureza_operacao text;

COMMENT ON COLUMN public.nfe_config.natureza_operacao IS
  'natOp padrao do modelo. A tela de emissao continua podendo sobrescrever.';

UPDATE public.nfe_config
   SET natureza_operacao = 'VENDA DE MERCADORIA'
 WHERE natureza_operacao IS NULL
   AND modelo = 'NFE'::public.enum_modelo_nfe;

COMMENT ON COLUMN public.nfe_config.csc_homologacao IS
  'Codigo de Seguranca do Contribuinte de homologacao. Segredo: nunca sai do backend inteiro, nunca vai para log.';
COMMENT ON COLUMN public.nfe_config.csc_producao IS
  'Codigo de Seguranca do Contribuinte de producao. Segredo: nunca sai do backend inteiro, nunca vai para log.';
COMMENT ON COLUMN public.nfe_config.qrcode_versao IS
  'Versao do QR Code da NFC-e conforme NT vigente (2 ou 3). Fica em coluna para a virada nao exigir deploy.';

ALTER TABLE public.nfe_config
  DROP CONSTRAINT IF EXISTS nfe_config_qrcode_versao_check;

ALTER TABLE public.nfe_config
  ADD CONSTRAINT nfe_config_qrcode_versao_check CHECK (qrcode_versao IN (2, 3));

-- ---------------------------------------------------------------------------
-- 3) Linha de configuração da NFC-e para cada empresa que já emite NF-e
--
-- Série 1 e contador zerado: a NFC-e nasce com sequência própria.
--
-- O ambiente nasce SEMPRE em HOMOLOGACAO, mesmo que a NF-e da empresa já esteja
-- em produção. A NFC-e é um modelo que a empresa nunca emitiu: precisa ser
-- testada, e o CSC de produção sequer costuma existir ainda. Herdar "PRODUCAO"
-- faria a primeira emissão de teste virar documento fiscal real, com número
-- consumido e cancelamento para desfazer. Mudar para produção é um clique
-- consciente na tela de configuração.
-- ---------------------------------------------------------------------------
INSERT INTO public.nfe_config (
  empresaid,
  modelo,
  serie,
  ultimo_numero,
  ambiente,
  tp_emis,
  versao_layout,
  tipo_impressao_danfe,
  permitir_homologacao,
  permitir_producao,
  csc_homologacao,
  csc_producao,
  qrcode_versao,
  natureza_operacao
)
SELECT
  c.empresaid,
  'NFCE'::public.enum_modelo_nfe,
  1,
  0,
  'HOMOLOGACAO'::public.enum_ambiente_nfe,
  1,
  '4.00',
  4, -- DANFE NFC-e
  c.permitir_homologacao,
  c.permitir_producao,
  NULLIF(btrim(e.cschomologacao), ''),
  NULLIF(btrim(e.cscproducao), ''),
  2,
  'VENDA AO CONSUMIDOR'
  FROM public.nfe_config c
  JOIN public.empresa e ON e.id = c.empresaid
 WHERE c.modelo = 'NFE'::public.enum_modelo_nfe
ON CONFLICT ON CONSTRAINT nfe_config_empresaid_modelo_key DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Liberação de número respeitando o modelo
--
-- A versão anterior procurava a config só por `empresaid`, com ORDER BY id
-- LIMIT 1. Com duas linhas por empresa, uma NFC-e rejeitada devolveria o número
-- para a fila da NF-e — e a NF-e seguinte sairia com número de NFC-e.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nfe_liberar_numero(p_nfe_id bigint, p_motivo text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_nfe public.nfe%ROWTYPE;
  v_config public.nfe_config%ROWTYPE;
BEGIN
  SELECT * INTO v_nfe FROM public.nfe WHERE id = p_nfe_id FOR UPDATE;
  IF NOT FOUND OR NOT v_nfe.numero_definitivo OR v_nfe.numero IS NULL THEN
    RETURN false;
  END IF;

  -- Só volta o número de nota que a SEFAZ nunca registrou.
  IF v_nfe.status IN ('AUTORIZADA', 'DENEGADA', 'CANCELADA', 'ENVIADA', 'ASSINADA', 'PENDENTE_ENVIO') THEN
    RETURN false;
  END IF;

  SELECT * INTO v_config
    FROM public.nfe_config
   WHERE empresaid = v_nfe.empresaid
     AND modelo = v_nfe.modelo
   ORDER BY id
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.nfe
     SET numero_definitivo = false,
         updatedat = now()
   WHERE id = p_nfe_id;

  INSERT INTO public.nfe_numero_liberado (config_id, serie, numero, motivo)
  VALUES (v_config.id, v_nfe.serie, v_nfe.numero, p_motivo)
  ON CONFLICT ON CONSTRAINT nfe_numero_liberado_unico DO NOTHING;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.nfe_liberar_numero(bigint, text) IS
  'Devolve para a fila do proprio modelo o numero de uma nota que nunca chegou a SEFAZ.';

COMMIT;
