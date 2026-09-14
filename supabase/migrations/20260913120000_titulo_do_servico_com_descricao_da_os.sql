BEGIN;

-- O título do serviço na OS tinha duas leituras, e cada tela escolhia a sua.
--
-- `osservico.descricao` é o texto livre da linha — o que foi feito naquele
-- veículo. `servico.descricao` é o nome do cadastro. Serviços guarda-chuva
-- ("REPARO", "SERVIÇOS DIVERSOS") vivem desse texto livre: no Demir o serviço
-- 37 já gerou evento financeiro com dezenove descrições diferentes.
--
-- O painel de itens mostrava só o nome do cadastro; o evento financeiro, só o
-- texto livre. Quem conferia a OS contra o financeiro via "REPARO" de um lado e
-- "RECUPERAÇÃO DO CILINDRO DA CABINE" do outro, sem nada ligando os dois.
--
-- Agora os dois lados dizem a mesma coisa: "REPARO - RECUPERAÇÃO DO CILINDRO DA
-- CABINE". A regra mora em `titulo_servico_os`, uma função só, porque a
-- expressão antiga estava escrita cinco vezes e divergir era questão de tempo.
-- Do lado do front, `src/lib/ordens/titulo-servico.ts` repete a mesma regra.
CREATE OR REPLACE FUNCTION public.titulo_servico_os(
  p_descricao_cadastro text,
  p_descricao_item text,
  p_servicoid integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  -- O texto livre que já começa pelo nome do cadastro vale sozinho: no Demir
  -- existe linha digitada como "MAO DE OBRA + SERVIÇO, REVISAO NA BOMBA", e
  -- prefixar o cadastro de novo daria "MAO DE OBRA + SERVIÇO - MAO DE OBRA +
  -- SERVIÇO, REVISAO NA BOMBA". O prefixo cobre também o texto idêntico, que é
  -- o caso comum de quem repete o nome do serviço no campo livre.
  --
  -- A comparação ignora caixa porque o campo é digitado à mão e a oficina
  -- alterna entre maiúsculas e minúsculas no mesmo dia.
  SELECT coalesce(
    CASE
      WHEN t.cadastro IS NOT NULL AND t.item IS NOT NULL THEN
        CASE
          WHEN left(lower(t.item), length(t.cadastro)) = lower(t.cadastro) THEN t.item
          ELSE t.cadastro || ' - ' || t.item
        END
      ELSE coalesce(t.cadastro, t.item)
    END,
    'Servico #' || p_servicoid
  )
  FROM (
    SELECT nullif(btrim(p_descricao_cadastro), '') AS cadastro,
           -- A quebra de linha no texto livre viraria uma linha solta no meio da
           -- descrição do evento.
           nullif(btrim(regexp_replace(coalesce(p_descricao_item, ''), '\s+', ' ', 'g')), '') AS item
  ) t;
$function$;

COMMENT ON FUNCTION public.titulo_servico_os(text, text, integer) IS
  'Título do serviço numa OS: nome do cadastro + o texto livre da linha, quando os dois existem e diferem.';

-- ---------------------------------------------------------------------------
-- As duas funções que publicam o livro passam a usar o título completo.
-- Corpos idênticos aos de 20260904150000 e 20260811210000, exceto a expressão
-- do título.
-- ---------------------------------------------------------------------------

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
         'Servico - ' || public.titulo_servico_os(s.descricao, os.descricao, os.servicoid),
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
             public.titulo_servico_os(s.descricao, os.descricao, r.servicoid) AS titulo,
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


    -- A comissao de criacao: uma linha por item da OS, do criador. Mesma
    -- granularidade da comissao de realizacao, que sempre foi um evento por
    -- (servico, realizador).
    --
    -- `produtoid`/`servicoid` saem preenchidos, e e o que permite separar
    -- comissao de produto da de servico lendo a coluna, sem interpretar chave
    -- nem snapshot. Produto avulso nao tem produtoid: o vinculo dele mora na
    -- chave de origem e em dados_snapshot.
    INSERT INTO pg_temp.eventos_os_desejados
      (origem, natureza, chave_origem, descricao, detalhe, valor, produtoid, servicoid,
       usuarioid, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot,
       valor_base_snapshot, dados_snapshot, pode_gerar_transacao, natureza_dre)
    SELECT 'COMISSAO', 'DESPESA',
           'CRIACAO:' || c.usuarioid || ':'
             || CASE c.tipo WHEN 'SERVICO' THEN 'S' WHEN 'PRODUTO' THEN 'P' ELSE 'A' END
             || c.item_id,
           'Comissão de criação - ' || coalesce(
             CASE c.tipo
               WHEN 'SERVICO' THEN
                 public.titulo_servico_os(s.descricao, os.descricao, c.item_id)
               WHEN 'PRODUTO' THEN
                 coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || c.item_id)
               ELSE coalesce(nullif(opa.titulo, ''), 'Produto avulso #' || c.item_id)
             END, 'Item #' || c.item_id),
           coalesce(u.nome, 'Criador') || ' · '
             || public.formatar_percentual_comissao(c.pct) || '%'
             || CASE c.tipo WHEN 'SERVICO' THEN ' do serviço' ELSE ' do produto' END
             || ', por ter criado a OS'
             -- Mesma frase da comissao de realizacao, pelo mesmo motivo: a base
             -- e liquida, e sem dizer isso o valor parece erro de conta.
             || CASE WHEN coalesce(
                            CASE c.tipo
                              WHEN 'SERVICO' THEN os.subtotal
                              WHEN 'PRODUTO' THEN op.subtotal
                              ELSE opa.subtotal
                            END, 0) - c.base > 0.01
                     THEN ', já com o desconto da OS'
                     ELSE '' END,
           c.valor_comissao,
           CASE WHEN c.tipo = 'PRODUTO' THEN c.item_id ELSE NULL END,
           CASE WHEN c.tipo = 'SERVICO' THEN c.item_id ELSE NULL END,
           c.usuarioid, null, null,
           c.pct, c.base,
           jsonb_build_object(
             'comissao_de_criacao', true,
             'criador_nome', coalesce(u.nome, 'Criador'),
             'tipo_item', c.tipo,
             'item_id', c.item_id,
             'base', c.base,
             'percentual', c.pct
           ),
           -- Zero nao vira transacao: nao ha o que pagar.
           c.valor_comissao > 0,
           public.natureza_dre_de_evento('COMISSAO', 'DESPESA')
      FROM public.os_comissao_criacao c
      LEFT JOIN public.usuario u ON u.id = c.usuarioid
      LEFT JOIN public.osservico os
        ON c.tipo = 'SERVICO' AND os.ordemservicoid = c.ordemservicoid AND os.servicoid = c.item_id
      LEFT JOIN public.servico s ON c.tipo = 'SERVICO' AND s.id = c.item_id
      LEFT JOIN public.osproduto op
        ON c.tipo = 'PRODUTO' AND op.ordemservicoid = c.ordemservicoid AND op.produtoid = c.item_id
      LEFT JOIN public.produto p ON c.tipo = 'PRODUTO' AND p.id = c.item_id
      LEFT JOIN public.osproduto_avulso opa
        ON c.tipo = 'PRODUTO_AVULSO' AND opa.id = c.item_id
     WHERE c.ordemservicoid = p_ordemservicoid;
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
         'Servico - ' || public.titulo_servico_os(s.descricao, os.descricao, os.servicoid),
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
           'Comissao - ' || public.titulo_servico_os(s.descricao, os.descricao, r.servicoid),
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

