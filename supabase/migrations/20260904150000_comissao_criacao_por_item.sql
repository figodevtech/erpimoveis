-- A comissao de criacao passa a sair um evento por item da OS.
--
-- Ate aqui era um evento so por ordem, somando servicos e produtos: a OS #321
-- publicava R$ 55,50 num unico lancamento que cobria dois servicos e um
-- produto. Quem lia a aba de eventos nao via de onde o valor veio, e o
-- financeiro nao tinha como pagar so uma parte.
--
-- Agora cada item gera o seu:
--   CRIACAO:<uuid>:S<servicoid>   comissao sobre aquele servico
--   CRIACAO:<uuid>:P<produtoid>   comissao sobre aquele produto de catalogo
--   CRIACAO:<uuid>:A<avulsoid>    comissao sobre aquele produto avulso
--
-- E a mesma granularidade da comissao de realizacao, que sempre foi um evento
-- por (servico, realizador).
--
-- O QUE ISSO DESTRAVA
-- O evento passa a carregar `produtoid`/`servicoid` preenchidos. Antes os dois
-- eram nulos e a separacao entre comissao de produto e de servico precisava ser
-- extraida de `dados_snapshot` e carregada por colunas extras ate o relatorio
-- impresso. Agora a coluna responde sozinha, e aquele caminho pode sair.
--
-- `usuarioid` ja vinha preenchido e continua: e por ele que se filtra a comissao
-- de uma pessoa sem depender de interpretar a chave de origem.
--
-- CUIDADO QUE ESTA MIGRATION PRECISA TER
-- 1. A tabela e recriada, nao alterada: a granularidade e a propria chave
--    primaria. Ela nasceu em 20260904130000 e so tem as linhas de quem ja foi
--    apurado — nada de historico se perde que nao possa ser reapurado.
-- 2. Os eventos da chave antiga (`CRIACAO:<uuid>`, sem sufixo de item) sao
--    cancelados aqui. Deixa-los ativos duplicaria a comissao: a reconciliacao
--    passaria a publicar os novos sem remover os velhos, porque a chave mudou.
--    Cancelar e nao apagar preserva o rastro de quem ja tiver conferido.
-- 3. Evento ja CONVERTIDO nao e tocado. Comissao que virou transacao e dinheiro
--    comprometido, e desfazer isso e decisao do financeiro, nao de uma migration.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O snapshot, agora por item
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.os_comissao_criacao;

CREATE TABLE public.os_comissao_criacao (
  ordemservicoid integer NOT NULL
    REFERENCES public.ordemservico(id) ON DELETE CASCADE,
  -- Qual natureza de item pagou esta linha. PRODUTO_AVULSO existe separado
  -- porque ele nao tem produtoid: a referencia e a linha da OS.
  tipo text NOT NULL CHECK (tipo IN ('SERVICO', 'PRODUTO', 'PRODUTO_AVULSO')),
  -- servicoid, produtoid ou osproduto_avulso.id, conforme o tipo.
  item_id integer NOT NULL,
  usuarioid uuid NOT NULL REFERENCES public.usuario(id),
  base numeric(12,2) NOT NULL DEFAULT 0,
  pct numeric(5,2) NOT NULL DEFAULT 0,
  valor_comissao numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ordemservicoid, tipo, item_id)
);

ALTER TABLE public.os_comissao_criacao OWNER TO postgres;

COMMENT ON TABLE public.os_comissao_criacao IS
  'Comissao paga a quem criou a OS, uma linha por item dela. Analogo de osservico_realizador para a comissao de criacao: e o snapshot que paga, e o evento financeiro COMISSAO e copia dele. Sem linhas para a OS significa criador sem percentual cadastrado.';

COMMENT ON COLUMN public.os_comissao_criacao.usuarioid IS
  'O criador, carimbado. Nao e lido de ordemservico.usuariocriadorid na hora de pagar: a troca de titularidade da OS nao deve transferir comissao ja apurada.';

COMMENT ON COLUMN public.os_comissao_criacao.base IS
  'Subtotal do item ja multiplicado pelo fator de desconto da OS. Mesma base liquida da comissao de realizacao.';

CREATE INDEX IF NOT EXISTS idx_os_comissao_criacao_usuario
  ON public.os_comissao_criacao (usuarioid);

