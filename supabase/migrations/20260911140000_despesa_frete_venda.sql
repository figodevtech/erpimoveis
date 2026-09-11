BEGIN;

-- O custo da transportadora pertence à venda e mantém a competência da receita.
-- A validação e a criação acontecem juntas para não vincular uma receita cancelada.
CREATE OR REPLACE FUNCTION public.criar_despesa_frete_venda(
  p_venda_id bigint, p_receita_id bigint, p_descricao text, p_detalhe text,
  p_valor numeric, p_usuario uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_venda public.venda%ROWTYPE;
  v_receita public.eventos_financeiros%ROWTYPE;
  v_evento public.eventos_financeiros%ROWTYPE;
BEGIN
  IF p_venda_id IS NULL OR p_venda_id <= 0 OR p_receita_id IS NULL OR p_receita_id <= 0
     OR nullif(btrim(p_descricao), '') IS NULL OR p_valor IS NULL
     OR p_valor::text IN ('NaN', 'Infinity', '-Infinity') OR round(p_valor, 2) <= 0 THEN
    RAISE EXCEPTION 'Informe a receita de frete, o título e um valor positivo para a despesa.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venda FROM public.venda WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.venda_reconhece_receita(v_venda.status::text) THEN
    RAISE EXCEPTION 'Esta venda não aceita despesas de frete no status atual.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_receita FROM public.eventos_financeiros
   WHERE id = p_receita_id AND source_type = 'VENDA' AND source_id = p_venda_id
     AND ordemservicoid IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A receita não foi encontrada nesta venda.' USING ERRCODE = 'P0002';
  END IF;
  IF v_receita.origem <> 'FRETE' OR v_receita.natureza <> 'RECEITA' THEN
    RAISE EXCEPTION 'Somente receitas de frete podem receber esta despesa.' USING ERRCODE = '22023';
  END IF;
  IF v_receita.status <> 'ATIVO' THEN
    RAISE EXCEPTION 'A receita de frete não está ativa.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.eventos_financeiros
    (source_type, source_id, source_item_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, competencia_em, is_manual,
     pode_gerar_transacao, dados_snapshot, created_by)
  VALUES ('VENDA', p_venda_id, v_receita.id, 'FRETE', 'DESPESA',
    public.natureza_dre_de_evento('FRETE', 'DESPESA'), 'MANUAL:' || gen_random_uuid(),
    btrim(p_descricao), coalesce(nullif(btrim(p_detalhe), ''), 'Vinculada a ' || v_receita.descricao),
    round(p_valor, 2), v_receita.competencia_em, true, true,
    jsonb_build_object('despesa_frete_manual', true, 'receita_frete_valor', v_receita.valor,
      'dre_linha_codigo', '4.6', 'evento_receita_origem_id', v_receita.id, 'criado_em', now()), p_usuario)
  RETURNING * INTO v_evento;
  RETURN to_jsonb(v_evento);
END;
$fn$;
REVOKE ALL ON FUNCTION public.criar_despesa_frete_venda(bigint,bigint,text,text,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.criar_despesa_frete_venda(bigint,bigint,text,text,numeric,uuid) TO service_role;

-- Mantém as validações, parcelas e vínculos da função existente. Amplia apenas
-- as origens de venda aceitas e protege a despesa manual ao zerar a receita.
DO $patch$
DECLARE
  v_sql text;
  v_antigo text;
BEGIN
  SELECT pg_get_functiondef('public.registrar_lancamento_de_eventos(jsonb)'::regprocedure) INTO v_sql;
  v_antigo := $old$e.source_type IS NOT DISTINCT FROM 'VENDA' AND e.origem = 'COMISSAO'$old$;
  IF strpos(v_sql, v_antigo) = 0 THEN RAISE EXCEPTION 'Validação de origem do lançamento não encontrada.'; END IF;
  v_sql := replace(v_sql, v_antigo,
    $new$e.source_type IS NOT DISTINCT FROM 'VENDA'
              AND (e.origem = 'COMISSAO' OR (e.origem = 'FRETE' AND e.is_manual))$new$);
  v_sql := replace(v_sql, 'OS ou comissao de venda', 'OS, comissao ou despesa de frete de venda');
  EXECUTE v_sql;

  SELECT pg_get_functiondef('public.sincronizar_eventos_financeiros_venda(bigint)'::regprocedure) INTO v_sql;
  v_antigo := $old$and origem = 'FRETE' and status = 'ATIVO';$old$;
  IF strpos(v_sql, v_antigo) = 0 THEN RAISE EXCEPTION 'Sincronização da receita de frete não encontrada.'; END IF;
  EXECUTE replace(v_sql, v_antigo,
    $new$and origem = 'FRETE' and natureza = 'RECEITA' and not is_manual and status = 'ATIVO';$new$);
END;
$patch$;

CREATE OR REPLACE VIEW public.eventos_financeiros_fila WITH (security_invoker=true) AS
SELECT e.*, CASE WHEN o.id IS NOT NULL THEN 'OS' ELSE 'VENDA' END AS documento_tipo,
       coalesce(o.id,v.id) AS documento_id,coalesce(o.clienteid,v.clienteid) AS cliente_id,
       CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('id',o.id,'status',o.status,'dataentrada',o.dataentrada,
         'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) END AS ordem,
       CASE WHEN v.id IS NOT NULL THEN jsonb_build_object('id',v.id,'status',v.status,
         'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) END AS venda
 FROM public.eventos_financeiros e
 LEFT JOIN public.ordemservico o ON o.id=e.ordemservicoid
 LEFT JOIN public.venda v ON e.source_type='VENDA' AND e.source_id=v.id
   AND (e.origem='COMISSAO' OR (e.origem='FRETE' AND e.natureza='DESPESA' AND e.is_manual))
 LEFT JOIN public.cliente c ON c.id=coalesce(o.clienteid,v.clienteid)
 WHERE (o.id IS NOT NULL AND NOT o.is_deleted) OR (e.ordemservicoid IS NULL AND v.id IS NOT NULL);

COMMIT;
