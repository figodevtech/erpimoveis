-- Deve ser confirmada antes da migração que utiliza o novo valor.
ALTER TYPE public.enum_status_os ADD VALUE IF NOT EXISTS 'FATURAMENTO' AFTER 'PAGAMENTO';
