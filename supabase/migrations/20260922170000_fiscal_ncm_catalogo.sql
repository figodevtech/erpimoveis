-- Catálogo de NCM, para o motor fiscal saber se um código existe de verdade.
--
-- O motor de DIFAL validava o NCM só pelo formato: oito dígitos passavam. O
-- produto "MÓDULO VOLVO 6792" da venda 180 está cadastrado com NCM 22346792 —
-- o final é o número da peça, e o código não existe na NCM. Com regra geral da
-- UF isso não muda o resultado; no dia em que houver regra por NCM, um código
-- inexistente simplesmente não casa com nenhuma, cai na geral e tributa errado
-- sem ninguém perceber.
--
-- A carga vem de data/fiscal/ncm/ncm-siscomex.json, pelo script
-- `npm run fiscal:ncm`. A tabela nasce vazia de propósito: um INSERT de 10.515
-- linhas dentro da migration tornaria o push lento e o histórico ilegível, e a
-- NCM muda por Resolução Gecex várias vezes por ano — é carga, não esquema.
--
-- Enquanto a tabela estiver vazia, a validação de existência fica desligada e
-- o motor volta a conferir só o formato. Assim a emissão continua funcionando
-- entre aplicar a migration e rodar a importação.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fiscal_ncm (
  codigo        char(8) PRIMARY KEY,
  descricao     text NOT NULL,
  vigencia_inicio date,
  vigencia_fim    date,
  ato           text,
  fonte         text NOT NULL,
  fonte_url     text,
  importado_em  date,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fiscal_ncm IS
  'Nomenclatura Comum do Mercosul (8 dígitos), do Portal Único Siscomex. Vazia = validação de existência desligada.';
COMMENT ON COLUMN public.fiscal_ncm.codigo IS 'NCM com 8 dígitos, sem pontuação.';
COMMENT ON COLUMN public.fiscal_ncm.vigencia_fim IS 'NULL ou 31/12/9999 = ainda vigente.';
COMMENT ON COLUMN public.fiscal_ncm.ato IS 'Ato que fixou a versão importada (ex.: Resolução Gecex nº 926/2026).';

ALTER TABLE public.fiscal_ncm DROP CONSTRAINT IF EXISTS fiscal_ncm_codigo_bem_formado;
ALTER TABLE public.fiscal_ncm
  ADD CONSTRAINT fiscal_ncm_codigo_bem_formado CHECK (codigo ~ '^[0-9]{8}$');

ALTER TABLE public.fiscal_ncm DROP CONSTRAINT IF EXISTS fiscal_ncm_vigencia_coerente;
ALTER TABLE public.fiscal_ncm
  ADD CONSTRAINT fiscal_ncm_vigencia_coerente CHECK (
    vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio
  );

DROP TRIGGER IF EXISTS fiscal_ncm_atualizado_em ON public.fiscal_ncm;
CREATE TRIGGER fiscal_ncm_atualizado_em
  BEFORE UPDATE ON public.fiscal_ncm
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_difal_regra_touch_atualizado_em();

-- Mesmo padrão das demais tabelas fiscais: sem acesso direto pelo cliente.
ALTER TABLE public.fiscal_ncm ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_ncm NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fiscal_ncm FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.fiscal_ncm TO service_role;

COMMIT;
