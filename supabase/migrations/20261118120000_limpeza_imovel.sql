-- Limpeza do imóvel depois do check-out.
--
-- O check-out pode pedir a limpeza do imóvel e nomear um responsável (qualquer usuário ativo
-- do ERP). Enquanto a limpeza está pendente, o imóvel aparece com a situação LIMPEZA; ela
-- termina quando o responsável (ou quem gerencia limpezas, ou quem edita imóveis) a conclui.
--
-- - imovel_limpeza: um pedido de limpeza por imóvel aberto de cada vez (PENDENTE). Um novo
--   check-out com uma limpeza ainda aberta reaproveita a existente.
-- - config_geral: "Sempre solicitar limpeza" (a caixa do check-out abre marcada) e o
--   responsável padrão, que o diálogo de check-out já traz selecionado.
-- - imob_acao_reserva: igual a 20261108150000; no CHECKOUT, com solicitar_limpeza=true, abre a
--   limpeza na mesma transação.
-- - imob_acao_limpeza: CONCLUIR e ATRIBUIR. Quem pode o quê é decidido na API do ERP.
-- - imovel_resumo: igual a 20261030010000, com LIMPEZA entre OCUPADO e RESERVADO. A ocupação da
--   reserva concluída continua ativa até o fim previsto; a limpeza vem antes dela. Um novo
--   hóspede já em check-in continua como OCUPADO.
-- - Permissão limpezas:gerenciar: ver todas as limpezas (inclusive sem responsável), reatribuir
--   e concluir. Sem ela, cada usuário vê só as que estão sob a responsabilidade dele.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- --------------------------------------------------------------------------- tabela
CREATE TABLE IF NOT EXISTS public.imovel_limpeza (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  imovel_id bigint NOT NULL REFERENCES public.imovel(id),
  reserva_id bigint REFERENCES public.reserva_imovel(id),
  responsavel_id uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'CONCLUIDA', 'CANCELADA')),
  solicitada_em timestamptz NOT NULL DEFAULT now(),
  solicitada_por uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  concluida_em timestamptz,
  concluida_por uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  observacoes text,
  updated_by uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'CONCLUIDA') = (concluida_em IS NOT NULL))
);

COMMENT ON TABLE public.imovel_limpeza IS 'Limpeza do imóvel pedida no check-out da reserva; enquanto PENDENTE, o imóvel fica em LIMPEZA.';

-- No máximo uma limpeza aberta por imóvel; cada reserva pede no máximo uma.
CREATE UNIQUE INDEX IF NOT EXISTS imovel_limpeza_pendente_uidx ON public.imovel_limpeza(imovel_id) WHERE status = 'PENDENTE';
CREATE UNIQUE INDEX IF NOT EXISTS imovel_limpeza_reserva_uidx ON public.imovel_limpeza(reserva_id) WHERE reserva_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS imovel_limpeza_responsavel_idx ON public.imovel_limpeza(responsavel_id, status);

-- Mesmo tratamento das demais tabelas do domínio (20261029173114): só o backend acessa.
ALTER TABLE public.imovel_limpeza ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imovel_limpeza FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.imovel_limpeza TO service_role;
REVOKE ALL ON SEQUENCE public.imovel_limpeza_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.imovel_limpeza_id_seq TO service_role;
DROP TRIGGER IF EXISTS imob_auditoria ON public.imovel_limpeza;
CREATE TRIGGER imob_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.imovel_limpeza
  FOR EACH ROW EXECUTE FUNCTION public.imob_auditar();

