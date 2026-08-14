-- A consulta por etiqueta precisa localizar rapidamente a venda efetiva mais
-- recente do produto, seja em uma venda finalizada ou em uma OS concluída.
CREATE INDEX IF NOT EXISTS vendaproduto_produto_venda_idx
  ON public.vendaproduto (produtoid, venda_id);

CREATE INDEX IF NOT EXISTS osproduto_produto_ordem_idx
  ON public.osproduto (produtoid, ordemservicoid);

CREATE OR REPLACE FUNCTION public.buscar_ultimo_valor_venda_produto(p_produto_id integer)
RETURNS TABLE (
  valor_unitario numeric,
  origem text,
  realizado_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT
    candidato.valor_unitario,
    candidato.origem,
    candidato.realizado_em
  FROM (
    SELECT
      round(vp.valor_total / nullif(vp.quantidade, 0), 4) AS valor_unitario,
      'VENDA'::text AS origem,
      coalesce(v.datavenda, v.updatedat, v.createdat) AS realizado_em,
      v.id AS documento_id
    FROM public.vendaproduto vp
    JOIN public.venda v ON v.id = vp.venda_id
    WHERE vp.produtoid = p_produto_id
      AND v.status = 'FINALIZADA'
      AND vp.quantidade > 0

    UNION ALL

    SELECT
      round(op.subtotal / nullif(op.quantidade, 0), 4) AS valor_unitario,
      'OS'::text AS origem,
      coalesce(
        os.pagamento_concluido_em,
        os.datasaida::timestamptz,
        os.updatedat::timestamptz,
        os.createdat::timestamptz
      ) AS realizado_em,
      os.id AS documento_id
    FROM public.osproduto op
    JOIN public.ordemservico os ON os.id = op.ordemservicoid
    WHERE op.produtoid = p_produto_id
      AND os.status = 'CONCLUIDO'
      AND os.is_deleted = false
      AND op.quantidade > 0
  ) candidato
  WHERE candidato.valor_unitario IS NOT NULL
  ORDER BY candidato.realizado_em DESC NULLS LAST, candidato.documento_id DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.buscar_ultimo_valor_venda_produto(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_ultimo_valor_venda_produto(integer) TO service_role;

COMMENT ON FUNCTION public.buscar_ultimo_valor_venda_produto(integer) IS
  'Retorna o valor unitário efetivo mais recente entre venda finalizada e OS concluída.';
