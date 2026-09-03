-- Servico que nao gera comissao passa a ter evento de comissao de R$ 0,00 em
-- vez de nao ter evento nenhum.
--
-- POR QUE. A ausencia do lancamento nao se explica: quem abre o financeiro da OS
-- ou a relacao de ordens no modo "eventos" ve o servico na receita e nao ve
-- despesa de comissao nenhuma, sem saber se foi porque ninguem executou, porque
-- o realizador nao tem taxa, ou porque o servico nao comissiona. Com a linha
-- zerada e o motivo escrito, o historico responde sozinho.
--
-- Antes a reconciliacao filtrava `AND s.gera_comissao` e o servico sem comissao
-- simplesmente ficava de fora do conjunto desejado -- o que, no passo final,
-- ainda cancelava o evento que existisse de quando o servico comissionava.
--
-- O QUE MUDA NO EVENTO ZERADO
--   valor e percentual vao a zero, com `greatest` de seguranca para o vinculo
--   que nunca foi recalculado depois de a flag mudar;
--   `pode_gerar_transacao` vira false -- nao ha o que pagar;
--   `detalhe` diz "serviço não gera comissão";
--   `dados_snapshot` ganha `gera_comissao`, para a tela nao ter que adivinhar.
--
-- A DRE nao muda: despesa de R$ 0,00 nao soma em linha nenhuma.
--
-- BACKFILL. Zera `valor_comissao` do vinculo em servico que hoje nao comissiona
-- -- sobra de quando a flag ainda estava ligada, e que os relatorios de comissao
-- ainda somam. Nao reconcilia OS nenhuma: reconciliar em massa foi o que
-- cancelou comissao alheia em 20260817110000, e aqui nao ha pressa -- a linha
-- zerada aparece na proxima reconciliacao de cada OS.

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
             coalesce(u.nome, 'Realizador') AS realizador_nome,
             coalesce(s.gera_comissao, true) AS comissiona
        FROM public.osservico_realizador r
        JOIN public.osservico os ON os.ordemservicoid = r.ordemservicoid AND os.servicoid = r.servicoid
        JOIN public.servico s ON s.id = r.servicoid
        LEFT JOIN public.usuario u ON u.id = r.usuarioid
       WHERE r.ordemservicoid = p_ordemservicoid
    )
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
       usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
       valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
    SELECT 'COMISSAO', 'DESPESA', c.servicoid || ':' || c.usuarioid,
           'Comissão - ' || c.titulo,
           CASE WHEN NOT c.comissiona THEN
             c.realizador_nome || ' · serviço não gera comissão'
             || CASE WHEN c.realizadores > 1
                     THEN ' · executado por ' || c.realizadores || ' realizadores'
                     ELSE '' END
           ELSE
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
                     ELSE '' END
           END,
           -- Servico sem comissao ja tem valor_comissao zerado pelo recalculo; o
           -- greatest e cinto de seguranca para vinculo que nunca foi recalculado
           -- depois de a flag mudar, para nao publicar despesa que nao existe.
           CASE WHEN c.comissiona THEN c.valor_comissao ELSE 0 END,
           null, c.servicoid, c.usuarioid, null, null,
           CASE WHEN c.comissiona THEN c.pct_aplicado ELSE 0 END, c.valor_base,
           jsonb_build_object(
             'realizador_nome', c.realizador_nome,
             'percentual_aplicado', CASE WHEN c.comissiona THEN c.pct_aplicado ELSE 0 END,
             'percentual_proprio', c.pct_proprio,
             'realizadores_no_servico', c.realizadores,
             'valor_servico', c.subtotal_servico,
             'gera_comissao', c.comissiona
           ),
           -- Zero nao vira transacao: nao ha o que pagar.
           c.comissiona,
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

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
--
-- Duas coisas, e nenhuma delas passa pela reconciliacao.
--
-- POR QUE NAO RECONCILIAR. Medido no Demir antes de escrever isto: reconciliar
-- as ~100 OS que tem servico sem comissao mexeria em RECEITA (+R$ 1.300),
-- DESCONTO (+R$ 1.300) e COMISSAO (+R$ 107) -- porque a reconciliacao reconstroi
-- o conjunto inteiro de eventos da OS, nao so a parte de comissao. Seria
-- reescrever mes fechado para publicar uma linha de R$ 0,00, que e o mesmo erro
-- de 20260817110000 na direcao contraria.
--
-- Entao aqui se toca exatamente o que precisa ser tocado.

