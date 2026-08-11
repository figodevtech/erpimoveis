-- Eventos financeiros da OS: frete na origem, despesa convertida no resultado,
-- conversao pelo proprio sinalizador e custo de produto com reserva no medio.
--
-- 1. FRETE e DESCONTO passam a fazer parte do conjunto desejado das funcoes de
--    sincronizacao e reconciliacao. Ate aqui nenhuma das duas conhecia FRETE e
--    as duas calculavam o desconto como `bruto - total`, sem somar o frete —
--    entao toda reconciliacao tentava cancelar o evento de frete e reescrever o
--    desconto com o valor errado, e um gatilho BEFORE UPDATE
--    (`trg_preservar_eventos_frete_os`) desfazia isso linha a linha. Verificado
--    na OS #69 do banco de demonstracao: com o gatilho desativado, a
--    reconciliacao deixa FRETE e DESCONTO cancelados. Com a formula correta
--    (`bruto + frete - total`) dentro das funcoes, o gatilho perde a razao de
--    existir e sai junto.
--
-- 2. A DRE passa a somar tambem os eventos CONVERTIDO. Converter uma despesa em
--    transacao e decidir *como* ela sera paga, nao desfazer o fato economico. A
--    transacao gerada nunca produz evento proprio — `sincronizar_eventos_
--    financeiros_transacao` ignora quem tem `evento_financeiro_id` ou
--    `ordemservicoid` —, entao nao existe risco de contagem dupla. CANCELADO
--    continua fora.
--
-- 3. A conversao de evento em transacao passa a respeitar apenas
--    `pode_gerar_transacao`. A lista fixa de origens ('AVULSO', 'COMISSAO') foi
--    escrita quando todo lancamento manual nascia como AVULSO; desde que a
--    despesa manual passou a usar PRODUTO/SERVICO, a tela oferecia "Lancar no
--    financeiro" para um evento que o banco recusava.
--
-- 4. O custo do produto passa a cair no preco medio de compra quando o ultimo
--    valor de compra nao existe ou e zero. A ordem acompanha o resto do sistema
--    (saida de estoque, uso e consumo, rentabilidade): registrado na OS, depois
--    ultimo, depois medio. A correcao alcanca tambem
--    `fn_osproduto_snapshot_ultimo_custo`, que gravava zero em
--    `custo_unitario_aplicado` e, com isso, impedia qualquer recurso ao medio
--    depois — era dai que vinham os eventos de custo zerado em produtos que
--    tinham preco medio cadastrado.
--
-- Nada aqui reescreve evento existente: as funcoes so valem para o que for
-- gerado ou reconciliado daqui para frente.
-- 5. `natureza_dre` deixa de nascer nulo nos eventos de OS. A DRE nunca dependeu
--    dessa coluna — ela soma pela linha resolvida em `dre_mapeamento`, e a
--    classificacao que o relatorio exibe vem de `dre_linha` —, entao aqui nao
--    muda valor nenhum. O que muda e que quem consultar `eventos_financeiros`
--    por fora do relatorio passa a ver a classificacao no proprio lancamento.
--    O valor e derivado da linha mapeada, e nao de um CASE fixo: se alguem
--    remapear uma origem no template, o evento acompanha em vez de mentir.
BEGIN;

-- ---------------------------------------------------------------- parte 5
CREATE OR REPLACE FUNCTION public.natureza_dre_de_evento(
  p_origem text,
  p_natureza text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT dl.natureza_dre
       FROM public.dre_mapeamento mp
       JOIN public.dre_linha dl ON dl.id = mp.linha_id
      WHERE mp.ativo
        AND mp.origem_tipo = 'EVENTO_ORIGEM'
        AND mp.origem_valor = p_origem || ':' || p_natureza
      ORDER BY mp.template_id DESC, mp.id
      LIMIT 1),
    CASE WHEN p_natureza = 'RECEITA' THEN 'RECEITA' ELSE 'DESPESA' END
  );
$function$;

COMMENT ON FUNCTION public.natureza_dre_de_evento(text, text) IS
  'Classificacao de resultado (RECEITA/DEDUCAO/CUSTO/DESPESA) da origem de um evento, lida da linha mapeada no template da DRE. Mantem o evento e o template com uma fonte de verdade so.';

