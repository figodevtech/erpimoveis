-- Edição do check-in e do check-out já registrados, pela aba "Check-in / Check-out" da reserva.
--
-- Mesmo diálogo do registro, com os dados preenchidos. A situação da reserva não muda; mudam:
--   EDITAR_CHECKIN:  checkin_em e checkin_observacoes (reserva em andamento ou concluída);
--   EDITAR_CHECKOUT: checkout_em e checkout_observacoes (reserva concluída) e, quando o payload
--                    traz solicitar_limpeza, a limpeza pedida nessa saída:
--                    - pendente: muda responsável e descrição; desmarcada, é cancelada;
--                    - cancelada e marcada de novo: volta a ficar pendente;
--                    - sem limpeza e marcada: abre a limpeza (como no check-out);
--                    - concluída: não muda.
-- Quem registrou (checkin_por/checkout_por) continua sendo quem fez a ação; a edição fica na
-- auditoria. Mudar o checkout_em move a competência do valor da reserva (gatilho de 20261109010000).
--
-- imob_acao_reserva: igual a 20261118150000, com as duas ações novas.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.imob_acao_reserva(p_id bigint,p_acao text,p_payload jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.reserva_imovel%ROWTYPE; l public.imovel_limpeza%ROWTYPE; v_actor uuid; v_acao text:=upper(p_acao); v_momento timestamptz;
 v_obs text:=left(nullif(btrim(p_payload->>'observacoes'),''),2000);
 v_resp uuid; v_desc text;
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
 ELSIF v_acao='EDITAR_CHECKIN' THEN
  IF r.status NOT IN ('EM_ANDAMENTO','CONCLUIDA') THEN
   RAISE EXCEPTION 'Esta reserva não tem check-in registrado para editar.' USING ERRCODE='22023';
  END IF;
  IF nullif(p_payload->>'data_registro','') IS NULL THEN RAISE EXCEPTION 'Informe a data e a hora do check-in.' USING ERRCODE='22023'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-in');
  IF r.checkout_em IS NOT NULL AND v_momento>r.checkout_em THEN
   RAISE EXCEPTION 'O check-in (%) não pode ser depois do check-out (%).',
    to_char(v_momento AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI'),
    to_char(r.checkout_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') USING ERRCODE='22023';
  END IF;
  UPDATE public.reserva_imovel SET checkin_em=v_momento,checkin_observacoes=v_obs WHERE id=p_id;
 ELSIF v_acao='EDITAR_CHECKOUT' THEN
  IF r.status<>'CONCLUIDA' THEN RAISE EXCEPTION 'Esta reserva não tem check-out registrado para editar.' USING ERRCODE='22023'; END IF;
  IF nullif(p_payload->>'data_registro','') IS NULL THEN RAISE EXCEPTION 'Informe a data e a hora do check-out.' USING ERRCODE='22023'; END IF;
  v_momento:=public.imob_momento_informado(p_payload,'check-out');
  IF r.checkin_em IS NOT NULL AND v_momento<r.checkin_em THEN
   RAISE EXCEPTION 'O check-out (%) não pode ser antes do check-in (%).',
    to_char(v_momento AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI'),
    to_char(r.checkin_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') USING ERRCODE='22023';
  END IF;
  UPDATE public.reserva_imovel SET checkout_em=v_momento,checkout_observacoes=v_obs WHERE id=p_id;
  -- Sem solicitar_limpeza no payload, a limpeza fica como está.
  IF p_payload ? 'solicitar_limpeza' THEN
   v_resp:=nullif(p_payload->>'responsavel_limpeza_id','')::uuid;
   v_desc:=left(nullif(btrim(p_payload->>'descricao_limpeza'),''),500);
   IF v_resp IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.usuario WHERE id=v_resp AND ativo) THEN
    RAISE EXCEPTION 'O responsável pela limpeza precisa ser um usuário ativo.' USING ERRCODE='22023';
   END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('imob-limpeza:'||r.imovel_id,0));
   SELECT * INTO l FROM public.imovel_limpeza WHERE reserva_id=p_id FOR UPDATE;
   IF (p_payload->>'solicitar_limpeza')='true' THEN
    IF NOT FOUND THEN
     PERFORM public.imob_solicitar_limpeza(r.imovel_id,r.id,v_resp,v_actor,v_desc);
    ELSIF l.status='PENDENTE' THEN
     UPDATE public.imovel_limpeza SET responsavel_id=v_resp,descricao=v_desc,updated_by=v_actor,updated_at=now() WHERE id=l.id;
    ELSIF l.status='CANCELADA' THEN
     -- Outra limpeza já aberta no imóvel recebe o pedido; senão, esta volta a ficar pendente.
     IF EXISTS(SELECT 1 FROM public.imovel_limpeza WHERE imovel_id=r.imovel_id AND status='PENDENTE') THEN
      PERFORM public.imob_solicitar_limpeza(r.imovel_id,NULL,v_resp,v_actor,v_desc);
     ELSE
      UPDATE public.imovel_limpeza SET status='PENDENTE',responsavel_id=v_resp,descricao=v_desc,
        solicitada_em=now(),solicitada_por=v_actor,updated_by=v_actor,updated_at=now() WHERE id=l.id;
     END IF;
    END IF;
   ELSIF FOUND AND l.status='PENDENTE' THEN
    UPDATE public.imovel_limpeza SET status='CANCELADA',updated_by=v_actor,updated_at=now() WHERE id=l.id;
   END IF;
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
