-- Fecha para anon a função apontada pelo db:deploy depois de 20261119160000.
--
-- imob_proteger_servico_sistema (20261119160000) é função de gatilho da tabela servico (não deixa
-- a Limpeza do sistema ser excluída, desativada ou mudar de código). O Postgres não confere
-- EXECUTE quando o gatilho dispara, então fica só com service_role, como as demais imob_*
-- (mesmo tratamento de 20261113140000). Idempotente.
BEGIN;

REVOKE ALL ON FUNCTION public.imob_proteger_servico_sistema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_proteger_servico_sistema() TO service_role;

COMMIT;
