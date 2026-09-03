-- O evento de comissao passa a dizer tambem quando o desconto da OS encolheu a
-- base.
--
-- A comissao sai do valor liquido desde 20260802140000: o fator de desconto da
-- OS inteira entra na base do servico. Na tela isso aparece como uma conta que
-- nao fecha -- OS #248 do Demir, servico de R$ 1.800 a 5%, comissao de R$ 88,30
-- em vez de R$ 90,00, porque R$ 200 de desconto sobre R$ 10.580 em itens
-- reduziram a base para R$ 1.765,97.
--
-- O texto sai do mesmo lugar que as telas usam (`explicarBaseDaComissao`, em
-- src/lib/ordens/comissao-explicacao.ts), com a mesma tolerancia de
-- arredondamento, para o detalhe do evento, o painel da OS e a Central Pessoal
-- dizerem a mesma frase.
--
-- So o texto muda. Valor, percentual e base do evento continuam os mesmos.

BEGIN;

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
  v_frete numeric := 0;
  v_deducao numeric := 0;
BEGIN
  SELECT coalesce(o.orcamentototal, 0),
         round(coalesce(o.valor_frete, 0), 2),
         coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                     FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                         FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0))
                         FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_total_os, v_frete, v_bruto
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
    natureza_dre text,
    PRIMARY KEY (origem, natureza, chave_origem)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.eventos_os_desejados;

  INSERT INTO pg_temp.eventos_os_desejados
    (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
     usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
     valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
  SELECT 'PRODUTO', 'RECEITA', op.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         op.quantidade || ' unidade(s)',
         round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade, op.precounitario, null, null,
         jsonb_build_object('subtotal', op.subtotal, 'bruto', round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2)), false,
         public.natureza_dre_de_evento('PRODUTO', 'RECEITA')
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
    (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
     usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
     valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
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
         ), false,
         public.natureza_dre_de_evento('PRODUTO', 'RECEITA')
  FROM public.osproduto_avulso opa
  WHERE opa.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
    (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
     usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
     valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
  SELECT 'PRODUTO', 'DESPESA', op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         CASE
           WHEN coalesce(op.custo_unitario_aplicado, 0) > 0 THEN 'Custo registrado na OS'
           WHEN coalesce(p.ultimovalordecompra, 0) > 0 THEN 'Ultimo valor de compra do produto'
           WHEN coalesce(p.precocompra, 0) > 0 THEN 'Preco medio de compra do produto'
           ELSE 'Produto sem custo cadastrado'
         END,
         round(coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0)
               * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade,
         coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0), null, null,
         jsonb_build_object(
           'custo_nao_informado',
             coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0) = 0,
           'custo_origem', CASE
             WHEN coalesce(op.custo_unitario_aplicado, 0) > 0 THEN 'OS'
             WHEN coalesce(p.ultimovalordecompra, 0) > 0 THEN 'ULTIMA_COMPRA'
             WHEN coalesce(p.precocompra, 0) > 0 THEN 'PRECO_MEDIO'
             ELSE 'SEM_CUSTO'
           END), false,
         public.natureza_dre_de_evento('PRODUTO', 'DESPESA')
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid;

  INSERT INTO pg_temp.eventos_os_desejados
    (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
     usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
     valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
  SELECT 'SERVICO', 'RECEITA', os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)',
         round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2),
         null, os.servicoid, null, os.quantidade, os.precounitario, null, null,
         jsonb_build_object('subtotal', os.subtotal, 'bruto', round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2)), false,
         public.natureza_dre_de_evento('SERVICO', 'RECEITA')
  FROM public.osservico os
  JOIN public.servico s ON s.id = os.servicoid
  WHERE os.ordemservicoid = p_ordemservicoid;

  IF v_frete > 0 THEN
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, dados_snapshot,
       pode_gerar_transacao, natureza_dre)
    VALUES ('FRETE', 'RECEITA', 'FRETE',
            'Frete - OS #' || p_ordemservicoid, 'Receita de frete da ordem de servico',
            v_frete, jsonb_build_object('valor_frete', v_frete), false,
            public.natureza_dre_de_evento('FRETE', 'RECEITA'));
  END IF;

  v_deducao := round(greatest(v_bruto + v_frete - v_total_os, 0), 2);

  IF v_deducao > 0 THEN
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, dados_snapshot,
       pode_gerar_transacao, natureza_dre)
    VALUES ('DESCONTO', 'DESPESA', 'DESCONTO',
            'Desconto concedido - OS #' || p_ordemservicoid, 'Deducao da receita bruta',
            v_deducao, jsonb_build_object('bruto', v_bruto, 'frete', v_frete, 'total_os', v_total_os),
            false, public.natureza_dre_de_evento('DESCONTO', 'DESPESA'));
  END IF;

  IF p_incluir_comissoes THEN
    WITH comissoes AS (
      SELECT r.servicoid,
             r.usuarioid,
             coalesce(r.valor_comissao, 0) AS valor_comissao,
             r.valor_base,
             coalesce(r.comissao_percent_aplicada, 0) AS pct_proprio,
             -- Quem pagou a linha. A coluna efetiva e nula em vinculo anterior
             -- a regra do maior percentual; la a taxa individual era a que valia.
             coalesce(r.comissao_percent_efetiva, r.comissao_percent_aplicada, 0) AS pct_aplicado,
             count(*) OVER (PARTITION BY r.servicoid) AS realizadores,
             coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid) AS titulo,
             coalesce(os.subtotal, 0) AS subtotal_servico,
             coalesce(u.nome, 'Realizador') AS realizador_nome
        FROM public.osservico_realizador r
        JOIN public.osservico os ON os.ordemservicoid = r.ordemservicoid AND os.servicoid = r.servicoid
        JOIN public.servico s ON s.id = r.servicoid
        LEFT JOIN public.usuario u ON u.id = r.usuarioid
       WHERE r.ordemservicoid = p_ordemservicoid
         AND s.gera_comissao
    )
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
       usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
       valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
    SELECT 'COMISSAO', 'DESPESA', c.servicoid || ':' || c.usuarioid,
           'Comissão - ' || c.titulo,
           c.realizador_nome
             || ' · ' || public.formatar_percentual_comissao(c.pct_aplicado) || '%'
             || CASE WHEN c.realizadores > 1
                     THEN ' (maior entre ' || c.realizadores || ' realizadores) sobre 1/'
                          || c.realizadores || ' do serviço'
                     ELSE ' do serviço' END
             -- A comissao sai do liquido: o desconto da OS e rateado entre os
             -- itens antes do calculo. Sem dizer isso, R$ 88,30 de 5% sobre um
             -- servico de R$ 1.800 parece erro de conta.
             --
             -- A tolerancia e de um centavo por realizador: a base e arredondada
             -- por pessoa, entao 333,33 x 3 fica um centavo abaixo de 1.000 sem
             -- que exista desconto nenhum.
             || CASE WHEN c.subtotal_servico - coalesce(c.valor_base, 0) * c.realizadores
                          > 0.01 * c.realizadores
                     THEN ', já com o desconto da OS'
                     ELSE '' END
             || CASE WHEN c.pct_proprio <> c.pct_aplicado
                     THEN ' · taxa própria ' || public.formatar_percentual_comissao(c.pct_proprio) || '%'
                     ELSE '' END,
           c.valor_comissao,
           null, c.servicoid, c.usuarioid, null, null,
           c.pct_aplicado, c.valor_base,
           jsonb_build_object(
             'realizador_nome', c.realizador_nome,
             'percentual_aplicado', c.pct_aplicado,
             'percentual_proprio', c.pct_proprio,
             'realizadores_no_servico', c.realizadores,
             'valor_servico', c.subtotal_servico
           ),
           true,
           public.natureza_dre_de_evento('COMISSAO', 'DESPESA')
      FROM comissoes c;
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
    percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao,
    natureza_dre, status, updated_at
  )
  SELECT p_ordemservicoid, d.origem, d.natureza, d.chave_origem, d.descricao, d.detalhe, d.valor,
         d.produtoid, d.servicoid, d.usuarioid, d.quantidade_snapshot, d.valor_unitario_snapshot,
         d.percentual_snapshot, d.valor_base_snapshot, d.dados_snapshot, d.pode_gerar_transacao,
         d.natureza_dre, 'ATIVO', now()
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
    -- Vem da linha mapeada no template; o coalesce so protege o valor ja gravado
    -- caso uma origem fique sem mapeamento algum.
    natureza_dre = coalesce(excluded.natureza_dre, eventos_financeiros.natureza_dre),
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

COMMIT;
