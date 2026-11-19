-- Edição dos dados de uma limpeza, pela aba Serviços do cadastro do imóvel.
--
-- Ação EDITAR de imob_acao_limpeza. Só muda o que vier no payload:
--   descricao       o que fazer (até 500 caracteres; vazio limpa) — qualquer situação;
--   responsavel_id  usuário ativo ou nulo — qualquer situação (corrige quem ficou com o serviço);
--   observacoes     anotação da conclusão (até 2000; vazio limpa) — só concluída;
--   data_conclusao + hora_conclusao  momento da conclusão, no fuso do imobiliário — só concluída;
--                   não pode estar no futuro nem antes do pedido.
-- Quem pode editar é decidido na API (quem edita imóveis ou gerencia limpezas).
--
-- imob_acao_limpeza: igual a 20261118170000, com a ação EDITAR.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.imob_acao_limpeza(p_id bigint, p_acao text, p_payload jsonb, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE l public.imovel_limpeza%ROWTYPE; v_actor uuid; v_acao text := upper(coalesce(p_acao, '')); v_resp uuid;
  v_descricao text; v_obs text; v_conclusao timestamptz;
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
  ELSIF v_acao = 'REABRIR' THEN
    IF l.status = 'PENDENTE' THEN RETURN to_jsonb(l); END IF;
    -- Mesma trava do pedido de limpeza: dois pedidos do imóvel ao mesmo tempo não se cruzam.
    PERFORM pg_advisory_xact_lock(hashtextextended('imob-limpeza:' || l.imovel_id, 0));
    IF EXISTS (SELECT 1 FROM public.imovel_limpeza WHERE imovel_id = l.imovel_id AND status = 'PENDENTE' AND id <> l.id) THEN
      RAISE EXCEPTION 'Este imóvel já tem outra limpeza pendente. Conclua aquela antes de reabrir esta.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.imovel_limpeza
       SET status = 'PENDENTE', concluida_em = NULL, concluida_por = NULL, observacoes = NULL,
           updated_by = v_actor, updated_at = now()
     WHERE id = p_id RETURNING * INTO l;
  ELSIF v_acao = 'EDITAR' THEN
    v_descricao := CASE WHEN p_payload ? 'descricao' THEN nullif(btrim(p_payload->>'descricao'), '') ELSE l.descricao END;
    IF char_length(v_descricao) > 500 THEN
      RAISE EXCEPTION 'A descrição da limpeza deve ter até 500 caracteres.' USING ERRCODE = '22023';
    END IF;
    v_resp := CASE WHEN p_payload ? 'responsavel_id' THEN nullif(p_payload->>'responsavel_id', '')::uuid ELSE l.responsavel_id END;
    IF v_resp IS DISTINCT FROM l.responsavel_id AND v_resp IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = v_resp AND ativo) THEN
      RAISE EXCEPTION 'O responsável pela limpeza precisa ser um usuário ativo.' USING ERRCODE = '22023';
    END IF;
    v_obs := l.observacoes;
    v_conclusao := l.concluida_em;
    IF l.status = 'CONCLUIDA' THEN
      IF p_payload ? 'observacoes' THEN v_obs := nullif(btrim(p_payload->>'observacoes'), ''); END IF;
      IF char_length(v_obs) > 2000 THEN
        RAISE EXCEPTION 'As observações da conclusão devem ter até 2000 caracteres.' USING ERRCODE = '22023';
      END IF;
      IF nullif(p_payload->>'data_conclusao', '') IS NOT NULL THEN
        v_conclusao := public.imob_momento_informado(
          jsonb_build_object('data_registro', p_payload->>'data_conclusao', 'hora_registro', p_payload->>'hora_conclusao'),
          'conclusão da limpeza');
        IF v_conclusao < l.solicitada_em THEN
          RAISE EXCEPTION 'A conclusão (%) não pode ser antes do pedido da limpeza (%).',
            to_char(v_conclusao AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY HH24:MI'),
            to_char(l.solicitada_em AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY HH24:MI') USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
    UPDATE public.imovel_limpeza
       SET descricao = v_descricao, responsavel_id = v_resp, observacoes = v_obs, concluida_em = v_conclusao,
           updated_by = v_actor, updated_at = now()
     WHERE id = p_id RETURNING * INTO l;
  ELSE
    RAISE EXCEPTION 'Ação de limpeza inválida.' USING ERRCODE = '22023';
  END IF;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_acao_limpeza(bigint, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_acao_limpeza(bigint, text, jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
