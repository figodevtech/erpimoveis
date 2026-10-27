BEGIN;

-- Impressão rápida dos documentos dinâmicos.
--
-- O PROBLEMA
-- Emitir o cupom no caixa abria uma aba nova, e só dali saía a impressão:
-- três cliques e uma aba para fechar a cada venda.
--
-- A REGRA
-- 1) Modelo com `impressao_rapida` ganha uma impressora no próprio item do
--    menu de emissão: o documento é preenchido e vai direto para o diálogo de
--    impressão, sem aba nova. O item continua abrindo a aba como antes.
-- 2) Liga e desliga no editor do modelo. Nasce desligado; o cupom de venda de
--    fábrica, feito para o caixa, já vem ligado.
--
-- ORDEM DO DEPLOY
-- Esta migration antes do código: o código novo lê a coluna.

ALTER TABLE public.documento_modelo
  ADD COLUMN IF NOT EXISTS impressao_rapida boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.documento_modelo.impressao_rapida IS
  'Mostra o botão de imprimir direto (sem abrir a aba do documento) no menu de emissão.';

UPDATE public.documento_modelo
SET impressao_rapida = true
WHERE codigo_padrao = 'venda_cupom'
  AND NOT impressao_rapida;

COMMIT;
