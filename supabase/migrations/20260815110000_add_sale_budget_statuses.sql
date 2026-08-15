-- Etapas operacionais do fluxo de aprovação de orçamento de venda.
-- Os valores são adicionados fora de uma transação explícita para permanecer
-- compatível com versões do PostgreSQL que não permitem usar um novo valor de
-- enum na mesma transação em que ele foi criado.
ALTER TYPE public.enum_status_venda
  ADD VALUE IF NOT EXISTS 'APROVACAO_ORCAMENTO';

ALTER TYPE public.enum_status_venda
  ADD VALUE IF NOT EXISTS 'ORCAMENTO_APROVADO';

ALTER TYPE public.enum_status_venda
  ADD VALUE IF NOT EXISTS 'ORCAMENTO_RECUSADO';
