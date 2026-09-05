CREATE OR REPLACE FUNCTION public.validar_limite_pagamento_os()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