-- ---------------------------------------------------------------------------
-- O que já está publicado ganha o título novo
-- ---------------------------------------------------------------------------
-- A reconciliação só reescreve a OS que ela visita, e OS encerrada não é
-- visitada mais. Sem este passo, o financeiro continuaria vendo o título antigo
-- em tudo que foi fechado antes de hoje.
--
-- CONVERTIDO e is_manual ficam de fora, pela mesma razão que a reconciliação os
-- respeita (I8): o que virou dinheiro, ou foi escrito à mão, não se reescreve
-- sozinho. Só a descrição muda — valor, chave e vínculo não são tocados.
UPDATE public.eventos_financeiros e
   SET descricao = CASE e.origem
         WHEN 'SERVICO' THEN 'Servico - ' || public.titulo_servico_os(s.descricao, os.descricao, os.servicoid)
         ELSE 'Comissão - ' || public.titulo_servico_os(s.descricao, os.descricao, os.servicoid)
       END,
       updated_at = now()
  FROM public.osservico os
  JOIN public.servico s ON s.id = os.servicoid
 WHERE os.ordemservicoid = e.ordemservicoid
   AND os.servicoid = e.servicoid
   AND e.origem IN ('SERVICO', 'COMISSAO')
   AND e.chave_origem NOT LIKE 'CRIACAO:%'
   AND e.status = 'ATIVO'
   AND NOT coalesce(e.is_manual, false)
   AND e.descricao IS DISTINCT FROM (
         CASE e.origem
           WHEN 'SERVICO' THEN 'Servico - ' || public.titulo_servico_os(s.descricao, os.descricao, os.servicoid)
           ELSE 'Comissão - ' || public.titulo_servico_os(s.descricao, os.descricao, os.servicoid)
         END);

-- A comissão de criação tem prefixo próprio e a chave é que a identifica.
UPDATE public.eventos_financeiros e
   SET descricao = 'Comissão de criação - ' || public.titulo_servico_os(s.descricao, os.descricao, os.servicoid),
       updated_at = now()
  FROM public.osservico os
  JOIN public.servico s ON s.id = os.servicoid
 WHERE os.ordemservicoid = e.ordemservicoid
   AND os.servicoid = e.servicoid
   AND e.origem = 'COMISSAO'
   AND e.chave_origem LIKE 'CRIACAO:%:S%'
   AND e.status = 'ATIVO'
   AND NOT coalesce(e.is_manual, false)
   AND e.descricao IS DISTINCT FROM
       ('Comissão de criação - ' || public.titulo_servico_os(s.descricao, os.descricao, os.servicoid));

COMMIT;
