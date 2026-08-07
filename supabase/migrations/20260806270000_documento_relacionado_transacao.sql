-- Documento relacionado a uma transacao financeira.
--
-- Hoje o unico lugar para dizer "este pagamento e da NFS-e 1234" e a descricao,
-- em texto livre. Isso nao se pesquisa, nao se confere e nao se exporta.
--
-- A amarracao e do PAGAMENTO, nao do documento fiscal: nada aqui alimenta a
-- emissao de NF-e/NFS-e nem se cruza com fiscal_dfe_recebidas. E registro de
-- referencia — o papel que justifica o lancamento.
--
-- Um documento por transacao, e todos os campos opcionais menos o tipo. Num
-- parcelamento, cada parcela nasce com a mesma referencia: uma nota paga em tres
-- vezes continua sendo uma nota so.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Catalogo de tipos
--
-- Mesmo formato de public.tipos_ajuste_transacao e tipos_motivo_saida: codigo
-- estavel para o sistema, nome para a tela, `ativo` em vez de exclusao. Sem
-- codigo_sistema porque nenhuma linha daqui e usada pelo proprio ERP — a lista
-- existe para o usuario classificar, e ele pode acrescentar as suas.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tipos_documento_transacao (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  createdat timestamp with time zone NOT NULL DEFAULT now(),
  updatedat timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tipos_documento_transacao_codigo_unique UNIQUE (codigo)
);

ALTER TABLE public.tipos_documento_transacao OWNER TO postgres;

GRANT ALL ON TABLE public.tipos_documento_transacao TO anon;
GRANT ALL ON TABLE public.tipos_documento_transacao TO authenticated;
GRANT ALL ON TABLE public.tipos_documento_transacao TO service_role;

INSERT INTO public.tipos_documento_transacao (codigo, nome, descricao) VALUES
  ('NFSE',        'NFS-e',                 'Nota fiscal de serviço eletrônica.'),
  ('NFE',         'NF-e',                  'Nota fiscal eletrônica de produto.'),
  ('NFCE',        'NFC-e',                 'Nota fiscal de consumidor eletrônica.'),
  ('FATURA',      'Fatura',                NULL),
  ('BOLETO',      'Boleto',                NULL),
  ('RECIBO',      'Recibo',                NULL),
  ('COMPROVANTE', 'Comprovante',           'Comprovante de pagamento ou transferência.'),
  ('CONTRATO',    'Contrato',              NULL),
  ('OUTRO',       'Outro documento',       NULL)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Campos do documento na transacao
--
-- Colunas na propria transacao, e nao tabela filha, porque a relacao e 1:1 e
-- todo lugar que le a transacao ja leria a linha junto. Sao genericos de
-- proposito: `numero`/`serie`/`chave` servem tanto a uma NFS-e quanto a um
-- recibo, e o que nao se aplica fica nulo.
--
-- `documento_emitido_em` e date, nao timestamptz: data de emissao nao tem hora,
-- e guardar com fuso so criaria a chance de exibir um dia a menos.
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS documento_tipo_id integer,
  ADD COLUMN IF NOT EXISTS documento_numero text,
  ADD COLUMN IF NOT EXISTS documento_serie text,
  ADD COLUMN IF NOT EXISTS documento_chave text,
  ADD COLUMN IF NOT EXISTS documento_emitido_em date,
  ADD COLUMN IF NOT EXISTS documento_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS documento_observacao text;

ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_documento_tipo_id_fkey;

-- RESTRICT: tipo em uso nao pode sumir do catalogo e deixar transacao com
-- documento sem nome. Para tirar de circulacao existe `ativo`.
ALTER TABLE public.transacao
  ADD CONSTRAINT transacao_documento_tipo_id_fkey
  FOREIGN KEY (documento_tipo_id)
  REFERENCES public.tipos_documento_transacao (id)
  ON DELETE RESTRICT;

-- Sem tipo nao ha documento: numero solto nao diz de que papel se trata. Toda
-- linha que ja existe tem tudo nulo, entao a checagem passa sem backfill.
ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_documento_tipo_obrigatorio;

ALTER TABLE public.transacao
  ADD CONSTRAINT transacao_documento_tipo_obrigatorio CHECK (
    documento_tipo_id IS NOT NULL
    OR (
      documento_numero IS NULL
      AND documento_serie IS NULL
      AND documento_chave IS NULL
      AND documento_emitido_em IS NULL
      AND documento_valor IS NULL
      AND documento_observacao IS NULL
    )
  );

ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_documento_valor_nao_negativo;

ALTER TABLE public.transacao
  ADD CONSTRAINT transacao_documento_valor_nao_negativo CHECK (
    documento_valor IS NULL OR documento_valor >= 0
  );

-- Parciais: a esmagadora maioria das transacoes nao tem documento, e o indice
-- so precisa cobrir quem tem. Servem a pergunta "que lancamento e desta nota?".
CREATE INDEX IF NOT EXISTS transacao_documento_numero_idx
  ON public.transacao (documento_numero)
  WHERE documento_numero IS NOT NULL;

CREATE INDEX IF NOT EXISTS transacao_documento_chave_idx
  ON public.transacao (documento_chave)
  WHERE documento_chave IS NOT NULL;

CREATE INDEX IF NOT EXISTS transacao_documento_tipo_id_idx
  ON public.transacao (documento_tipo_id)
  WHERE documento_tipo_id IS NOT NULL;

COMMENT ON COLUMN public.transacao.documento_numero IS
  'Numero do documento (nota, recibo, boleto). Livre: cada emissor formata do seu jeito.';
COMMENT ON COLUMN public.transacao.documento_chave IS
  'Chave de acesso da NF-e/NFS-e ou codigo de verificacao. Nao e validado nem conferido na SEFAZ.';

COMMIT;