ALTER TABLE public.os_comissao_criacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_comissao_criacao NO FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2) Carimbo pelo cadastro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recarimbar_comissao_criacao_os(
  p_ordemservicoid integer
)
RETURNS void
LANGUAGE sql
AS $function$
  UPDATE public.os_comissao_criacao c
     SET pct = CASE c.tipo
                 WHEN 'SERVICO' THEN coalesce(u.comissao_criacao_servico_percent, 0)
                 ELSE coalesce(u.comissao_criacao_produto_percent, 0)
               END,
         updated_at = now()
    FROM public.usuario u
   WHERE c.ordemservicoid = p_ordemservicoid
     AND u.id = c.usuarioid;
$function$;

COMMENT ON FUNCTION public.recarimbar_comissao_criacao_os(integer) IS
  'Traz os percentuais de comissao de criacao do cadastro do usuario para as linhas da OS, cada uma pelo percentual do seu tipo.';

-- ---------------------------------------------------------------------------
-- 3) O recalculo, item a item
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalcular_comissao_criacao_os(
  p_ordemservicoid integer,
  p_forcar boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_criador uuid;
  v_pct_servicos numeric := 0;
  v_pct_produtos numeric := 0;
  v_somente boolean := false;
  v_execucao_encerrada boolean := false;
  v_total_os_sem_frete numeric := 0;
  v_total_itens numeric := 0;
  v_fator numeric := 1;
  v_existe boolean;
BEGIN
  SELECT o.usuariocriadorid, o.execucao_fim_em IS NOT NULL
    INTO v_criador, v_execucao_encerrada
    FROM public.ordemservico o
   WHERE o.id = p_ordemservicoid;

  IF v_criador IS NULL THEN
    DELETE FROM public.os_comissao_criacao WHERE ordemservicoid = p_ordemservicoid;
    RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.os_comissao_criacao WHERE ordemservicoid = p_ordemservicoid)
    INTO v_existe;

  -- Execucao encerrada e nunca apurada: fica assim, a menos que alguem tenha
  -- pedido nomeando a OS. Ver 20260904140000.
  IF NOT v_existe AND v_execucao_encerrada AND NOT p_forcar THEN
    RETURN;
  END IF;

  IF p_forcar THEN
    v_execucao_encerrada := false;
  END IF;

  -- Execucao encerrada: os percentuais viraram historico e saem das proprias
  -- linhas. Ainda em execucao: releem o cadastro.
  IF v_existe AND v_execucao_encerrada THEN
    SELECT max(CASE WHEN c.tipo = 'SERVICO' THEN c.pct END),
           max(CASE WHEN c.tipo <> 'SERVICO' THEN c.pct END)
      INTO v_pct_servicos, v_pct_produtos
      FROM public.os_comissao_criacao c
     WHERE c.ordemservicoid = p_ordemservicoid;
    -- A flag nao viaja nas linhas: o que ela decidiu ja esta expresso em quais
    -- servicos existem como linha. Reler o cadastro aqui reabriria a base.
    SELECT coalesce(u.comissao_criacao_somente_comissionaveis, false) INTO v_somente
      FROM public.usuario u WHERE u.id = v_criador;
  ELSE
    SELECT coalesce(u.comissao_criacao_servico_percent, 0),
           coalesce(u.comissao_criacao_produto_percent, 0),
           coalesce(u.comissao_criacao_somente_comissionaveis, false)
      INTO v_pct_servicos, v_pct_produtos, v_somente
      FROM public.usuario u
     WHERE u.id = v_criador;
  END IF;

  v_pct_servicos := coalesce(v_pct_servicos, 0);
  v_pct_produtos := coalesce(v_pct_produtos, 0);

  IF v_pct_servicos = 0 AND v_pct_produtos = 0 THEN
    DELETE FROM public.os_comissao_criacao WHERE ordemservicoid = p_ordemservicoid;
    RETURN;
  END IF;

  -- Expressao identica a de `recalcular_comissao_osservico`. Mudar uma sem a
  -- outra faz as duas comissoes da mesma OS discordarem sobre o desconto.
  SELECT greatest(coalesce(o.orcamentototal, 0) - coalesce(o.valor_frete, 0), 0),
         coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.subtotal, 0)) FROM public.osservico os WHERE os.ordemservicoid = o.id), 0)
    INTO v_total_os_sem_frete, v_total_itens
    FROM public.ordemservico o WHERE o.id = p_ordemservicoid;

  IF v_total_itens > 0 THEN v_fator := v_total_os_sem_frete / v_total_itens; END IF;

  -- Uma linha por item. O DELETE do que sobrou remove item retirado da OS.
  WITH desejadas AS (
    SELECT 'SERVICO'::text AS tipo, os.servicoid AS item_id,
           round(coalesce(os.subtotal, 0) * v_fator, 2) AS base, v_pct_servicos AS pct
      FROM public.osservico os
      JOIN public.servico s ON s.id = os.servicoid
     WHERE os.ordemservicoid = p_ordemservicoid
       AND v_pct_servicos > 0
       AND (NOT v_somente OR coalesce(s.gera_comissao, true))
    UNION ALL
    SELECT 'PRODUTO', op.produtoid,
           round(coalesce(op.subtotal, 0) * v_fator, 2), v_pct_produtos
      FROM public.osproduto op
     WHERE op.ordemservicoid = p_ordemservicoid AND v_pct_produtos > 0
    UNION ALL
    SELECT 'PRODUTO_AVULSO', opa.id,
           round(coalesce(opa.subtotal, 0) * v_fator, 2), v_pct_produtos
      FROM public.osproduto_avulso opa
     WHERE opa.ordemservicoid = p_ordemservicoid AND v_pct_produtos > 0
  ),
  gravadas AS (
    INSERT INTO public.os_comissao_criacao AS c
      (ordemservicoid, tipo, item_id, usuarioid, base, pct, valor_comissao, updated_at)
    SELECT p_ordemservicoid, d.tipo, d.item_id, v_criador, d.base, d.pct,
           round(d.base * d.pct / 100.0, 2), now()
      FROM desejadas d
    ON CONFLICT (ordemservicoid, tipo, item_id) DO UPDATE SET
      -- `usuarioid` de proposito NAO entra: o criador e carimbado na primeira
      -- apuracao e nao acompanha troca de titularidade.
      base = excluded.base,
      pct = excluded.pct,
      valor_comissao = excluded.valor_comissao,
      updated_at = now()
    RETURNING c.tipo, c.item_id
  )
  DELETE FROM public.os_comissao_criacao c
   WHERE c.ordemservicoid = p_ordemservicoid
     AND NOT EXISTS (
       SELECT 1 FROM gravadas g WHERE g.tipo = c.tipo AND g.item_id = c.item_id
     );
