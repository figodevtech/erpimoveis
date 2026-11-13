-- Fecha para anon duas funções do public apontadas pelo db:deploy.
--
-- imob_repasse_antes_excluir_transacao (20261112120000) é função de gatilho: o Postgres não confere
-- EXECUTE quando o gatilho dispara, então fica só com service_role, como as demais imob_*.
--
-- imob_correcao_proprietario_ativa (20261113130000) é chamada de dentro dos gatilhos de transacao e
-- imovel_movimento, e essa chamada interna confere EXECUTE com o papel de quem altera a linha.
-- Fica com authenticated e service_role (quem escreve nessas tabelas); anon e PUBLIC, não.
-- Idempotente.
BEGIN;

REVOKE ALL ON FUNCTION public.imob_repasse_antes_excluir_transacao() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_repasse_antes_excluir_transacao() TO service_role;

REVOKE ALL ON FUNCTION public.imob_correcao_proprietario_ativa(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.imob_correcao_proprietario_ativa(bigint) TO authenticated, service_role;

COMMIT;
