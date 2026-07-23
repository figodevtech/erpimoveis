-- Migration: Unify NFe Schema for Entry Invoices
-- Date: 2026-01-30

-- 1. Make clienteid nullable to support invoices without a client (Entry)
ALTER TABLE public.nfe ALTER COLUMN clienteid DROP NOT NULL;
-- 2. Add columns for Entry flow
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS fornecedorid integer REFERENCES fornecedor(id);
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS entradaid bigint REFERENCES entrada(id);
-- 3. Add constraint to ensure either Client or Supplier is present, but not both
-- Wrap in DO block to avoid error if constraint already exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_nfe_destinatario') THEN
        ALTER TABLE public.nfe ADD CONSTRAINT ck_nfe_destinatario CHECK (
            (clienteid IS NOT NULL AND fornecedorid IS NULL) OR 
            (clienteid IS NULL AND fornecedorid IS NOT NULL)
        );
    END IF;
END $$;
