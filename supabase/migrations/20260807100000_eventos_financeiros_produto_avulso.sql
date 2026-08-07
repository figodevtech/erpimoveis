-- Inclui produtos avulsos na receita projetada da OS.
--
-- Enquanto o item ainda nao foi vinculado, nao existe um custo confiavel. Por
-- isso, ele gera apenas RECEITA. O vinculo com o cadastro de produtos executa
-- a reconciliacao na mesma transacao: cancela o snapshot avulso e cria os
-- eventos definitivos de receita e custo do produto selecionado.
BEGIN;

CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_os(
  p_ordemservicoid integer,
  p_incluir_comissoes boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_os numeric := 0;
  v_bruto numeric := 0;
  v_deducao numeric := 0;
BEGIN
  SELECT coalesce(o.orcamentototal, 0),
         coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                     FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                         FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0))
                         FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_total_os, v_bruto
  FROM public.ordemservico o
  WHERE o.id = p_ordemservicoid;

  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     produtoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  SELECT p_ordemservicoid, 'PRODUTO', 'RECEITA', op.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         op.quantidade || ' unidade(s)',
         round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, op.quantidade, op.precounitario,
         jsonb_build_object('subtotal', op.subtotal, 'bruto', round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2))
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid
  ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;

  INSERT INTO public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  SELECT p_ordemservicoid, 'PRODUTO', 'RECEITA', 'AVULSO:' || opa.id,
         'Venda - ' || coalesce(nullif(opa.titulo, ''), 'Produto avulso #' || opa.id),
         opa.quantidade || ' unidade(s) (produto avulso)',
         round(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0), 2),
         opa.quantidade, opa.precounitario,
         jsonb_build_object(
           'produto_avulso', true,
           'produto_avulso_id', opa.id,
           'subtotal', opa.subtotal,
           'bruto', round(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0), 2)
         )
  FROM public.osproduto_avulso opa
  WHERE opa.ordemservicoid = p_ordemservicoid
  ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;

  INSERT INTO public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     produtoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  SELECT p_ordemservicoid, 'PRODUTO', 'DESPESA', op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         CASE WHEN op.custo_unitario_aplicado IS NULL THEN 'Ultimo valor de compra no momento da aprovacao' ELSE 'Custo registrado na OS' END,
         round(coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, op.quantidade, coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0),
         jsonb_build_object('custo_nao_informado',
           coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) = 0)
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid
  ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;

  INSERT INTO public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     servicoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  SELECT p_ordemservicoid, 'SERVICO', 'RECEITA', os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)',
         round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2),
         os.servicoid, os.quantidade, os.precounitario,
         jsonb_build_object('subtotal', os.subtotal, 'bruto', round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2))
  FROM public.osservico os
  JOIN public.servico s ON s.id = os.servicoid
  WHERE os.ordemservicoid = p_ordemservicoid
  ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;

  v_deducao := round(greatest(v_bruto - v_total_os, 0), 2);

  IF v_deducao > 0 THEN
    INSERT INTO public.eventos_financeiros
      (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor, dados_snapshot)
    VALUES
      (p_ordemservicoid, 'DESCONTO', 'DESPESA', 'DESCONTO',
       'Desconto concedido - OS #' || p_ordemservicoid, 'Deducao da receita bruta',
       v_deducao, jsonb_build_object('bruto', v_bruto, 'total_os', v_total_os))
    ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;
  END IF;

  IF p_incluir_comissoes THEN
    INSERT INTO public.eventos_financeiros
      (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
       servicoid, usuarioid, percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao)
    SELECT p_ordemservicoid, 'COMISSAO', 'DESPESA', r.servicoid || ':' || r.usuarioid,
           'Comissao - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid),
           coalesce(u.nome, 'Realizador'), coalesce(r.valor_comissao, 0),
           r.servicoid, r.usuarioid, r.comissao_percent_aplicada, r.valor_base,
           jsonb_build_object('realizador_nome', u.nome), true
    FROM public.osservico_realizador r
    JOIN public.osservico os ON os.ordemservicoid = r.ordemservicoid AND os.servicoid = r.servicoid
    JOIN public.servico s ON s.id = r.servicoid
    LEFT JOIN public.usuario u ON u.id = r.usuarioid
    WHERE r.ordemservicoid = p_ordemservicoid
      AND s.gera_comissao
    ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconciliar_eventos_financeiros_os(
  p_ordemservicoid integer,
  p_incluir_comissoes boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_os numeric := 0;
  v_bruto numeric := 0;
  v_deducao numeric := 0;
BEGIN
  SELECT coalesce(o.orcamentototal, 0),
         coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                     FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                         FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0))
                         FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_total_os, v_bruto
  FROM public.ordemservico o
  WHERE o.id = p_ordemservicoid;

  IF NOT FOUND THEN RAISE EXCEPTION 'OS nao encontrada.'; END IF;

  CREATE TEMPORARY TABLE IF NOT EXISTS pg_temp.eventos_os_desejados (
    origem text NOT NULL,
    natureza text NOT NULL,
    chave_origem text NOT NULL,
    descricao text NOT NULL,
    detalhe text,
    valor numeric(14,2) NOT NULL,
    produtoid integer,
    servicoid integer,
    usuarioid uuid,
    quantidade_snapshot numeric(14,4),
    valor_unitario_snapshot numeric(14,4),
    percentual_snapshot numeric(8,4),
    valor_base_snapshot numeric(14,2),
    dados_snapshot jsonb NOT NULL,
    pode_gerar_transacao boolean NOT NULL,
    PRIMARY KEY (origem, natureza, chave_origem)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.eventos_os_desejados;

  INSERT INTO pg_temp.eventos_os_desejados
  SELECT 'PRODUTO', 'RECEITA', op.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         op.quantidade || ' unidade(s)',
         round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade, op.precounitario, null, null,
         jsonb_build_object('subtotal', op.subtotal, 'bruto', round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2)), false
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
  SELECT 'PRODUTO', 'RECEITA', 'AVULSO:' || opa.id,
         'Venda - ' || coalesce(nullif(opa.titulo, ''), 'Produto avulso #' || opa.id),
         opa.quantidade || ' unidade(s) (produto avulso)',
         round(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0), 2),
         null, null, null, opa.quantidade, opa.precounitario, null, null,
         jsonb_build_object(
           'produto_avulso', true,
           'produto_avulso_id', opa.id,
           'subtotal', opa.subtotal,
           'bruto', round(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0), 2)
         ), false
  FROM public.osproduto_avulso opa
  WHERE opa.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
  SELECT 'PRODUTO', 'DESPESA', op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         CASE WHEN op.custo_unitario_aplicado IS NULL THEN 'Ultimo valor de compra no momento da reconciliacao' ELSE 'Custo registrado na OS' END,
         round(coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade,
         coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0), null, null,
         jsonb_build_object('custo_nao_informado',
           coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) = 0), false
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
  SELECT 'SERVICO', 'RECEITA', os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)',
         round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2),
         null, os.servicoid, null, os.quantidade, os.precounitario, null, null,
         jsonb_build_object('subtotal', os.subtotal, 'bruto', round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2)), false
  FROM public.osservico os
  JOIN public.servico s ON s.id = os.servicoid
  WHERE os.ordemservicoid = p_ordemservicoid;

  v_deducao := round(greatest(v_bruto - v_total_os, 0), 2);

  IF v_deducao > 0 THEN
    INSERT INTO pg_temp.eventos_os_desejados
    VALUES ('DESCONTO', 'DESPESA', 'DESCONTO',
            'Desconto concedido - OS #' || p_ordemservicoid, 'Deducao da receita bruta',
            v_deducao, null, null, null, null, null, null, null,
            jsonb_build_object('bruto', v_bruto, 'total_os', v_total_os), false);
  END IF;

  IF p_incluir_comissoes THEN
    INSERT INTO pg_temp.eventos_os_desejados
    SELECT 'COMISSAO', 'DESPESA', r.servicoid || ':' || r.usuarioid,
           'Comissao - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid),
           coalesce(u.nome, 'Realizador'),
           coalesce(r.valor_comissao, 0),
           null, r.servicoid, r.usuarioid, null, null, r.comissao_percent_aplicada, r.valor_base,
           jsonb_build_object('realizador_nome', u.nome), true
    FROM public.osservico_realizador r
    JOIN public.osservico os ON os.ordemservicoid = r.ordemservicoid AND os.servicoid = r.servicoid
    JOIN public.servico s ON s.id = r.servicoid
    LEFT JOIN public.usuario u ON u.id = r.usuarioid
    WHERE r.ordemservicoid = p_ordemservicoid
      AND s.gera_comissao;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.eventos_financeiros e
    LEFT JOIN pg_temp.eventos_os_desejados d
      ON d.origem = e.origem AND d.natureza = e.natureza AND d.chave_origem = e.chave_origem
    WHERE e.ordemservicoid = p_ordemservicoid
      AND e.origem <> 'AVULSO'
      AND NOT coalesce(e.is_manual, false)
      AND e.status = 'CONVERTIDO'
      AND (d.chave_origem IS NULL OR e.valor <> d.valor)
  ) THEN
    RAISE EXCEPTION 'Existem eventos convertidos divergentes. Exclua as transacoes vinculadas antes de alterar o orcamento.';
  END IF;

  INSERT INTO public.eventos_financeiros (
    ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
    produtoid, servicoid, usuarioid, quantidade_snapshot, valor_unitario_snapshot,
    percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao, status, updated_at
  )
  SELECT p_ordemservicoid, d.origem, d.natureza, d.chave_origem, d.descricao, d.detalhe, d.valor,
         d.produtoid, d.servicoid, d.usuarioid, d.quantidade_snapshot, d.valor_unitario_snapshot,
         d.percentual_snapshot, d.valor_base_snapshot, d.dados_snapshot, d.pode_gerar_transacao, 'ATIVO', now()
  FROM pg_temp.eventos_os_desejados d
  ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO UPDATE SET
    descricao = excluded.descricao,
    detalhe = excluded.detalhe,
    valor = excluded.valor,
    produtoid = excluded.produtoid,
    servicoid = excluded.servicoid,
    usuarioid = excluded.usuarioid,
    quantidade_snapshot = excluded.quantidade_snapshot,
    valor_unitario_snapshot = excluded.valor_unitario_snapshot,
    percentual_snapshot = excluded.percentual_snapshot,
    valor_base_snapshot = excluded.valor_base_snapshot,
    dados_snapshot = excluded.dados_snapshot,
    pode_gerar_transacao = excluded.pode_gerar_transacao,
    status = 'ATIVO',
    updated_at = now()
  WHERE eventos_financeiros.status <> 'CONVERTIDO'
    AND NOT coalesce(eventos_financeiros.is_manual, false);

  UPDATE public.eventos_financeiros e
     SET status = 'CANCELADO', updated_at = now()
   WHERE e.ordemservicoid = p_ordemservicoid
     AND e.origem <> 'AVULSO'
     AND NOT coalesce(e.is_manual, false)
     AND e.status <> 'CONVERTIDO'
     AND NOT EXISTS (
       SELECT 1
       FROM pg_temp.eventos_os_desejados d
       WHERE d.origem = e.origem
         AND d.natureza = e.natureza
         AND d.chave_origem = e.chave_origem
     );
