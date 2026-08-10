BEGIN;

CREATE OR REPLACE FUNCTION public.cancelar_venda(p_venda_id bigint, p_motivo text, p_cancelada_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda public.venda%ROWTYPE;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_transacoes_excluidas integer := 0;
  v_produtos_devolvidos integer := 0;
BEGIN
  IF v_motivo IS NULL OR char_length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Informe um motivo com pelo menos 3 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_venda FROM public.venda WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_venda.status::text IN ('CANCELADA', 'CANCELADO') THEN
    RAISE EXCEPTION 'Esta venda já está cancelada.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.nfe
    WHERE vendaid = p_venda_id AND status::text NOT IN ('RASCUNHO', 'CANCELADA', 'REJEITADA')
  ) THEN
    RAISE EXCEPTION 'Cancele a NF-e autorizada ou em processamento antes de cancelar a venda.' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO v_produtos_devolvidos
  FROM public.vendaproduto_baixa WHERE venda_id = p_venda_id;
  PERFORM public.fn_estornar_estoque_venda(p_venda_id::integer);

  -- Decisão temporária: remove todas as transações por exclusão lógica e não
  -- cria lançamentos inversos. Os registros continuam no banco para auditoria.
  UPDATE public.transacao
  SET pendente = false, is_deleted = true, deleted_at = now(), deleted_by = p_cancelada_by,
      updated_at = now(), updated_by = p_cancelada_by
  WHERE vendaid = p_venda_id AND NOT is_deleted;
  GET DIAGNOSTICS v_transacoes_excluidas = ROW_COUNT;

  UPDATE public.venda
  SET status = 'CANCELADA', motivo_cancelamento = v_motivo, cancelada_at = now(),
      cancelada_by = p_cancelada_by, updated_by = p_cancelada_by, updatedat = now(), status_entrega = NULL
  WHERE id = p_venda_id;

  RETURN jsonb_build_object(
    'vendaId', p_venda_id, 'status', 'CANCELADA',
    'produtosDevolvidos', v_produtos_devolvidos,
    'transacoesExcluidas', v_transacoes_excluidas,
    'estornosCriados', 0
  );
END;
$$;

ALTER FUNCTION public.cancelar_venda(bigint, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancelar_venda(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_venda(bigint, text, uuid) TO service_role;

COMMIT;
