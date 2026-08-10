-- Pagamento antecipado de OS.
--
-- A execução e o financeiro passam a ser dimensões independentes:
--   * ORCAMENTO_APROVADO/EM_ANDAMENTO podem receber pagamentos e títulos;
--   * título pendente compromete saldo e também quita a OS (ex.: boletos);
--   * pagamento antecipado não encerra a execução;
--   * somente uma OS que já chegou a PAGAMENTO pode ser concluída pela quitação.
--
-- O limite financeiro é validado no banco, sob advisory lock, para duas
-- requisições concorrentes não conseguirem comprometer o mesmo saldo.
BEGIN;

CREATE OR REPLACE FUNCTION public.resumo_financeiro_os(p_ordemservicoid integer)
RETURNS TABLE (
  total_devido numeric(14,2),
  valor_recebido numeric(14,2),
  valor_pendente numeric(14,2),
  valor_comprometido numeric(14,2),
  saldo_a_receber numeric(14,2),
  saldo_disponivel_lancamento numeric(14,2),
  quantidade_transacoes bigint,
  quitada boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH dados_os AS (
    SELECT round(
      greatest(coalesce(o.orcamentototal, 0), 0) +
      CASE
        WHEN o.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
          greatest(coalesce(o.orcamentototal, 0), 0) *
          least(greatest(coalesce(o.acrescimo_financeiro_valor, 0), 0), 100) / 100
        WHEN o.acrescimo_financeiro_tipo = 'FIXO' THEN
          greatest(coalesce(o.acrescimo_financeiro_valor, 0), 0)
        ELSE 0
      END,
      2
    )::numeric(14,2) AS total
    FROM public.ordemservico o
    WHERE o.id = p_ordemservicoid
      AND coalesce(o.is_deleted, false) = false
  ),
  pagamentos AS (
    SELECT
      coalesce(round(sum(
        greatest(coalesce(t.valor, 0) - greatest(coalesce(t.valor_acrescimos, 0), 0), 0)
      ) FILTER (WHERE t.pendente = false), 2), 0)::numeric(14,2) AS recebido,
      coalesce(round(sum(
        greatest(coalesce(t.valor, 0) - greatest(coalesce(t.valor_acrescimos, 0), 0), 0)
      ) FILTER (WHERE t.pendente = true), 2), 0)::numeric(14,2) AS pendente,
      count(*)::bigint AS quantidade
    FROM public.transacao t
    WHERE t.ordemservicoid = p_ordemservicoid
      AND upper(t.tipo::text) = 'RECEITA'
      AND t.evento_financeiro_id IS NULL
      AND t.is_deleted = false
  )
  SELECT
    d.total,
    p.recebido,
    p.pendente,
    round(p.recebido + p.pendente, 2)::numeric(14,2),
    greatest(round(d.total - p.recebido, 2), 0)::numeric(14,2),
    greatest(round(d.total - p.recebido - p.pendente, 2), 0)::numeric(14,2),
    p.quantidade,
    (d.total > 0 AND round(p.recebido + p.pendente, 2) >= d.total)
  FROM dados_os d
  CROSS JOIN pagamentos p;
$function$;

CREATE OR REPLACE FUNCTION public.recalcular_status_financeiro_os(p_ordemservicoid integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_pagamento_concluido_em timestamptz;
  v_total_devido numeric(14,2);
  v_valor_comprometido numeric(14,2);
  v_quitada boolean;
  v_novo_status text;
  v_novo_pagamento_concluido_em timestamptz;
BEGIN
  SELECT o.status::text, o.pagamento_concluido_em
    INTO v_status, v_pagamento_concluido_em
  FROM public.ordemservico o
  WHERE o.id = p_ordemservicoid
    AND coalesce(o.is_deleted, false) = false;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT r.total_devido, r.valor_comprometido, r.quitada
    INTO v_total_devido, v_valor_comprometido, v_quitada
  FROM public.resumo_financeiro_os(p_ordemservicoid) r;

  v_novo_status := v_status;
  IF v_status = 'PAGAMENTO' AND v_quitada THEN
    v_novo_status := 'CONCLUIDO';
  ELSIF v_status = 'CONCLUIDO'
        AND v_total_devido > 0
        AND v_valor_comprometido < v_total_devido THEN
    v_novo_status := 'PAGAMENTO';
  END IF;

  v_novo_pagamento_concluido_em := CASE
    WHEN v_quitada THEN coalesce(v_pagamento_concluido_em, now())
    ELSE NULL
  END;

  UPDATE public.ordemservico
  SET status = v_novo_status::public.enum_status_os,
      pagamento_concluido_em = v_novo_pagamento_concluido_em,
      updatedat = now()
  WHERE id = p_ordemservicoid
    AND (
      status::text IS DISTINCT FROM v_novo_status OR
      pagamento_concluido_em IS DISTINCT FROM v_novo_pagamento_concluido_em
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_limite_pagamento_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_total_devido numeric(14,2);
  v_ja_comprometido numeric(14,2);
  v_novo_valor_face numeric(14,2);
BEGIN
  IF NEW.ordemservicoid IS NULL
     OR upper(NEW.tipo::text) <> 'RECEITA'
     OR NEW.evento_financeiro_id IS NOT NULL
     OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  -- O lock vive até o fim da transação que efetivamente insere/edita a linha.
  PERFORM pg_advisory_xact_lock(87001, NEW.ordemservicoid);

  SELECT o.status::text,
         round(
           greatest(coalesce(o.orcamentototal, 0), 0) +
           CASE
             WHEN o.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
               greatest(coalesce(o.orcamentototal, 0), 0) *
               least(greatest(coalesce(o.acrescimo_financeiro_valor, 0), 0), 100) / 100
             WHEN o.acrescimo_financeiro_tipo = 'FIXO' THEN
               greatest(coalesce(o.acrescimo_financeiro_valor, 0), 0)
             ELSE 0
           END,
           2
         )
    INTO v_status, v_total_devido
  FROM public.ordemservico o
  WHERE o.id = NEW.ordemservicoid
    AND coalesce(o.is_deleted, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_status NOT IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO')
     AND (
       TG_OP = 'INSERT' OR
       OLD.ordemservicoid IS DISTINCT FROM NEW.ordemservicoid OR
       upper(OLD.tipo::text) IS DISTINCT FROM upper(NEW.tipo::text) OR
       OLD.evento_financeiro_id IS DISTINCT FROM NEW.evento_financeiro_id
     ) THEN
    RAISE EXCEPTION 'Pagamentos da OS só podem ser registrados após a aprovação do orçamento e antes da conclusão.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_total_devido <= 0 THEN
    RAISE EXCEPTION 'A OS não possui valor financeiro disponível para pagamento.'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(round(sum(
           greatest(coalesce(t.valor, 0) - greatest(coalesce(t.valor_acrescimos, 0), 0), 0)
         ), 2), 0)
    INTO v_ja_comprometido
  FROM public.transacao t
  WHERE t.ordemservicoid = NEW.ordemservicoid
    AND upper(t.tipo::text) = 'RECEITA'
    AND t.evento_financeiro_id IS NULL
    AND t.is_deleted = false
    AND (TG_OP = 'INSERT' OR t.id <> NEW.id);

  v_novo_valor_face := round(
    greatest(coalesce(NEW.valor, 0) - greatest(coalesce(NEW.valor_acrescimos, 0), 0), 0),
    2
  );

  IF round(v_ja_comprometido + v_novo_valor_face, 2) > v_total_devido THEN
    RAISE EXCEPTION 'A soma de pagamentos e títulos ultrapassa o total financeiro da OS. Saldo disponível: R$ %.',
      to_char(greatest(v_total_devido - v_ja_comprometido, 0), 'FM999G999G990D00')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validar_limite_pagamento_os ON public.transacao;
CREATE TRIGGER trg_validar_limite_pagamento_os
BEFORE INSERT OR UPDATE OF ordemservicoid, tipo, evento_financeiro_id, is_deleted, valor, valor_acrescimos
ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.validar_limite_pagamento_os();

CREATE OR REPLACE FUNCTION public.tg_recalcular_status_financeiro_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old_os integer;
  v_new_os integer;
BEGIN
  IF TG_OP <> 'INSERT'
     AND OLD.ordemservicoid IS NOT NULL
     AND upper(OLD.tipo::text) = 'RECEITA'
     AND OLD.evento_financeiro_id IS NULL THEN
    v_old_os := OLD.ordemservicoid;
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.ordemservicoid IS NOT NULL
     AND upper(NEW.tipo::text) = 'RECEITA'
     AND NEW.evento_financeiro_id IS NULL THEN
    v_new_os := NEW.ordemservicoid;
  END IF;

  IF v_old_os IS NOT NULL THEN
    PERFORM public.recalcular_status_financeiro_os(v_old_os);
  END IF;
  IF v_new_os IS NOT NULL AND v_new_os IS DISTINCT FROM v_old_os THEN
    PERFORM public.recalcular_status_financeiro_os(v_new_os);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalcular_status_financeiro_os ON public.transacao;
CREATE TRIGGER trg_recalcular_status_financeiro_os
AFTER INSERT OR UPDATE OF ordemservicoid, tipo, evento_financeiro_id, is_deleted,
                          pendente, valor, valor_acrescimos OR DELETE
ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_recalcular_status_financeiro_os();

-- A baixa deixa de mover uma OS ainda em execução para PAGAMENTO. O trigger
-- acima decide a conclusão usando o status operacional corrente.
CREATE OR REPLACE FUNCTION public.baixar_transacao_pendente(
  p_transacao_id bigint,
  p_pago_em timestamp with time zone,
  p_banco_id bigint,
  p_metodopagamento text,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_baixado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_metodo public.metodo_pagamento;
  v_total_devido numeric(14,2);
  v_total_pago numeric(14,2);
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_pago_em IS NULL THEN
    RAISE EXCEPTION 'Data do pagamento obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF p_banco_id IS NULL OR p_banco_id <= 0 THEN
    RAISE EXCEPTION 'Banco obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_metodopagamento), '') IS NULL THEN
    RAISE EXCEPTION 'Método de pagamento obrigatório.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_metodo := btrim(p_metodopagamento)::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Método de pagamento inválido: %.', btrim(p_metodopagamento)
      USING ERRCODE = '22023';
  END;

  UPDATE public.transacao
  SET vencimento_em = coalesce(vencimento_em, data),
      data = p_pago_em,
      pago_em = p_pago_em,
      baixado_por = p_baixado_por,
      banco_id = p_banco_id,
      metodopagamento = v_metodo,
      plano_de_conta_id = p_plano_de_conta_id,
      centro_custo_id = p_centro_custo_id,
      pendente = false,
      updated_at = now()
  WHERE id = p_transacao_id
    AND pendente = true
    AND is_deleted = false
  RETURNING * INTO v_transacao;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.transacao
      WHERE id = p_transacao_id AND is_deleted = false
    ) THEN
      RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    v_transacao.baixado_por, v_transacao.banco_id, v_transacao.metodopagamento
  );

  IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
    IF v_transacao.ordemservicoid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
    END IF;

    IF v_transacao.vendaid IS NOT NULL THEN
      SELECT round(
        greatest(coalesce(v.valortotal, 0), 0) +
        CASE
          WHEN v.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
            greatest(coalesce(v.valortotal, 0), 0) * least(greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0), 100) / 100
          WHEN v.acrescimo_financeiro_tipo = 'FIXO' THEN greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0)
          ELSE 0
        END,
        2
      ) INTO v_total_devido
      FROM public.venda v
      WHERE v.id = v_transacao.vendaid;

      SELECT coalesce(round(sum(t.valor - coalesce(t.valor_acrescimos, 0)), 2), 0)
        INTO v_total_pago
      FROM public.transacao t
      WHERE t.vendaid = v_transacao.vendaid
        AND upper(t.tipo::text) = 'RECEITA'
        AND t.pendente = false
        AND t.is_deleted = false;

      UPDATE public.venda
      SET status = (CASE WHEN v_total_pago >= v_total_devido THEN 'FINALIZADA' ELSE 'PAGAMENTO' END)::public.enum_status_venda,
          updatedat = now()
      WHERE id = v_transacao.vendaid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pago_em', v_transacao.pago_em,
    'vencimento_em', v_transacao.vencimento_em,
    'pendente', false
  );
END;
$function$;

ALTER FUNCTION public.resumo_financeiro_os(integer) OWNER TO postgres;
ALTER FUNCTION public.recalcular_status_financeiro_os(integer) OWNER TO postgres;
ALTER FUNCTION public.validar_limite_pagamento_os() OWNER TO postgres;
ALTER FUNCTION public.tg_recalcular_status_financeiro_os() OWNER TO postgres;
ALTER FUNCTION public.baixar_transacao_pendente(bigint, timestamp with time zone, bigint, text, integer, integer, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.resumo_financeiro_os(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalcular_status_financeiro_os(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resumo_financeiro_os(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalcular_status_financeiro_os(integer) TO service_role;

-- Recalcula as OS legadas considerando pagamentos e títulos pendentes.
DO $backfill$
DECLARE v_os_id integer;
BEGIN
  FOR v_os_id IN SELECT id FROM public.ordemservico WHERE coalesce(is_deleted, false) = false LOOP
    PERFORM public.recalcular_status_financeiro_os(v_os_id);
  END LOOP;
END
$backfill$;

COMMIT;
