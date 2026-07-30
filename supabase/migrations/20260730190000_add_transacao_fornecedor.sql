-- Vincula transacoes a fornecedores.
--
-- Ate aqui `transacao` so tinha `cliente_id`: o fornecedor de uma despesa era
-- alcancavel apenas indiretamente (transacao -> entrada -> fornecedor), o que
-- deixava despesas avulsas (aluguel, servico terceirizado) sem qualquer vinculo.
--
-- ON DELETE SET NULL segue o mesmo criterio de `centrosdecusto`: apagar um
-- cadastro nao pode apagar nem bloquear o lancamento financeiro ja realizado.
BEGIN;

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS fornecedor_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transacao_fornecedor_id_fkey'
  ) THEN
    ALTER TABLE public.transacao
      ADD CONSTRAINT transacao_fornecedor_id_fkey
      FOREIGN KEY (fornecedor_id) REFERENCES public.fornecedor(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS transacao_fornecedor_id_idx ON public.transacao(fornecedor_id);

COMMENT ON COLUMN public.transacao.fornecedor_id IS
  'Fornecedor vinculado ao lancamento. Mutuamente exclusivo com cliente_id: ambos alimentam nomepagador/cpfcnpjpagador.';

-- Backfill: transacoes originadas de entrada de estoque ja sabiam o fornecedor
-- indiretamente. Preencher aqui apenas materializa esse vinculo que ja existia
-- (a coluna e nova e esta NULL em todas as linhas — nada e sobrescrito).
UPDATE public.transacao t
   SET fornecedor_id = e.fornecedorid
  FROM public.entrada e
 WHERE t.entrada_id = e.id
   AND t.fornecedor_id IS NULL
   AND e.fornecedorid IS NOT NULL;

UPDATE public.transacao t
   SET fornecedor_id = ue.fornecedor_id
  FROM public.usoconsumo_entrada ue
 WHERE t.usoconsumo_entrada_id = ue.id
   AND t.fornecedor_id IS NULL
   AND ue.fornecedor_id IS NOT NULL;

COMMIT;