-- --------------------------------------------------------------------------- configuração
ALTER TABLE public.config_geral
  ADD COLUMN IF NOT EXISTS limpeza_sempre_solicitar boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS limpeza_responsavel_padrao_id uuid REFERENCES public.usuario(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.config_geral.limpeza_sempre_solicitar IS 'Caixa "Solicitar limpeza" do check-out abre marcada.';
COMMENT ON COLUMN public.config_geral.limpeza_responsavel_padrao_id IS 'Responsável já selecionado no check-out; o operador pode trocar ou retirar.';

-- --------------------------------------------------------------------------- pedido de limpeza
-- Abre a limpeza do imóvel ou reaproveita a que já está aberta (só preenche o responsável se
-- ela estiver sem). Responsável é opcional; quando vier, precisa ser usuário ativo.
CREATE OR REPLACE FUNCTION public.imob_solicitar_limpeza(p_imovel_id bigint, p_reserva_id bigint, p_responsavel uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE l public.imovel_limpeza%ROWTYPE;
BEGIN
  IF p_responsavel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = p_responsavel AND ativo) THEN
    RAISE EXCEPTION 'O responsável pela limpeza precisa ser um usuário ativo.' USING ERRCODE = '22023';
  END IF;
  -- Dois check-outs do mesmo imóvel ao mesmo tempo não abrem duas limpezas.
  PERFORM pg_advisory_xact_lock(hashtextextended('imob-limpeza:' || p_imovel_id, 0));
  SELECT * INTO l FROM public.imovel_limpeza WHERE imovel_id = p_imovel_id AND status = 'PENDENTE' FOR UPDATE;
  IF FOUND THEN
    IF l.responsavel_id IS NULL AND p_responsavel IS NOT NULL THEN
      UPDATE public.imovel_limpeza SET responsavel_id = p_responsavel, updated_by = p_actor, updated_at = now()
        WHERE id = l.id RETURNING * INTO l;
    END IF;
    RETURN to_jsonb(l);
  END IF;
  INSERT INTO public.imovel_limpeza (imovel_id, reserva_id, responsavel_id, solicitada_por, updated_by)
  VALUES (p_imovel_id, p_reserva_id, p_responsavel, p_actor, p_actor)
  RETURNING * INTO l;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_solicitar_limpeza(bigint, bigint, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_solicitar_limpeza(bigint, bigint, uuid, uuid) TO service_role;

-- --------------------------------------------------------------------------- ações da reserva
-- CREATE OR REPLACE preserva as permissões já concedidas a imob_acao_reserva.
CREATE OR REPLACE FUNCTION public.imob_acao_reserva(p_id bigint,p_acao text,p_payload jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.reserva_imovel%ROWTYPE; v_actor uuid; v_acao text:=upper(p_acao); v_momento timestamptz;
BEGIN
 v_actor:=public.imob_definir_ator(p_actor);
 SELECT * INTO r FROM public.reserva_imovel WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE='P0002'; END IF;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Ações da reserva são exclusivas do ERP.' USING ERRCODE='42501'; END IF;
 IF v_acao='CONFIRMAR' AND r.status='CONFIRMADA' THEN RETURN to_jsonb(r);
 ELSIF v_acao IN ('CHECKIN','CHECK_IN') THEN
  IF r.status='EM_ANDAMENTO' THEN RETURN to_jsonb(r); END IF;
  IF r.status<>'CONFIRMADA' THEN RAISE EXCEPTION 'Check-in exige reserva confirmada.'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-in');
  UPDATE public.reserva_imovel SET status='EM_ANDAMENTO',checkin_em=v_momento WHERE id=p_id;
 ELSIF v_acao IN ('CHECKOUT','CHECK_OUT','CONCLUIR') THEN
  IF r.status='CONCLUIDA' THEN RETURN to_jsonb(r); END IF;
  IF r.status<>'EM_ANDAMENTO' THEN RAISE EXCEPTION 'Check-out exige check-in registrado.'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-out');
  IF r.checkin_em IS NOT NULL AND v_momento<r.checkin_em THEN
   RAISE EXCEPTION 'O check-out (%) não pode ser antes do check-in (%).',
    to_char(v_momento AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI'),
    to_char(r.checkin_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') USING ERRCODE='22023';
  END IF;
  UPDATE public.reserva_imovel SET status='CONCLUIDA',checkout_em=v_momento WHERE id=p_id;
  -- Limpeza pedida no diálogo do check-out: abre junto, ou nada acontece.
  IF coalesce(p_payload->>'solicitar_limpeza','false')='true' THEN
   PERFORM public.imob_solicitar_limpeza(r.imovel_id,r.id,nullif(p_payload->>'responsavel_limpeza_id','')::uuid,v_actor);
  END IF;
 ELSIF v_acao='CANCELAR' THEN
  IF r.status='CANCELADA' THEN RETURN to_jsonb(r); END IF;
  IF r.status='CONCLUIDA' THEN RAISE EXCEPTION 'Reserva concluída não pode ser cancelada.'; END IF;
  IF nullif(btrim(p_payload->>'motivo'),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
  IF v_actor IS NULL AND coalesce(p_payload->>'tratamento_financeiro','MANTER')<>'MANTER' THEN RAISE EXCEPTION 'Tratamento financeiro exige operador ERP.'; END IF;
  IF v_actor IS NOT NULL AND EXISTS(SELECT 1 FROM public.transacao WHERE reserva_imovel_id=r.id AND pendente AND NOT is_deleted AND baixa_de_transacao_id IS NULL) AND p_payload->>'tratamento_pendentes' IS NULL THEN RAISE EXCEPTION 'Escolha como tratar as cobranças pendentes.'; END IF;
  PERFORM public.imob_tratar_cancelamento(r.id,NULL,coalesce(p_payload->>'tratamento_recebidos',p_payload->>'tratamento_financeiro','MANTER'),v_actor,coalesce(p_payload->>'tratamento_pendentes','MANTER'));
  UPDATE public.reserva_imovel SET status='CANCELADA',cancelamento_motivo=p_payload->>'motivo' WHERE id=p_id;
  UPDATE public.imovel_ocupacao SET ativo=false,updated_at=now() WHERE reserva_id=p_id;
 ELSE RAISE EXCEPTION 'Ação de reserva inválida.'; END IF;
 UPDATE public.reserva_imovel SET updated_by=v_actor,updated_at=now() WHERE id=p_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

-- --------------------------------------------------------------------------- ações da limpeza
CREATE OR REPLACE FUNCTION public.imob_acao_limpeza(p_id bigint, p_acao text, p_payload jsonb, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE l public.imovel_limpeza%ROWTYPE; v_actor uuid; v_acao text := upper(coalesce(p_acao, '')); v_resp uuid;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ações da limpeza são exclusivas do ERP.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.imovel_limpeza WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Limpeza não encontrada.' USING ERRCODE = 'P0002'; END IF;

  IF v_acao = 'CONCLUIR' THEN
    IF l.status = 'CONCLUIDA' THEN RETURN to_jsonb(l); END IF;
    IF l.status <> 'PENDENTE' THEN RAISE EXCEPTION 'Só uma limpeza pendente pode ser concluída.' USING ERRCODE = '22023'; END IF;
    UPDATE public.imovel_limpeza
       SET status = 'CONCLUIDA', concluida_em = clock_timestamp(), concluida_por = v_actor,
           observacoes = coalesce(nullif(btrim(p_payload->>'observacoes'), ''), observacoes),
           updated_by = v_actor, updated_at = now()
     WHERE id = p_id RETURNING * INTO l;
  ELSIF v_acao = 'ATRIBUIR' THEN
    IF l.status <> 'PENDENTE' THEN RAISE EXCEPTION 'Só uma limpeza pendente pode mudar de responsável.' USING ERRCODE = '22023'; END IF;
    v_resp := nullif(p_payload->>'responsavel_id', '')::uuid;
    IF v_resp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = v_resp AND ativo) THEN
      RAISE EXCEPTION 'O responsável pela limpeza precisa ser um usuário ativo.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.imovel_limpeza SET responsavel_id = v_resp, updated_by = v_actor, updated_at = now()
     WHERE id = p_id RETURNING * INTO l;
  ELSE
    RAISE EXCEPTION 'Ação de limpeza inválida.' USING ERRCODE = '22023';
  END IF;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_acao_limpeza(bigint, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_acao_limpeza(bigint, text, jsonb, uuid) TO service_role;

-- --------------------------------------------------------------------------- situação do imóvel
-- Igual a 20261030010000, com LIMPEZA entre OCUPADO e RESERVADO. As colunas e a ordem não mudam.
CREATE OR REPLACE VIEW public.imovel_resumo WITH(security_invoker=true) AS
 SELECT i.*,
 CASE WHEN NOT i.ativo THEN 'INATIVO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='MANUTENCAO' AND o.periodo @> current_date) THEN 'MANUTENCAO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.tipo='LOCACAO' AND o.periodo @> current_date) THEN 'ALUGADO'
  WHEN EXISTS(SELECT 1 FROM public.reserva_imovel r WHERE r.imovel_id=i.id AND r.status='EM_ANDAMENTO' AND daterange(r.inicio,r.fim,'[)') @> current_date) THEN 'OCUPADO'
  WHEN EXISTS(SELECT 1 FROM public.imovel_limpeza l WHERE l.imovel_id=i.id AND l.status='PENDENTE') THEN 'LIMPEZA'
  WHEN EXISTS(SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=i.id AND o.ativo AND o.periodo @> current_date) THEN 'RESERVADO'
  ELSE 'DISPONIVEL' END::text AS situacao_operacional,
 CASE WHEN i.vendido_em IS NOT NULL THEN 'VENDIDO'
  WHEN EXISTS(SELECT 1 FROM public.venda_imovel v WHERE v.imovel_id=i.id AND v.status='RASCUNHO') THEN 'EM_NEGOCIACAO'
  ELSE 'DISPONIVEL' END::text AS situacao_comercial
 FROM public.imovel i;

-- --------------------------------------------------------------------------- permissão
INSERT INTO public.permissao(nome, descricao)
VALUES ('limpezas:gerenciar', 'Ver e gerenciar todas as limpezas de imóveis')
ON CONFLICT(nome) DO NOTHING;

INSERT INTO public.perfilpermissao(perfilid, permissaoid)
SELECT p.id, pe.id FROM public.perfil p CROSS JOIN public.permissao pe
 WHERE p.nome = 'Administrador' AND pe.nome = 'limpezas:gerenciar'
ON CONFLICT(perfilid, permissaoid) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
