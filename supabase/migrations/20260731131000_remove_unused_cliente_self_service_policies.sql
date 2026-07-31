-- O ERP atual gerencia clientes exclusivamente pelas APIs do servidor.
-- Nao existe portal de cliente nem vinculo ativo entre cliente.user_id e auth.users.
-- Mantem RLS habilitado e remove apenas o acesso direto de autoatendimento.

BEGIN;

DROP POLICY IF EXISTS "Usuários podem ver seu próprio perfil" ON public.cliente;
DROP POLICY IF EXISTS "Usuários podem criar seu próprio perfil" ON public.cliente;
DROP POLICY IF EXISTS "Usuários podem atualizar seu próprio perfil" ON public.cliente;

ALTER TABLE public.cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente NO FORCE ROW LEVEL SECURITY;

COMMIT;
