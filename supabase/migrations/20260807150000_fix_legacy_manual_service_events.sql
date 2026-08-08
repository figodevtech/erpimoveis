-- Eventos de despesa de servico criados manualmente/avulso antes do update
-- possuem chave_origem NULL. Para que o reconciliador de eventos nao os confunda
-- com eventos automaticos divergentes (que causavam bloqueio ao mudar OS para CONCLUIDO),
-- marcamos esses eventos legados explicitamente com is_manual = true.
BEGIN;

UPDATE public.eventos_financeiros
   SET is_manual = true
 WHERE origem = 'SERVICO'
   AND natureza = 'DESPESA'
   AND chave_origem IS NULL
   AND NOT coalesce(is_manual, false);

COMMIT;
