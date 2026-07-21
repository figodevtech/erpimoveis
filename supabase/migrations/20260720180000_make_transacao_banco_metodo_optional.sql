-- Tornar banco_id e metodopagamento opcionais na tabela transacao
ALTER TABLE public.transacao
    ALTER COLUMN banco_id DROP NOT NULL,
    ALTER COLUMN metodopagamento DROP NOT NULL;
