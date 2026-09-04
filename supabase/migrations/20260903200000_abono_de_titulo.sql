-- Abono de título a receber.
--
-- Hoje um título "a receber" só tem duas saídas: baixar (dinheiro de verdade
-- no banco) ou excluir (a dívida some, e a OS/venda não fica quitada). Falta
-- perdoar a cobrança sem mexer no caixa, mantendo a OS/venda quitada e
-- deixando rastro — é o que esta migration acrescenta.
--
-- Segue o mesmo desenho de `baixar_transacao_pendente` /
-- `estornar_baixa_transacao`: RPC SECURITY DEFINER, nunca apaga histórico,
-- recalcula o status financeiro do documento no final. Mas não precisa do
-- ramo de baixa parcial (`baixa_de_transacao_id`) — abono nunca move banco, e
-- a trava "ou banco, ou filhas" nunca é acionada por ele. Por decisão de
-- negócio, o abono sempre fecha o saldo em aberto inteiro; nunca uma parte.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) As colunas
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS abonado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS abonado_por uuid,
  ADD COLUMN IF NOT EXISTS abonado_em timestamptz,
  ADD COLUMN IF NOT EXISTS abono_motivo text;

COMMENT ON COLUMN public.transacao.abonado IS
  'Título a receber perdoado sem passar pelo banco. pendente=false e banco_id=NULL, igual ao título quitado por antecipação — a diferença é que aqui nenhum dinheiro entrou em lugar nenhum.';
COMMENT ON COLUMN public.transacao.abonado_por IS 'Quem abonou a cobrança.';
COMMENT ON COLUMN public.transacao.abonado_em IS 'Quando a cobrança foi abonada.';
COMMENT ON COLUMN public.transacao.abono_motivo IS 'Motivo do abono, texto livre e opcional.';

-- ---------------------------------------------------------------------------
-- 2) O histórico aprende uma terceira operação
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao_baixa_historico
  DROP CONSTRAINT IF EXISTS transacao_baixa_historico_operacao_check;

ALTER TABLE public.transacao_baixa_historico
  ADD CONSTRAINT transacao_baixa_historico_operacao_check
    CHECK (operacao IN ('BAIXA', 'ESTORNO', 'ABONO'));

-- ---------------------------------------------------------------------------
-- 3) Abonar
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.abonar_transacao_pendente(
  p_transacao_id bigint,
  p_abonado_por uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_atual public.transacao%ROWTYPE;
  v_transacao public.transacao%ROWTYPE;
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transação inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_atual.pendente, false) THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  IF upper(v_atual.tipo::text) <> 'RECEITA' THEN
    RAISE EXCEPTION 'Só é possível abonar uma cobrança a receber.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.ordemservicoid IS NULL AND v_atual.vendaid IS NULL THEN
    RAISE EXCEPTION 'Este lançamento não está ligado a uma OS ou venda.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.evento_financeiro_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este lançamento é um evento financeiro da OS, não uma cobrança avulsa.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.adiantamento_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Este título está ligado à antecipação #%. Desfaça a antecipação primeiro.',
      v_atual.adiantamento_id USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_atual.eh_adiantamento, false) THEN
    RAISE EXCEPTION 'Isto é uma antecipação, não uma cobrança avulsa.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta cobrança faz parte do pagamento múltiplo #%. Desfaça o grupo primeiro.',
      v_atual.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.transacao
     SET pendente = false,
         banco_id = NULL,
         metodopagamento = NULL,
         baixado_por = NULL,
         pago_em = now(),
         abonado = true,
         abonado_por = p_abonado_por,
         abonado_em = now(),
         abono_motivo = nullif(btrim(coalesce(p_motivo, '')), ''),
         updated_at = now()
   WHERE id = p_transacao_id
     AND pendente = true
     AND is_deleted = false
  RETURNING * INTO v_transacao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id, coalesce(v_transacao.vencimento_em, v_transacao.data), v_transacao.pago_em,
    p_abonado_por, NULL, NULL, 'ABONO'
  );

  IF v_transacao.ordemservicoid IS NOT NULL THEN
    PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
  END IF;
  IF v_transacao.vendaid IS NOT NULL THEN
    PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', false,
    'abonado', true,
    'abonado_em', v_transacao.abonado_em
  );
END;
$function$;