-- ---------------------------------------------------------------- parte 1 e 4
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

  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.eventos_financeiros
    (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao, detalhe, valor,
     produtoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  SELECT p_ordemservicoid, 'PRODUTO', 'RECEITA',
         public.natureza_dre_de_evento('PRODUTO', 'RECEITA'), op.produtoid::text,
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
    (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao, detalhe, valor,
     quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  SELECT p_ordemservicoid, 'PRODUTO', 'RECEITA',
         public.natureza_dre_de_evento('PRODUTO', 'RECEITA'), 'AVULSO:' || opa.id,
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

  -- `nullif(..., 0)` faz o zero cair para a proxima fonte: um produto que tem
  -- apenas o preco medio preenchido deixa de gerar custo zerado.
  INSERT INTO public.eventos_financeiros
    (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao, detalhe, valor,
     produtoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  SELECT p_ordemservicoid, 'PRODUTO', 'DESPESA',
         public.natureza_dre_de_evento('PRODUTO', 'DESPESA'), op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         CASE
           WHEN coalesce(op.custo_unitario_aplicado, 0) > 0 THEN 'Custo registrado na OS'
           WHEN coalesce(p.ultimovalordecompra, 0) > 0 THEN 'Ultimo valor de compra do produto'
           WHEN coalesce(p.precocompra, 0) > 0 THEN 'Preco medio de compra do produto'
           ELSE 'Produto sem custo cadastrado'
         END,
         round(coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0)
               * coalesce(op.quantidade, 0), 2),
         op.produtoid, op.quantidade,
         coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0),
         jsonb_build_object(
           'custo_nao_informado',
             coalesce(nullif(op.custo_unitario_aplicado, 0), nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0), 0) = 0,
           'custo_origem', CASE
             WHEN coalesce(op.custo_unitario_aplicado, 0) > 0 THEN 'OS'
             WHEN coalesce(p.ultimovalordecompra, 0) > 0 THEN 'ULTIMA_COMPRA'
             WHEN coalesce(p.precocompra, 0) > 0 THEN 'PRECO_MEDIO'
             ELSE 'SEM_CUSTO'
           END)
  FROM public.osproduto op
  JOIN public.produto p ON p.id = op.produtoid
  WHERE op.ordemservicoid = p_ordemservicoid
  ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;

  INSERT INTO public.eventos_financeiros
    (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao, detalhe, valor,
     servicoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  SELECT p_ordemservicoid, 'SERVICO', 'RECEITA',
         public.natureza_dre_de_evento('SERVICO', 'RECEITA'), os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)',
         round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2),
         os.servicoid, os.quantidade, os.precounitario,
         jsonb_build_object('subtotal', os.subtotal, 'bruto', round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2))
  FROM public.osservico os
  JOIN public.servico s ON s.id = os.servicoid
  WHERE os.ordemservicoid = p_ordemservicoid
  ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;

  IF v_frete > 0 THEN
    INSERT INTO public.eventos_financeiros
      (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao,
       detalhe, valor, dados_snapshot)
    VALUES
      (p_ordemservicoid, 'FRETE', 'RECEITA', public.natureza_dre_de_evento('FRETE', 'RECEITA'), 'FRETE',
       'Frete - OS #' || p_ordemservicoid, 'Receita de frete da ordem de servico',
       v_frete, jsonb_build_object('valor_frete', v_frete))
    ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;
  END IF;

  -- O total comercial ja inclui o frete; sem soma-lo de volta o desconto sai
  -- menor do que foi concedido, ou negativo.
  v_deducao := round(greatest(v_bruto + v_frete - v_total_os, 0), 2);

  IF v_deducao > 0 THEN
    INSERT INTO public.eventos_financeiros
      (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao,
       detalhe, valor, dados_snapshot)
    VALUES
      (p_ordemservicoid, 'DESCONTO', 'DESPESA', public.natureza_dre_de_evento('DESCONTO', 'DESPESA'), 'DESCONTO',
       'Desconto concedido - OS #' || p_ordemservicoid, 'Deducao da receita bruta',
       v_deducao, jsonb_build_object('bruto', v_bruto, 'frete', v_frete, 'total_os', v_total_os))
    ON CONFLICT (ordemservicoid, origem, chave_origem, natureza) DO NOTHING;
  END IF;

  IF p_incluir_comissoes THEN
    INSERT INTO public.eventos_financeiros
      (ordemservicoid, origem, natureza, natureza_dre, chave_origem, descricao, detalhe, valor,
       servicoid, usuarioid, percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao)
    SELECT p_ordemservicoid, 'COMISSAO', 'DESPESA',
           public.natureza_dre_de_evento('COMISSAO', 'DESPESA'), r.servicoid || ':' || r.usuarioid,
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
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
       usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
       valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
    SELECT 'COMISSAO', 'DESPESA', r.servicoid || ':' || r.usuarioid,
           'Comissao - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid),
           coalesce(u.nome, 'Realizador'),
           coalesce(r.valor_comissao, 0),
           null, r.servicoid, r.usuarioid, null, null, r.comissao_percent_aplicada, r.valor_base,
           jsonb_build_object('realizador_nome', u.nome), true,
           public.natureza_dre_de_evento('COMISSAO', 'DESPESA')
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

