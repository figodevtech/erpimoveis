-- "Voltar para pendente": reabre uma limpeza concluída ou cancelada.
--
-- Usada na aba Serviços do imóvel (e nos detalhes da Execução) quando a limpeza foi dada como
-- feita por engano, ou precisa ser refeita. A limpeza volta a PENDENTE, o imóvel volta a LIMPEZA
-- e ela reaparece na Execução do responsável. Saem a data, quem concluiu e as observações da
-- conclusão (a auditoria guarda o que havia).
--
-- Um imóvel tem no máximo uma limpeza pendente (imovel_limpeza_pendente_uidx): com outra já
-- aberta, a reabertura é recusada com a explicação.
--
-- imob_acao_limpeza: igual a 20261118120000, com a ação REABRIR.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

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
  ELSE
    RAISE EXCEPTION 'Ação de limpeza inválida.' USING ERRCODE = '22023';
  END IF;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_acao_limpeza(bigint, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_acao_limpeza(bigint, text, jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
