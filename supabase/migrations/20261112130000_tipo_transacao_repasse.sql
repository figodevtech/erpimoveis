-- Tipo de transação REPASSE: a saída que entrega ao proprietário o dinheiro dele.
--
-- Não é despesa (não entra na DRE) nem transferência entre contas próprias (o destino é a
-- conta do proprietário, não da empresa). No caixa é saída, como DESPESA e SAQUE.
--
-- Arquivo à parte: o valor novo de um enum só pode ser usado depois de gravado.
BEGIN;
ALTER TYPE public.tipos_transacao ADD VALUE IF NOT EXISTS 'REPASSE' AFTER 'SAQUE';
COMMIT;
