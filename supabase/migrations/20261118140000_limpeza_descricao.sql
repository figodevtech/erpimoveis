-- Descrição do pedido de limpeza, informada no check-out (ex.: "trocar enxoval completo").
--
-- Depende de 20261118120000_limpeza_imovel.sql. `descricao` é o que se pede no check-out;
-- `observacoes` continua sendo o que anota quem conclui a limpeza.
--
-- - imob_solicitar_limpeza ganha p_descricao. A versão de 4 argumentos sai, para não ficar
--   ambígua com a nova. Limpeza já aberta: a descrição nova se soma à anterior com " · ".
-- - imob_acao_reserva: igual a 20261118120000; o CHECKOUT repassa descricao_limpeza.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.imovel_limpeza ADD COLUMN IF NOT EXISTS descricao text CHECK (char_length(descricao) <= 500);

COMMENT ON COLUMN public.imovel_limpeza.descricao IS 'O que pedir na limpeza, informado no check-out (ex.: trocar enxoval completo).';
COMMENT ON COLUMN public.imovel_limpeza.observacoes IS 'Anotação de quem concluiu a limpeza.';

DROP FUNCTION IF EXISTS public.imob_solicitar_limpeza(bigint, bigint, uuid, uuid);
CREATE OR REPLACE FUNCTION public.imob_solicitar_limpeza(p_imovel_id bigint, p_reserva_id bigint, p_responsavel uuid, p_actor uuid, p_descricao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE l public.imovel_limpeza%ROWTYPE; v_descricao text := nullif(btrim(p_descricao), '');
BEGIN
  IF p_responsavel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = p_responsavel AND ativo) THEN
    RAISE EXCEPTION 'O responsável pela limpeza precisa ser um usuário ativo.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_descricao) > 500 THEN
    RAISE EXCEPTION 'A descrição da limpeza deve ter até 500 caracteres.' USING ERRCODE = '22023';
  END IF;
  -- Dois check-outs do mesmo imóvel ao mesmo tempo não abrem duas limpezas.
  PERFORM pg_advisory_xact_lock(hashtextextended('imob-limpeza:' || p_imovel_id, 0));
  SELECT * INTO l FROM public.imovel_limpeza WHERE imovel_id = p_imovel_id AND status = 'PENDENTE' FOR UPDATE;
  IF FOUND THEN
    IF (l.responsavel_id IS NULL AND p_responsavel IS NOT NULL)
       OR (v_descricao IS NOT NULL AND v_descricao IS DISTINCT FROM l.descricao) THEN
      UPDATE public.imovel_limpeza
         SET responsavel_id = coalesce(responsavel_id, p_responsavel),
             descricao = CASE WHEN v_descricao IS NULL OR v_descricao = descricao THEN descricao
                              WHEN descricao IS NULL THEN v_descricao
                              ELSE left(descricao || ' · ' || v_descricao, 500) END,
             updated_by = p_actor, updated_at = now()
       WHERE id = l.id RETURNING * INTO l;
    END IF;
    RETURN to_jsonb(l);
  END IF;
  INSERT INTO public.imovel_limpeza (imovel_id, reserva_id, responsavel_id, descricao, solicitada_por, updated_by)
  VALUES (p_imovel_id, p_reserva_id, p_responsavel, v_descricao, p_actor, p_actor)
  RETURNING * INTO l;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_solicitar_limpeza(bigint, bigint, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_solicitar_limpeza(bigint, bigint, uuid, uuid, text) TO service_role;

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