-- O gatilho existia so para desfazer o que a reconciliacao fazia de errado com
-- FRETE e DESCONTO. Agora a reconciliacao acerta na origem.
DROP TRIGGER IF EXISTS trg_preservar_eventos_frete_os ON public.eventos_financeiros;
DROP FUNCTION IF EXISTS public.tg_preservar_eventos_frete_os();

-- O snapshot de custo do item da OS e a raiz do problema: ele copiava
-- `ultimovalordecompra` mesmo quando valia zero, e um zero gravado ali se
-- comporta como custo declarado — nem a geracao do evento nem a sincronizacao
-- manual conseguiam recorrer ao preco medio depois. Agora ele segue a mesma
-- ordem e volta a deixar NULL quando o produto nao tem custo nenhum, que e o
-- significado documentado da coluna.
CREATE OR REPLACE FUNCTION public.fn_osproduto_snapshot_ultimo_custo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF new.custo_unitario_aplicado IS NULL THEN
    UPDATE public.osproduto op
       SET custo_unitario_aplicado = coalesce(nullif(p.ultimovalordecompra, 0), nullif(p.precocompra, 0))
      FROM public.produto p
     WHERE op.ordemservicoid = new.ordemservicoid
       AND op.produtoid = new.produtoid
       AND p.id = new.produtoid;
  END IF;
  RETURN new;
END;
$function$;

COMMENT ON COLUMN public.osproduto.custo_unitario_aplicado IS
  'Snapshot do custo do produto ao inseri-lo na OS: ultimo valor de compra e, na falta dele, preco medio de compra. NULL identifica item legado ou produto sem custo cadastrado.';

