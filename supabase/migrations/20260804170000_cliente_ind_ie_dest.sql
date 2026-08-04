-- Indicador da inscrição estadual do destinatário (indIEDest da NF-e).
--
-- Até aqui o motor deduzia o indicador da simples existência de texto no campo
-- `inscricaoestadual`: com IE preenchida mandava 1 (contribuinte do ICMS), sem
-- IE mandava 9. Uma IE cadastrada mas baixada/inativa na UF gerava
-- <indIEDest>1</indIEDest> e a SEFAZ devolvia a rejeição 306 ("IE do
-- Destinatario nao esta ativa na UF").
--
-- A situação fiscal do destinatário é um dado do cadastro, não algo que se
-- deduza do preenchimento de um campo. A coluna nasce NULL de propósito: quem
-- ainda não foi classificado precisa ser confirmado pelo usuário na emissão,
-- e não silenciosamente convertido em contribuinte.
BEGIN;

ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS ind_ie_dest smallint;

ALTER TABLE public.cliente DROP CONSTRAINT IF EXISTS cliente_ind_ie_dest_check;
ALTER TABLE public.cliente
  ADD CONSTRAINT cliente_ind_ie_dest_check
  CHECK (ind_ie_dest IS NULL OR ind_ie_dest IN (1, 2, 9));

COMMENT ON COLUMN public.cliente.ind_ie_dest IS
  'indIEDest da NF-e: 1 contribuinte do ICMS, 2 contribuinte isento de inscricao, 9 nao contribuinte. NULL = ainda nao classificado.';

COMMIT;
