-- Momento real do check-in e do check-out da reserva.
--
-- Até aqui a ação só trocava a situação (CONFIRMADA → EM_ANDAMENTO → CONCLUIDA), sem guardar
-- quando aconteceu. Agora o diálogo do ERP informa data e hora (com o momento atual como padrão,
-- para registrar depois uma entrada que já ocorreu) e o banco grava em checkin_em/checkout_em.
-- Os horários previstos continuam em horario_checkin/horario_checkout (20261102220000).
--
-- Data e hora chegam como dia civil e HH:MM e são lidas no fuso do imobiliário, como os demais
-- lançamentos (America/Fortaleza). Sem elas, vale o momento da ação.
-- O resto de imob_acao_reserva fica exatamente como em 20261029173114.
BEGIN;

ALTER TABLE public.reserva_imovel
  ADD COLUMN IF NOT EXISTS checkin_em timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_em timestamptz;

COMMENT ON COLUMN public.reserva_imovel.checkin_em IS 'Momento em que a entrada do hóspede foi registrada (informado no ERP).';
COMMENT ON COLUMN public.reserva_imovel.checkout_em IS 'Momento em que a saída do hóspede foi registrada (informado no ERP).';

-- Data e hora informadas no fuso do imobiliário; nulas, o momento da ação. Não aceita futuro:
-- registra-se o que já aconteceu (margem de 5 minutos para relógios fora de sincronia).
CREATE OR REPLACE FUNCTION public.imob_momento_informado(p_payload jsonb, p_rotulo text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_data date := nullif(p_payload->>'data_registro', '')::date;
  v_hora time := coalesce(nullif(p_payload->>'hora_registro', '')::time, time '00:00');
  v_momento timestamptz;
BEGIN
  IF v_data IS NULL THEN RETURN clock_timestamp(); END IF;
  v_momento := (v_data + v_hora) AT TIME ZONE 'America/Fortaleza';
  IF v_momento > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'A data e a hora do % não podem estar no futuro.', p_rotulo USING ERRCODE = '22023';
  END IF;
  RETURN v_momento;
END $$;

REVOKE ALL ON FUNCTION public.imob_momento_informado(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_momento_informado(jsonb, text) TO service_role;

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
