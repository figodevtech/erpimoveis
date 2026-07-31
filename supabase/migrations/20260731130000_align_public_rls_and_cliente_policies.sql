-- Normaliza RLS e as politicas de perfil entre todos os bancos do ERP Oficina.
-- As tabelas abaixo sao acessadas pelas APIs do servidor com service_role.
-- Sem uma policy explicita, anon e authenticated permanecem sem acesso direto.

BEGIN;

ALTER TABLE public.agendamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categoriavenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.centrosdecusto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_modelo_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_saida ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_saida_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lote_pecas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfse ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planosdeconta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planosdecontagrupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_motivo_saida ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transacao_baixa_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendaanexo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendaproduto_baixa ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agendamento NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.categoriavenda NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.centrosdecusto NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_modelo_item NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cliente NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_saida NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_saida_item NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lote_pecas NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lotes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nfse NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.planosdeconta NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.planosdecontagrupos NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_motivo_saida NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transacao_baixa_historico NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendaanexo NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendaproduto_baixa NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver seu próprio perfil" ON public.cliente;
CREATE POLICY "Usuários podem ver seu próprio perfil"
  ON public.cliente
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuários podem criar seu próprio perfil" ON public.cliente;
CREATE POLICY "Usuários podem criar seu próprio perfil"
  ON public.cliente
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuários podem atualizar seu próprio perfil" ON public.cliente;
CREATE POLICY "Usuários podem atualizar seu próprio perfil"
  ON public.cliente
  FOR UPDATE
  USING (auth.uid() = user_id);

COMMIT;
