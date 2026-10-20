BEGIN;

-- CNPJ da instituição em que a conta está (banco, instituição de pagamento).
-- Opcional no cadastro; o registro 1601 do SPED informa os recebimentos
-- eletrônicos por instituição, e a maquininha é a do banco da conta.
ALTER TABLE public.bancoconta
  ADD COLUMN IF NOT EXISTS cnpj_instituicao text;

ALTER TABLE public.bancoconta
  DROP CONSTRAINT IF EXISTS bancoconta_cnpj_instituicao_chk;
ALTER TABLE public.bancoconta
  ADD CONSTRAINT bancoconta_cnpj_instituicao_chk CHECK (
    cnpj_instituicao IS NULL
    OR (cnpj_instituicao = public.fiscal_cnpj_normalizar(cnpj_instituicao)
        AND public.fiscal_cnpj_valido(cnpj_instituicao))
  );

COMMENT ON COLUMN public.bancoconta.cnpj_instituicao IS
  'CNPJ normalizado da instituição da conta. Instituição de pagamento do registro 1601 (PIX, boleto, transferência e cartão da maquininha do banco).';

COMMIT;
