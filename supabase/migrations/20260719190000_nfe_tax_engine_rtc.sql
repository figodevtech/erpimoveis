-- Motor fiscal NF-e modelo 55: auditoria de regras e tabelas externas RTC.
ALTER TABLE public.nfe
  ADD COLUMN IF NOT EXISTS versao_regra_fiscal text,
  ADD COLUMN IF NOT EXISTS decisao_fiscal jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.nfe_item
  ADD COLUMN IF NOT EXISTS tributacao_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.fiscal_nfe_cst_ibscbs (
  cst text NOT NULL,
  descricao text NOT NULL,
  indicadores jsonb NOT NULL DEFAULT '{}'::jsonb,
  versao_fonte text NOT NULL,
  atualizado_em date NOT NULL,
  PRIMARY KEY (cst, versao_fonte)
);

CREATE TABLE IF NOT EXISTS public.fiscal_nfe_classificacao_tributaria (
  codigo text NOT NULL,
  cst text NOT NULL,
  nome text NOT NULL,
  descricao text,
  percentual_reducao_ibs numeric(7,4),
  percentual_reducao_cbs numeric(7,4),
  inicio_vigencia date NOT NULL,
  fim_vigencia date,
  permite_nfe boolean NOT NULL DEFAULT false,
  indicadores jsonb NOT NULL DEFAULT '{}'::jsonb,
  versao_fonte text NOT NULL,
  atualizado_em date NOT NULL,
  fonte_url text,
  PRIMARY KEY (codigo, versao_fonte),
  CONSTRAINT fiscal_nfe_classificacao_codigo_check CHECK (codigo ~ '^[0-9]{6}$'),
  CONSTRAINT fiscal_nfe_classificacao_cst_check CHECK (cst ~ '^[0-9]{3}$')
);

CREATE INDEX IF NOT EXISTS fiscal_nfe_classificacao_lookup_idx
  ON public.fiscal_nfe_classificacao_tributaria (cst, inicio_vigencia, fim_vigencia)
  WHERE permite_nfe;

ALTER TABLE public.fiscal_nfe_cst_ibscbs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_nfe_classificacao_tributaria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_nfe_cst_ibscbs_read ON public.fiscal_nfe_cst_ibscbs;
CREATE POLICY fiscal_nfe_cst_ibscbs_read ON public.fiscal_nfe_cst_ibscbs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fiscal_nfe_classificacao_read ON public.fiscal_nfe_classificacao_tributaria;
CREATE POLICY fiscal_nfe_classificacao_read ON public.fiscal_nfe_classificacao_tributaria
  FOR SELECT TO authenticated USING (true);

COMMENT ON COLUMN public.nfe.versao_regra_fiscal IS
  'Versao imutavel das regras, NT, IT e schema usados para construir a NF-e.';
COMMENT ON COLUMN public.nfe.decisao_fiscal IS
  'Contexto auditavel da decisao fiscal: CRT, vigencia, modelo e classificacoes externas.';
COMMENT ON COLUMN public.nfe_item.tributacao_snapshot IS
  'Tributacao completa e explicita do item, sem inferencia posterior a partir do cadastro do produto.';
