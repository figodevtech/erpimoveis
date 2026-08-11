-- Título liquidado por antecipação não tem banco. Nunca.
--
-- O QUE ACONTECEU
-- Em 20260806200000 ficou decidido que a parcela quitada por adiantamento é
-- baixada SEM banco: o dinheiro entrou pela transação de antecipação, e contá-lo
-- de novo na parcela dobraria o saldo. A tela do Fluxo respeita isso filtrando
-- por `banco_id IS NOT NULL`, e é por isso que a parcela antecipada aparece em
-- Liquidadas mas não no Fluxo.
--
-- Só que "sem banco" parece erro de digitação para quem escolheu um banco no
-- diálogo do adiantamento. No banco da Demir Diesel a operadora abriu os títulos
-- antecipados das OS #157 e #133, escolheu o banco na edição e salvou. O PATCH de
-- `/api/transaction/[id]` aceitou — não havia trava nenhuma para `banco_id` — e
-- aquelas parcelas passaram a aparecer no Fluxo ao lado da antecipação que já as
-- havia pago: o mesmo dinheiro contado duas vezes.
--
-- A rota e o diálogo passam a impedir a edição. Esta migration cuida do que já
-- foi gravado e fecha a porta no nível em que a regra realmente vale, porque
-- nenhum caminho futuro — script, correção manual, rota nova — vai lembrar dela
-- sozinho.
BEGIN;

-- Devolve ao estado que a baixa por adiantamento deixou. `transacao_baixa_historico`
-- não precisa de conserto: a linha de histórico já nasceu com banco nulo e o
-- PATCH nunca a tocou.
UPDATE public.transacao
   SET banco_id = NULL,
       updated_at = now()
 WHERE adiantamento_id IS NOT NULL
   AND banco_id IS NOT NULL;

ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_antecipado_sem_banco_check,
  ADD CONSTRAINT transacao_antecipado_sem_banco_check
    CHECK (adiantamento_id IS NULL OR banco_id IS NULL);

COMMENT ON CONSTRAINT transacao_antecipado_sem_banco_check ON public.transacao IS
  'O dinheiro do título antecipado entrou pela transação de adiantamento. Dar banco a ele o faria aparecer no fluxo de caixa junto com ela, somando o mesmo valor duas vezes.';

COMMIT;
