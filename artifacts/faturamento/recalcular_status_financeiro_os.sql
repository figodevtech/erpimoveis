CREATE OR REPLACE FUNCTION public.recalcular_status_financeiro_os(p_ordemservicoid integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