ALTER FUNCTION public.abonar_transacao_pendente(bigint, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.abonar_transacao_pendente(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abonar_transacao_pendente(bigint, uuid, text) TO service_role;

COMMENT ON FUNCTION public.abonar_transacao_pendente(bigint, uuid, text) IS
  'Perdoa um título a receber inteiro sem lançar nada no banco: pendente vira false, banco_id fica nulo, e a OS/venda continua contando o valor de face como recebido. Recusa antecipação, pagamento múltiplo e o que não for RECEITA ligado a OS/venda.';

-- ---------------------------------------------------------------------------
-- 4) Estornar reconhece o abono
-- ---------------------------------------------------------------------------
--
-- Sem este ramo, um título que teve baixa parcial real antes do abono cairia
-- no check genérico de "pago em partes" (linhas abaixo) e o estorno recusaria
-- mandando "estornar os pagamentos um a um" — errado aqui, porque as baixas
-- parciais são dinheiro de verdade e não têm nada a ver com o abono do resto.

CREATE OR REPLACE FUNCTION public.estornar_baixa_transacao(
  p_transacao_id bigint,
  p_estornado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_acrescimos_removidos numeric(14,2) := 0;
  v_valor_reaberto numeric(14,2);
  v_baixa_do_titulo boolean := false;
  v_titulo bigint;
BEGIN
  SELECT * INTO v_transacao
    FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_transacao.baixa_de_transacao_id IS NOT NULL THEN
    v_titulo := v_transacao.baixa_de_transacao_id;

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_titulo, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, v_transacao.banco_id, v_transacao.metodopagamento, 'ESTORNO'
    );

    DELETE FROM public.transacao WHERE id = p_transacao_id;

    SELECT * INTO v_transacao FROM public.transacao WHERE id = v_titulo;

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_titulo,
      'baixa_estornada', p_transacao_id,
      'valor_baixado', v_transacao.valor_baixado,
      'pendente', v_transacao.pendente,
      'parcial', true
    );
  END IF;

  IF coalesce(v_transacao.pendente, false) THEN
    RAISE EXCEPTION 'Esta transação não está liquidada: não há baixa a estornar.'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_transacao.abonado, false) THEN
    UPDATE public.transacao
       SET pendente = true,
           data = coalesce(vencimento_em, data),
           pago_em = NULL,
           abonado = false,
           abonado_por = NULL,
           abonado_em = NULL,
           abono_motivo = NULL,
           updated_at = now()
     WHERE id = p_transacao_id;

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_transacao.id, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, NULL, NULL, 'ESTORNO'
    );

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_transacao.id,
      'pendente', true,
      'abono_desfeito', true
    );
  END IF;

  IF v_transacao.adiantamento_id IS NOT NULL THEN
    SELECT coalesce(a.adiantamento_manteve_pendentes, false) INTO v_baixa_do_titulo
      FROM public.transacao a WHERE a.id = v_transacao.adiantamento_id;

    IF NOT coalesce(v_baixa_do_titulo, false) THEN
      RAISE EXCEPTION
        'Este título foi liquidado pela antecipação #%. Desfaça a antecipação: ela devolve este título e os irmãos para em aberto de uma vez.',
        v_transacao.adiantamento_id USING ERRCODE = '22023';
    END IF;
  END IF;

  IF coalesce(v_transacao.eh_adiantamento, false) THEN
    RAISE EXCEPTION
      'Esta é uma antecipação, não a baixa de um título. Excluí-la é que devolve os títulos para em aberto.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta baixa é uma perna do pagamento múltiplo #%. Desfaça o pagamento inteiro.',
      v_transacao.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;

  /*
   * Título comum pago em partes: cada pagamento tem data, banco e valor próprios
   * e sai do extrato sozinho, então o estorno é de cada um.
   *
   * O antecipado é o contrário: a baixa foi UMA — ela quitou o título e criou o
   * repasse no mesmo ato —, e desfazê-la desfaz as duas coisas.
   */
  IF v_transacao.adiantamento_id IS NULL AND EXISTS (
    SELECT 1 FROM public.transacao f
     WHERE f.baixa_de_transacao_id = p_transacao_id AND f.is_deleted = false
  ) THEN
    RAISE EXCEPTION
      'Este título foi pago em partes. Estorne os pagamentos dele, um a um.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.adiantamento_id IS NOT NULL THEN
    DELETE FROM public.transacao WHERE baixa_de_transacao_id = p_transacao_id;
  END IF;

  UPDATE public.transacao
     SET pendente = true,
         data = coalesce(vencimento_em, data),
         pago_em = NULL,
         baixado_por = NULL,
         banco_id = CASE WHEN v_transacao.adiantamento_id IS NOT NULL THEN NULL ELSE banco_id END,
         updated_at = now()
   WHERE id = p_transacao_id;

  WITH removidos AS (
    DELETE FROM public.transacao_ajuste
     WHERE transacao_id = p_transacao_id
       AND natureza = 'ACRESCIMO'
    RETURNING valor_calculado
  )
  SELECT coalesce(sum(valor_calculado), 0) INTO v_acrescimos_removidos FROM removidos;

  v_valor_reaberto := round(coalesce(v_transacao.valor_base, v_transacao.valor), 2);

  UPDATE public.transacao
     SET valor = v_valor_reaberto,
         valor_acrescimos = 0,
         "valorLiquido" = round(v_valor_reaberto - coalesce(valor_descontos, 0), 2),
         updated_at = now()
   WHERE id = p_transacao_id;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id,
    coalesce(v_transacao.vencimento_em, v_transacao.data),
    coalesce(v_transacao.pago_em, v_transacao.data),
    p_estornado_por,
    v_transacao.banco_id,
    v_transacao.metodopagamento,
    'ESTORNO'
  );

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', true,
    'valor', v_valor_reaberto,
    'acrescimos_removidos', v_acrescimos_removidos,
    'vencimento_em', coalesce(v_transacao.vencimento_em, v_transacao.data)
  );
END;
$$;

ALTER FUNCTION public.estornar_baixa_transacao(bigint, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) TO service_role;

COMMIT;
