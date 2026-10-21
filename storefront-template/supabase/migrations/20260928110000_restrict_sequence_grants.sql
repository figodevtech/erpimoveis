-- ==============================================================================
-- Migration: 20260928_restrict_sequence_grants.sql
-- Restrição estrita de privilégios em SEQUENCES no schema public
-- Substitui a concessão ampla de ALL SEQUENCES para authenticated por
-- grants pontuais apenas nas sequences das tabelas onde o usuário autenticado
-- possui permissão legítima de INSERT: cliente, cliente_endereco e favorito.
-- ==============================================================================

-- 1. Revoga acesso amplo a todas as sequences no schema public de papéis públicos/anônimos/autenticados
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated, anon, PUBLIC;

-- 2. Concede USAGE, SELECT estritamente nas 3 sequences necessárias para INSERT do usuário autenticado
GRANT USAGE, SELECT ON SEQUENCE public.cliente_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cliente_endereco_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.favorito_id_seq TO authenticated;

-- 3. Garante que service_role e postgres continuem com acesso total irrestrito a todas as sequences
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- 4. Altera privilégios padrão futuros para evitar concessão genérica acidental em novas sequences
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated, anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