END;
$function$;

COMMENT ON FUNCTION public.recalcular_comissao_criacao_os(integer, boolean) IS
  'Recalcula a comissao de criacao da OS, uma linha por item, sobre a base liquida. Criador sem percentual: apaga as linhas. Execucao encerrada: usa os percentuais congelados, e nao apura o que nunca foi apurado — salvo com p_forcar.';

-- ---------------------------------------------------------------------------
-- 4) O evento financeiro, um por item
-- ---------------------------------------------------------------------------
-- Identica a versao de 20260904130000, com o bloco da comissao de criacao
-- reescrito para sair por item.
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
                 coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Serviço #' || c.item_id)
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

-- ---------------------------------------------------------------------------
-- 5) A chave antiga sai de cena
-- ---------------------------------------------------------------------------
-- Sem isto, a OS ja apurada ficaria com o evento velho (soma de tudo) ativo ao
-- lado dos novos, dobrando a comissao. A reconciliacao nao o alcanca sozinha:
-- ela so cancela chaves que conhece, e esta deixou de ser desejada.
--
-- CONVERTIDO fica de fora: comissao que virou transacao e dinheiro
-- comprometido, e desfazer isso e decisao do financeiro.
UPDATE public.eventos_financeiros
   SET status = 'CANCELADO', updated_at = now()
 WHERE origem = 'COMISSAO'
   AND chave_origem LIKE 'CRIACAO:%'
   AND chave_origem NOT LIKE 'CRIACAO:%:%'
   AND status = 'ATIVO';

COMMIT;