-- 1) O valor que sobrou no vinculo de servico que deixou de comissionar.
DO $backfill_vinculos$
DECLARE
  v_item record;
  v_linhas integer := 0;
BEGIN
  FOR v_item IN
    SELECT DISTINCT r.ordemservicoid, r.servicoid
      FROM public.osservico_realizador r
      JOIN public.servico s ON s.id = r.servicoid
     WHERE s.gera_comissao = false
       AND coalesce(r.valor_comissao, 0) <> 0
     ORDER BY r.ordemservicoid, r.servicoid
  LOOP
    PERFORM public.recalcular_comissao_osservico(v_item.ordemservicoid, v_item.servicoid);
    v_linhas := v_linhas + 1;
  END LOOP;

  RAISE NOTICE 'Comissao zerada em % servico(s) que nao comissionam.', v_linhas;
END
$backfill_vinculos$;

-- 2) A linha de R$ 0,00 no financeiro, para o historico responder sozinho.
--
-- Insercao direta com a mesma forma que a reconciliacao produz. Evento ja
-- CONVERTIDO fica de fora: virou transacao, e desfazer isso e decisao de quem
-- opera o financeiro, nao de uma migration.
WITH zeradas AS (
  SELECT r.ordemservicoid,
         r.servicoid,
         r.usuarioid,
         r.valor_base,
         count(*) OVER (PARTITION BY r.ordemservicoid, r.servicoid) AS realizadores,
         coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid) AS titulo,
         coalesce(os.subtotal, 0) AS subtotal_servico,
         coalesce(u.nome, 'Realizador') AS realizador_nome
    FROM public.osservico_realizador r
    JOIN public.osservico os ON os.ordemservicoid = r.ordemservicoid AND os.servicoid = r.servicoid
    JOIN public.servico s ON s.id = r.servicoid AND s.gera_comissao = false
    JOIN public.ordemservico o ON o.id = r.ordemservicoid
    LEFT JOIN public.usuario u ON u.id = r.usuarioid
   WHERE coalesce(o.is_deleted, false) = false
     AND o.status::text <> 'CANCELADO'
)
INSERT INTO public.eventos_financeiros (
  ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
  servicoid, usuarioid, percentual_snapshot, valor_base_snapshot, dados_snapshot,
  pode_gerar_transacao, natureza_dre, status, updated_at
)
SELECT z.ordemservicoid, 'COMISSAO', 'DESPESA', z.servicoid || ':' || z.usuarioid,
       'Comissão - ' || z.titulo,
       z.realizador_nome || ' · serviço não gera comissão'
         || CASE WHEN z.realizadores > 1
                 THEN ' · executado por ' || z.realizadores || ' realizadores'
                 ELSE '' END,
       0,
       z.servicoid, z.usuarioid, 0, z.valor_base,
       jsonb_build_object(
         'realizador_nome', z.realizador_nome,
         'percentual_aplicado', 0,
         'percentual_proprio', 0,
         'realizadores_no_servico', z.realizadores,
         'valor_servico', z.subtotal_servico,
         'gera_comissao', false
       ),
       false,
       public.natureza_dre_de_evento('COMISSAO', 'DESPESA'),
       'ATIVO', now()
  FROM zeradas z
ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO UPDATE SET
  descricao = excluded.descricao,
  detalhe = excluded.detalhe,
  valor = 0,
  percentual_snapshot = 0,
  valor_base_snapshot = excluded.valor_base_snapshot,
  dados_snapshot = excluded.dados_snapshot,
  pode_gerar_transacao = false,
  status = 'ATIVO',
  updated_at = now()
WHERE eventos_financeiros.status <> 'CONVERTIDO'
  AND NOT coalesce(eventos_financeiros.is_manual, false);

COMMIT;
