-- Quem registrou o check-in e o check-out da reserva, e as observações escritas no diálogo.
--
-- Até aqui ficava só o momento (checkin_em/checkout_em, 20261108150000); as observações do
-- diálogo do ERP eram descartadas e quem registrou só aparecia na auditoria. Agora:
--   checkin_por / checkout_por: operador do ERP que registrou a ação;
--   checkin_observacoes / checkout_observacoes: o que ele escreveu (payload `observacoes`).
-- A aba "Check-in / Check-out" da reserva mostra esses dados com a limpeza pedida na saída.
--
-- Reservas já em andamento ou concluídas recebem o operador a partir da auditoria
-- (imob_auditar grava a linha inteira, com o operador da ação); sem registro, fica vazio.
--
-- imob_acao_reserva: igual a 20261118140000, gravando os campos novos.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.reserva_imovel
  ADD COLUMN IF NOT EXISTS checkin_por uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_por uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkin_observacoes text CHECK (char_length(checkin_observacoes) <= 2000),
  ADD COLUMN IF NOT EXISTS checkout_observacoes text CHECK (char_length(checkout_observacoes) <= 2000);

COMMENT ON COLUMN public.reserva_imovel.checkin_por IS 'Operador do ERP que registrou o check-in.';
COMMENT ON COLUMN public.reserva_imovel.checkout_por IS 'Operador do ERP que registrou o check-out.';
COMMENT ON COLUMN public.reserva_imovel.checkin_observacoes IS 'Observações escritas ao registrar o check-in.';
COMMENT ON COLUMN public.reserva_imovel.checkout_observacoes IS 'Observações escritas ao registrar o check-out.';

-- Operador das ações já registradas, pela auditoria: a mudança de situação mais recente para
-- EM_ANDAMENTO (check-in) e para CONCLUIDA (check-out). Idempotente: só preenche o vazio.
DO $preencher$
BEGIN
  IF to_regclass('public.auditoria_evento') IS NULL THEN RETURN; END IF;
  UPDATE public.reserva_imovel r SET checkin_por = a.usuario_id
    FROM (
      SELECT DISTINCT ON (e.registro_id) e.registro_id, e.usuario_id
        FROM public.auditoria_evento e JOIN public.usuario u ON u.id = e.usuario_id
       WHERE e.tabela = 'reserva_imovel' AND e.operacao = 'UPDATE'
         AND e.dados_novos->>'status' = 'EM_ANDAMENTO' AND e.dados_anteriores->>'status' = 'CONFIRMADA'
       ORDER BY e.registro_id, e.ocorrido_em DESC, e.id DESC
    ) a
   WHERE a.registro_id = r.id::text AND r.checkin_por IS NULL AND r.status IN ('EM_ANDAMENTO', 'CONCLUIDA');
  UPDATE public.reserva_imovel r SET checkout_por = a.usuario_id
    FROM (
      SELECT DISTINCT ON (e.registro_id) e.registro_id, e.usuario_id
        FROM public.auditoria_evento e JOIN public.usuario u ON u.id = e.usuario_id
       WHERE e.tabela = 'reserva_imovel' AND e.operacao = 'UPDATE'
         AND e.dados_novos->>'status' = 'CONCLUIDA' AND e.dados_anteriores->>'status' = 'EM_ANDAMENTO'
       ORDER BY e.registro_id, e.ocorrido_em DESC, e.id DESC
    ) a
   WHERE a.registro_id = r.id::text AND r.checkout_por IS NULL AND r.status = 'CONCLUIDA';
END $preencher$;

-- CREATE OR REPLACE preserva as permissões já concedidas a imob_acao_reserva.
CREATE OR REPLACE FUNCTION public.imob_acao_reserva(p_id bigint,p_acao text,p_payload jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.reserva_imovel%ROWTYPE; v_actor uuid; v_acao text:=upper(p_acao); v_momento timestamptz;
 v_obs text:=left(nullif(btrim(p_payload->>'observacoes'),''),2000);
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
  UPDATE public.reserva_imovel SET status='EM_ANDAMENTO',checkin_em=v_momento,checkin_por=v_actor,checkin_observacoes=v_obs WHERE id=p_id;
 ELSIF v_acao IN ('CHECKOUT','CHECK_OUT','CONCLUIR') THEN
  IF r.status='CONCLUIDA' THEN RETURN to_jsonb(r); END IF;
  IF r.status<>'EM_ANDAMENTO' THEN RAISE EXCEPTION 'Check-out exige check-in registrado.'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-out');
  IF r.checkin_em IS NOT NULL AND v_momento<r.checkin_em THEN
   RAISE EXCEPTION 'O check-out (%) não pode ser antes do check-in (%).',
    to_char(v_momento AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI'),
    to_char(r.checkin_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') USING ERRCODE='22023';
  END IF;
  UPDATE public.reserva_imovel SET status='CONCLUIDA',checkout_em=v_momento,checkout_por=v_actor,checkout_observacoes=v_obs WHERE id=p_id;
  -- Limpeza pedida no diálogo do check-out: abre junto, ou nada acontece.
  IF coalesce(p_payload->>'solicitar_limpeza','false')='true' THEN
   PERFORM public.imob_solicitar_limpeza(r.imovel_id,r.id,nullif(p_payload->>'responsavel_limpeza_id','')::uuid,v_actor,p_payload->>'descricao_limpeza');
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

NOTIFY pgrst, 'reload schema';

COMMIT;