END;
$function$;

-- Mantem o estoque e os eventos financeiros consistentes em uma unica
-- transacao ao substituir o avulso por um produto do cadastro.
CREATE OR REPLACE FUNCTION public.vincular_produto_avulso_os(
  p_ordem_id integer,
  p_avulso_id bigint,
  p_produto_id integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
BEGIN
  PERFORM public.estoque_definir_contexto('ORDEM_SERVICO', p_ordem_id::bigint, 'OS #' || p_ordem_id);
  PERFORM public.vincular_produto_avulso_os_interna(p_ordem_id, p_avulso_id, p_produto_id);

  SELECT status::text
    INTO v_status
  FROM public.ordemservico
  WHERE id = p_ordem_id;

  IF v_status IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO') THEN
    PERFORM public.reconciliar_eventos_financeiros_os(
      p_ordem_id,
      v_status IN ('EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO')
    );
  END IF;
END;
$function$;

-- Corrige OS ja aprovadas que tenham produto avulso pendente no momento do
-- deploy. SEM_COBRANCA fica de fora porque sua regra cancela receitas.
DO $backfill$
DECLARE
  v_os record;
BEGIN
  FOR v_os IN
    SELECT DISTINCT o.id, o.status::text AS status
    FROM public.ordemservico o
    JOIN public.osproduto_avulso opa ON opa.ordemservicoid = o.id
    WHERE o.status::text IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO')
  LOOP
    PERFORM public.reconciliar_eventos_financeiros_os(
      v_os.id,
      v_os.status IN ('EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO')
    );
  END LOOP;
END;
$backfill$;

COMMIT;
