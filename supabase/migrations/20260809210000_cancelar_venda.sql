BEGIN;

ALTER TABLE public.venda
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
  ADD COLUMN IF NOT EXISTS cancelada_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_by uuid REFERENCES public.usuario(id) ON DELETE SET NULL;

UPDATE public.venda
SET motivo_cancelamento = 'Não informado (cancelamento anterior à exigência de motivo)',
    cancelada_at = coalesce(cancelada_at, updatedat, now())
WHERE status::text IN ('CANCELADA', 'CANCELADO')
  AND nullif(btrim(motivo_cancelamento), '') IS NULL;

ALTER TABLE public.venda DROP CONSTRAINT IF EXISTS venda_motivo_cancelamento_check;
ALTER TABLE public.venda ADD CONSTRAINT venda_motivo_cancelamento_check CHECK (
  status::text NOT IN ('CANCELADA', 'CANCELADO')
  OR nullif(btrim(motivo_cancelamento), '') IS NOT NULL
);

CREATE OR REPLACE FUNCTION public.cancelar_venda(
  p_venda_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda public.venda%ROWTYPE;
  v_transacao public.transacao%ROWTYPE;
  v_tipo_estorno public.tipos_transacao;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_pendentes_canceladas integer := 0;
  v_estornos_criados integer := 0;
  v_produtos_devolvidos integer := 0;
BEGIN
  IF v_motivo IS NULL OR char_length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Informe um motivo com pelo menos 3 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_venda FROM public.venda WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_venda.status::text IN ('CANCELADA', 'CANCELADO') THEN
    RAISE EXCEPTION 'Esta venda já está cancelada.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.nfe
    WHERE vendaid = p_venda_id AND status::text NOT IN ('RASCUNHO', 'CANCELADA', 'REJEITADA')
  ) THEN
    RAISE EXCEPTION 'Cancele a NF-e autorizada ou em processamento antes de cancelar a venda.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO v_produtos_devolvidos
  FROM public.vendaproduto_baixa WHERE venda_id = p_venda_id;

  -- A função usa vendaproduto_baixa como fonte oficial e é idempotente.
  PERFORM public.fn_estornar_estoque_venda(p_venda_id::integer);

  FOR v_transacao IN
    SELECT * FROM public.transacao
    WHERE vendaid = p_venda_id
      AND NOT is_deleted
      AND estorno_transacao_id IS NULL
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_transacao.pendente THEN
      UPDATE public.transacao
      SET pendente = false,
          is_deleted = true,
          deleted_at = now(),
          deleted_by = p_cancelada_by,
          updated_at = now(),
          updated_by = p_cancelada_by
      WHERE id = v_transacao.id;
      v_pendentes_canceladas := v_pendentes_canceladas + 1;
    ELSE
      v_tipo_estorno := CASE v_transacao.tipo
        WHEN 'DESPESA'::public.tipos_transacao THEN 'RECEITA'::public.tipos_transacao
        WHEN 'RECEITA'::public.tipos_transacao THEN 'DESPESA'::public.tipos_transacao
        WHEN 'DEPOSITO'::public.tipos_transacao THEN 'SAQUE'::public.tipos_transacao
        ELSE 'DEPOSITO'::public.tipos_transacao
      END;

      INSERT INTO public.transacao (
        descricao, descricao_pagamento, valor, "valorLiquido", data, metodopagamento,
        categoria, categoria_id, tipo, cliente_id, fornecedor_id, banco_id,
        nomepagador, cpfcnpjpagador, pendente, plano_de_conta_id, plano_de_conta,
        centro_custo_id, centro_custo, vendaid, estorno_transacao_id,
        created_by, updated_by
      ) VALUES (
        'Estorno: ' || v_transacao.descricao, v_transacao.descricao_pagamento,
        v_transacao.valor, v_transacao."valorLiquido", now(), v_transacao.metodopagamento,
        v_transacao.categoria, v_transacao.categoria_id, v_tipo_estorno,
        v_transacao.cliente_id, v_transacao.fornecedor_id, v_transacao.banco_id,
        v_transacao.nomepagador, v_transacao.cpfcnpjpagador, false,
        v_transacao.plano_de_conta_id, v_transacao.plano_de_conta,
        v_transacao.centro_custo_id, v_transacao.centro_custo,
        p_venda_id, v_transacao.id, p_cancelada_by, p_cancelada_by
      );
      v_estornos_criados := v_estornos_criados + 1;
    END IF;
  END LOOP;

  UPDATE public.venda
  SET status = 'CANCELADA',
      motivo_cancelamento = v_motivo,
      cancelada_at = now(),
      cancelada_by = p_cancelada_by,
      updated_by = p_cancelada_by,
      updatedat = now(),
      status_entrega = NULL
  WHERE id = p_venda_id;

  RETURN jsonb_build_object(
    'vendaId', p_venda_id,
    'status', 'CANCELADA',
    'produtosDevolvidos', v_produtos_devolvidos,
    'transacoesPendentesCanceladas', v_pendentes_canceladas,
    'estornosCriados', v_estornos_criados
  );
END;
$$;

ALTER FUNCTION public.cancelar_venda(bigint, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancelar_venda(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_venda(bigint, text, uuid) TO service_role;

COMMIT;