-- ---------------------------------------------------------------- parte 2
CREATE OR REPLACE FUNCTION public.dre_somar_por_linha(
  p_template_id integer,
  p_de timestamptz,
  p_ate timestamptz
)
RETURNS TABLE (linha_id integer, valor numeric, lancamentos bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.linha_id,
         round(sum(l.valor), 2) AS valor,
         count(*)::bigint       AS lancamentos
    FROM (
      SELECT coalesce(
               e.dre_linha_id,
               (SELECT mp.linha_id
                  FROM public.dre_mapeamento mp
                 WHERE mp.template_id = p_template_id
                   AND mp.ativo
                   AND mp.origem_tipo = 'EVENTO_ORIGEM'
                   AND mp.origem_valor = e.origem || ':' || e.natureza
                   AND (mp.vigencia_inicio IS NULL OR e.competencia_em >= mp.vigencia_inicio)
                   AND (mp.vigencia_fim IS NULL OR e.competencia_em <= mp.vigencia_fim)
                 LIMIT 1)
             ) AS linha_id,
             e.valor
        FROM public.eventos_financeiros e
       WHERE e.status IN ('ATIVO', 'CONVERTIDO')
         AND e.competencia_em IS NOT NULL
         AND e.competencia_em >= p_de
         AND e.competencia_em <= p_ate
    ) l
   WHERE l.linha_id IS NOT NULL
   GROUP BY l.linha_id;
$function$;

COMMENT ON FUNCTION public.dre_somar_por_linha(integer, timestamptz, timestamptz) IS
  'Soma os lancamentos por linha da DRE no periodo. Inclui CONVERTIDO: virar transacao define como a despesa sera paga, nao desfaz o fato economico. Usada pelo relatorio e pelo drill-down, para que os totais nunca divirjam.';

CREATE OR REPLACE FUNCTION public.dre_lancamentos_por_linha(
  p_template_id integer,
  p_linha_ids integer[],
  p_de timestamptz,
  p_ate timestamptz
)
RETURNS TABLE (
  id bigint,
  linha_id integer,
  competencia_em timestamptz,
  origem text,
  natureza text,
  natureza_dre text,
  descricao text,
  detalhe text,
  valor numeric,
  source_type text,
  source_id bigint,
  ordemservicoid integer,
  transacaoid bigint,
  is_manual boolean,
  estorno_de_id bigint,
  sem_custo boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.id, l.linha_id, l.competencia_em, l.origem, l.natureza, l.natureza_dre,
         l.descricao, l.detalhe, l.valor, l.source_type, l.source_id,
         l.ordemservicoid, l.transacaoid, l.is_manual, l.estorno_de_id,
         coalesce((l.dados_snapshot ->> 'custo_nao_informado')::boolean, false) AS sem_custo
    FROM (
      SELECT e.*,
             coalesce(
               e.dre_linha_id,
               (SELECT mp.linha_id
                  FROM public.dre_mapeamento mp
                 WHERE mp.template_id = p_template_id
                   AND mp.ativo
                   AND mp.origem_tipo = 'EVENTO_ORIGEM'
                   AND mp.origem_valor = e.origem || ':' || e.natureza
                   AND (mp.vigencia_inicio IS NULL OR e.competencia_em >= mp.vigencia_inicio)
                   AND (mp.vigencia_fim IS NULL OR e.competencia_em <= mp.vigencia_fim)
                 LIMIT 1)
             ) AS linha_id
        FROM public.eventos_financeiros e
       WHERE e.status IN ('ATIVO', 'CONVERTIDO')
         AND e.competencia_em IS NOT NULL
         AND e.competencia_em >= p_de
         AND e.competencia_em <= p_ate
    ) l
   WHERE l.linha_id = ANY (p_linha_ids)
   ORDER BY l.competencia_em DESC, l.id DESC;
$function$;

DROP INDEX IF EXISTS public.eventos_financeiros_natureza_dre_idx;
CREATE INDEX IF NOT EXISTS eventos_financeiros_natureza_dre_idx
  ON public.eventos_financeiros (natureza_dre, competencia_em)
  WHERE status IN ('ATIVO', 'CONVERTIDO');

-- ---------------------------------------------------------------- parte 3
CREATE OR REPLACE FUNCTION public.tg_vincular_transacao_evento_financeiro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_evento public.eventos_financeiros%rowtype;
BEGIN
  IF new.evento_financeiro_id IS NULL THEN RETURN new; END IF;
  SELECT * INTO v_evento FROM public.eventos_financeiros WHERE id = new.evento_financeiro_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento financeiro nao encontrado.'; END IF;
  IF v_evento.status <> 'ATIVO' OR v_evento.transacaoid IS NOT NULL THEN
    RAISE EXCEPTION 'Este evento ja foi convertido ou cancelado.';
  END IF;
  -- `pode_gerar_transacao` e o sinalizador: comissao e lancamento manual o tem,
  -- evento automatico de item nao. A origem nao decide mais nada aqui.
  IF NOT v_evento.pode_gerar_transacao THEN
    RAISE EXCEPTION 'Este evento nao pode gerar uma transacao.';
  END IF;
  IF v_evento.ordemservicoid <> new.ordemservicoid OR v_evento.natureza <> new.tipo::text THEN
    RAISE EXCEPTION 'A transacao nao corresponde a OS ou a natureza do evento financeiro.';
  END IF;
  IF round(v_evento.valor, 2) <> round(new.valor, 2) THEN
    RAISE EXCEPTION 'O valor da transacao deve ser igual ao valor do evento financeiro.';
  END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.converter_evento_financeiro_em_transacao(
  p_eventoid bigint,
  p_usuarioid uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_evento public.eventos_financeiros%rowtype;
  v_transacaoid bigint;
BEGIN
  SELECT * INTO v_evento FROM public.eventos_financeiros WHERE id = p_eventoid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento financeiro nao encontrado.'; END IF;
  IF NOT v_evento.pode_gerar_transacao THEN
    RAISE EXCEPTION 'Este evento nao pode gerar uma transacao.';
  END IF;
  IF v_evento.status <> 'ATIVO' OR v_evento.transacaoid IS NOT NULL THEN
    RAISE EXCEPTION 'Este evento ja foi convertido ou cancelado.';
  END IF;

  INSERT INTO public.transacao
    (descricao, valor, "valorLiquido", data, tipo, ordemservicoid, pendente,
     categoria, nomepagador, cpfcnpjpagador, created_by, evento_financeiro_id)
  VALUES
    (v_evento.descricao, v_evento.valor, v_evento.valor, now(),
     v_evento.natureza::public.tipos_transacao, v_evento.ordemservicoid, true,
     'NAO RELACIONADO', 'Evento financeiro OS #' || v_evento.ordemservicoid, '',
     p_usuarioid, v_evento.id)
  RETURNING id INTO v_transacaoid;

  UPDATE public.eventos_financeiros
     SET status = 'CONVERTIDO', transacaoid = v_transacaoid, updated_at = now()
   WHERE id = v_evento.id;
  RETURN v_transacaoid;
END;
$function$;

-- Os eventos que ja existem so recebem a classificacao que faltava. Nenhum
-- valor, competencia ou status e tocado, e `updated_at` fica como esta: isto
-- nao e uma edicao do lancamento, e o preenchimento de uma coluna que nunca foi
-- escrita no caminho da OS.
UPDATE public.eventos_financeiros e
   SET natureza_dre = public.natureza_dre_de_evento(e.origem, e.natureza)
 WHERE e.natureza_dre IS NULL;

COMMIT;
