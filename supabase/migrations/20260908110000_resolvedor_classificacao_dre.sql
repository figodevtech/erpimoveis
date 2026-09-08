-- Fase 2 do plano de contas dinamico: resolucao canonica da classificacao.
--
-- O QUE ESTA MIGRATION FAZ
-- Cria uma unica funcao de resolucao, usada por gravacao, soma, detalhamento e
-- previa. Liga as origens automaticas de evento ao catalogo. Cria o congelamento
-- do legado e a soma que combina legado e modelo novo por vigencia.
--
-- O QUE ELA NAO MUDA
-- Enquanto `dre_implantacao.estado` for LEGADO, `dre_somar_por_linha` devolve
-- exatamente os mesmos numeros de antes, pelo mesmo caminho de antes. O
-- resolvedor fica disponivel para simulacao e previa, sem participar do total.
--
-- POR QUE UMA FUNCAO DE BANCO, E NAO REGRA NA APLICACAO
-- Hoje a soma, o drill-down e o badge de transacao repetem a mesma resolucao em
-- lugares diferentes. Duas copias de uma regra divergem; quando divergem, o
-- detalhamento deixa de fechar com o total e nao ha como saber qual dos dois
-- esta certo. A aplicacao pode antecipar mensagem, nunca recalcular destino.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Origem automatica de evento ganha significado do catalogo
-- ---------------------------------------------------------------------------
-- As 11 origens automaticas ja tinham destino. Passam a ter tambem uma chave do
-- catalogo, com a MESMA linha de hoje: isso da a elas um significado comparavel
-- entre bancos sem mudar um centavo de lugar.

ALTER TABLE public.dre_mapeamento
  DROP CONSTRAINT IF EXISTS dre_mapeamento_classificacao_coerencia_check;
ALTER TABLE public.dre_mapeamento
  ADD CONSTRAINT dre_mapeamento_classificacao_coerencia_check CHECK (
    (origem_tipo = 'CLASSIFICACAO_RESULTADO'
      AND classificacao_resultado_id IS NOT NULL
      AND origem_id IS NULL AND origem_valor IS NULL)
 OR (origem_tipo = 'EVENTO_ORIGEM' AND origem_valor IS NOT NULL)
 OR (origem_tipo IN ('PLANO_CONTA', 'PLANO_GRUPO', 'CATEGORIA_TRANSACAO')
      AND classificacao_resultado_id IS NULL));

WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1),
origens(origem_valor, codigo) AS (VALUES
  ('PRODUTO:RECEITA',        'RECEITA_PRODUTOS'),
  ('SERVICO:RECEITA',        'RECEITA_SERVICOS'),
  ('FRETE:RECEITA',          'RECEITA_FRETE'),
  ('DESCONTO:DESPESA',       'DESCONTO_INCONDICIONAL'),
  ('PRODUTO:DESPESA',        'CUSTO_MERCADORIA'),
  ('SERVICO:DESPESA',        'CUSTO_SERVICO'),
  ('CONSUMO:DESPESA',        'CUSTO_MATERIAL_DIRETO'),
  ('COMISSAO:DESPESA',       'CUSTO_MAO_OBRA_DIRETA'),
  ('FRETE:DESPESA',          'CUSTO_TERCEIRO_DIRETO'),
  ('ENTRADA_FISCAL:DESPESA', 'TRIBUTO_COMPRA_RESULTADO'),
  ('ENTRADA_FISCAL:RECEITA', 'RECUPERACAO_COMPRA')
)
UPDATE public.dre_mapeamento m
   SET classificacao_resultado_id = c.id,
       updated_at = now()
  FROM origens o
  JOIN public.classificacoes_resultado c ON c.codigo = o.codigo
  CROSS JOIN t
 WHERE m.template_id = t.id
   AND m.origem_tipo = 'EVENTO_ORIGEM'
   AND m.origem_valor = o.origem_valor
   AND m.classificacao_resultado_id IS DISTINCT FROM c.id;

-- Se a chave escolhida levasse a uma linha diferente da que a origem ja usa, a
-- ativacao moveria valores sem ninguem pedir. Abortar e melhor que descobrir
-- depois, na conferencia do cliente.
DO $conferir_origens$
DECLARE
  v_divergentes text;
BEGIN
  SELECT string_agg(m.origem_valor || ' (' || lo.codigo || ' vs ' || lc.codigo || ')', ', ')
    INTO v_divergentes
    FROM public.dre_mapeamento m
    JOIN public.dre_linha lo ON lo.id = m.linha_id
    JOIN public.dre_mapeamento mc
      ON mc.template_id = m.template_id
     AND mc.origem_tipo = 'CLASSIFICACAO_RESULTADO'
     AND mc.classificacao_resultado_id = m.classificacao_resultado_id
     AND mc.ativo
    JOIN public.dre_linha lc ON lc.id = mc.linha_id
   WHERE m.origem_tipo = 'EVENTO_ORIGEM'
     AND m.ativo
     AND m.classificacao_resultado_id IS NOT NULL
     AND lo.id <> lc.id;

  IF v_divergentes IS NOT NULL THEN
    RAISE EXCEPTION
      'Origem de evento e classificacao apontam para linhas diferentes: %.', v_divergentes;
  END IF;
END
$conferir_origens$;

-- ---------------------------------------------------------------------------
-- 2) De onde veio a classificacao de um evento
-- ---------------------------------------------------------------------------

ALTER TABLE public.eventos_financeiros_classificacao
  ADD COLUMN IF NOT EXISTS origem_resolucao text NOT NULL DEFAULT 'RESOLVEDOR';

ALTER TABLE public.eventos_financeiros_classificacao
  DROP CONSTRAINT IF EXISTS eventos_financeiros_classificacao_origem_check;
ALTER TABLE public.eventos_financeiros_classificacao
  ADD CONSTRAINT eventos_financeiros_classificacao_origem_check
  CHECK (origem_resolucao IN (
    'LEGADO', 'ORIGEM_EVENTO', 'CONTA', 'GRUPO', 'MANUAL', 'RECLASSIFICACAO', 'RESOLVEDOR'));

COMMENT ON COLUMN public.eventos_financeiros_classificacao.origem_resolucao IS
  'Qual regra decidiu: LEGADO (congelado antes da ativacao), ORIGEM_EVENTO, CONTA, GRUPO, MANUAL ou RECLASSIFICACAO. A fila de pendencias e a auditoria dependem disso.';

-- ---------------------------------------------------------------------------
-- 3) Classificacao efetiva de um cadastro numa competencia
-- ---------------------------------------------------------------------------
-- Precedencia: regra da conta, regra do grupo, excecao gravada na conta, padrao
-- gravado no grupo. As regras vem primeiro porque tem vigencia; os campos do
-- cadastro sao a configuracao corrente e valem quando ainda nao ha historico.

CREATE OR REPLACE FUNCTION public.dre_classificacao_do_cadastro(
  p_conta_id integer,
  p_grupo_id integer,
  p_competencia date
)
RETURNS TABLE (classificacao_id integer, origem text, regra_id integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH grupo AS (
    SELECT coalesce(p_grupo_id, (SELECT c.grupo_id FROM public.planosdeconta c WHERE c.id = p_conta_id)) AS id
  ),
  candidatos AS (
    SELECT 1 AS ordem, r.classificacao_id, 'CONTA'::text AS origem, r.id AS regra_id
      FROM public.plano_contas_classificacao_regra r
     WHERE p_conta_id IS NOT NULL
       AND r.conta_id = p_conta_id
       AND p_competencia >= r.vigencia_inicio
       AND (r.vigencia_fim IS NULL OR p_competencia < r.vigencia_fim)
    UNION ALL
    SELECT 2, r.classificacao_id, 'GRUPO', r.id
      FROM public.plano_contas_classificacao_regra r, grupo g
     WHERE g.id IS NOT NULL
       AND r.grupo_id = g.id
       AND p_competencia >= r.vigencia_inicio
       AND (r.vigencia_fim IS NULL OR p_competencia < r.vigencia_fim)
    UNION ALL
    SELECT 3, c.classificacao_especifica_id, 'CONTA', NULL
      FROM public.planosdeconta c
     WHERE c.id = p_conta_id AND c.classificacao_especifica_id IS NOT NULL
    UNION ALL
    SELECT 4, gr.classificacao_padrao_id, 'GRUPO', NULL
      FROM public.planosdecontagrupos gr, grupo g
     WHERE gr.id = g.id AND gr.classificacao_padrao_id IS NOT NULL
  )
  -- Qualificado: numa funcao SQL, um nome que serve a coluna e a parametro de
  -- saida ao mesmo tempo e ambiguo e o Postgres recusa.
  SELECT c.classificacao_id, c.origem, c.regra_id
    FROM candidatos c
   ORDER BY c.ordem
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.dre_classificacao_do_cadastro(integer, integer, date) IS
  'Classificacao efetiva de conta/grupo numa competencia: regra da conta, regra do grupo, excecao da conta, padrao do grupo. Vigencia com inicio inclusivo e fim exclusivo.';

-- ---------------------------------------------------------------------------
-- 4) Destino de uma classificacao
-- ---------------------------------------------------------------------------
-- Mais de um mapeamento ativo e erro de integridade, nao escolha. O indice
-- unico parcial ja impede; a funcao contesta de novo porque quem le o resultado
-- precisa saber que "sem destino" e diferente de "peguei o primeiro".

CREATE OR REPLACE FUNCTION public.dre_destino_da_classificacao(
  p_template_id integer,
  p_classificacao_id integer
)
RETURNS TABLE (linha_id integer, exclui boolean, motivo text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.dre_mapeamento m
   WHERE m.template_id = p_template_id
     AND m.origem_tipo = 'CLASSIFICACAO_RESULTADO'
     AND m.classificacao_resultado_id = p_classificacao_id
     AND m.ativo;

  IF v_total > 1 THEN
    RAISE EXCEPTION
      'Classificacao % tem % destinos ativos no template %.',
      p_classificacao_id, v_total, p_template_id
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY
  SELECT m.linha_id, m.exclui_do_resultado,
         CASE WHEN m.exclui_do_resultado THEN m.observacao ELSE NULL END
    FROM public.dre_mapeamento m
   WHERE m.template_id = p_template_id
     AND m.origem_tipo = 'CLASSIFICACAO_RESULTADO'
     AND m.classificacao_resultado_id = p_classificacao_id
     AND m.ativo;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5) Resolucao de um evento
-- ---------------------------------------------------------------------------
-- Ordem, conforme a secao 7 do plano:
--   1. origem automatica do evento (a receita da OS ja tem significado proprio);
--   2. regra da conta valida na competencia;
--   3. regra herdada do grupo;
--   4. sem destino -> PENDENTE com motivo.
--
-- A revisao ja gravada e preservada FORA daqui, por quem grava: esta funcao
-- responde "o que a regra diz hoje", e e isso que a previa e a fila precisam.
--
-- Natureza incompativel nao vira linha. Um evento de DESPESA numa conta de
-- receita fica PENDENTE, com o motivo dizendo o que esta errado. Foi assim que
-- R$ 766,66 de despesa apareceram somando receita de servicos.

CREATE OR REPLACE FUNCTION public.dre_resolver_evento(
  p_evento_id bigint,
  p_template_id integer
)
RETURNS TABLE (
  resultado         text,
  classificacao_id  integer,
  linha_id          integer,
  motivo            text,
  origem_resolucao  text,
  regra_id          integer,
  conta_id          integer,
  grupo_id          integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_evento       record;
  v_conta        integer;
  v_grupo        integer;
  v_competencia  date;
  v_class        integer;
  v_origem       text;
  v_regra        integer;
  v_naturezas    text[];
  v_tratamento   text;
  v_codigo       text;
  v_linha        integer;
  v_exclui       boolean;
  v_motivo       text;
BEGIN
  SELECT e.id, e.origem, e.natureza, e.competencia_em, e.source_type, e.source_id
    INTO v_evento
    FROM public.eventos_financeiros e
   WHERE e.id = p_evento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento financeiro % nao encontrado.', p_evento_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_evento.competencia_em IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, NULL::integer,
      'Evento sem competencia: nao ha periodo para resolver.'::text,
      'RESOLVEDOR'::text, NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;

  v_competencia := v_evento.competencia_em::date;

  -- Passo 1: origem automatica. Receber uma parcela nao cria receita nova; o
  -- significado ja veio do documento quando o evento nasceu.
  SELECT m.classificacao_resultado_id INTO v_class
    FROM public.dre_mapeamento m
   WHERE m.template_id = p_template_id
     AND m.ativo
     AND m.origem_tipo = 'EVENTO_ORIGEM'
     AND m.origem_valor = v_evento.origem || ':' || v_evento.natureza
     AND (m.vigencia_inicio IS NULL OR v_evento.competencia_em >= m.vigencia_inicio)
     AND (m.vigencia_fim IS NULL OR v_evento.competencia_em <= m.vigencia_fim)
   LIMIT 1;

  IF v_class IS NOT NULL THEN
    v_origem := 'ORIGEM_EVENTO';
  ELSE
    -- Passos 2 e 3: cadastro da transacao que originou o evento.
    IF v_evento.source_type = 'TRANSACAO' THEN
      SELECT t.plano_de_conta_id INTO v_conta
        FROM public.transacao t WHERE t.id = v_evento.source_id;
    END IF;

    IF v_conta IS NOT NULL THEN
      SELECT c.grupo_id INTO v_grupo FROM public.planosdeconta c WHERE c.id = v_conta;
    END IF;

    IF v_conta IS NULL AND v_grupo IS NULL THEN
      RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, NULL::integer,
        'Lancamento sem conta do plano: nao ha regra a aplicar.'::text,
        'RESOLVEDOR'::text, NULL::integer, NULL::integer, NULL::integer;
      RETURN;
    END IF;

    SELECT r.classificacao_id, r.origem, r.regra_id
      INTO v_class, v_origem, v_regra
      FROM public.dre_classificacao_do_cadastro(v_conta, v_grupo, v_competencia) r;
  END IF;

  IF v_class IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, NULL::integer,
      'Conta e grupo sem classificacao vigente nesta competencia.'::text,
      'RESOLVEDOR'::text, NULL::integer, v_conta, v_grupo;
    RETURN;
  END IF;

  SELECT c.naturezas, c.tratamento, c.codigo
    INTO v_naturezas, v_tratamento, v_codigo
    FROM public.classificacoes_resultado c
   WHERE c.id = v_class AND c.ativo;

  IF v_naturezas IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::integer, NULL::integer,
      'Classificacao inativa ou inexistente para este cadastro.'::text,
      coalesce(v_origem, 'RESOLVEDOR'), v_regra, v_conta, v_grupo;
    RETURN;
  END IF;

  IF NOT (v_evento.natureza = ANY (v_naturezas)) THEN
    RETURN QUERY SELECT 'PENDENTE'::text, v_class, NULL::integer,
      format('Natureza %s incompativel com a classificacao %s.', v_evento.natureza, v_codigo),
      coalesce(v_origem, 'RESOLVEDOR'), v_regra, v_conta, v_grupo;
    RETURN;
  END IF;

  SELECT d.linha_id, d.exclui, d.motivo
    INTO v_linha, v_exclui, v_motivo
    FROM public.dre_destino_da_classificacao(p_template_id, v_class) d;

  IF v_exclui IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, v_class, NULL::integer,
      format('Classificacao %s sem destino no template %s.', v_codigo, p_template_id),
      coalesce(v_origem, 'RESOLVEDOR'), v_regra, v_conta, v_grupo;
    RETURN;
  END IF;

  IF v_exclui THEN
    RETURN QUERY SELECT 'EXCLUIDO'::text, v_class, NULL::integer,
      coalesce(v_motivo, 'Nao compoe resultado.'),
      coalesce(v_origem, 'RESOLVEDOR'), v_regra, v_conta, v_grupo;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'CLASSIFICADO'::text, v_class, v_linha, NULL::text,
    coalesce(v_origem, 'RESOLVEDOR'), v_regra, v_conta, v_grupo;
END;
$function$;

COMMENT ON FUNCTION public.dre_resolver_evento(bigint, integer) IS
  'Resolucao canonica de um evento: origem automatica, regra da conta, regra do grupo, senao PENDENTE com motivo. Natureza incompativel nunca vira linha. Usada por gravacao, soma, detalhamento e previa.';

-- ---------------------------------------------------------------------------
-- 6) Gravacao da revisao vigente
-- ---------------------------------------------------------------------------
-- A revisao vigente e a fonte; `eventos_financeiros.dre_linha_id` e projecao. As
-- duas mudam na mesma operacao, para que nunca exista uma classificacao editavel
-- em paralelo com outra.

CREATE OR REPLACE FUNCTION public.dre_gravar_classificacao_evento(
  p_evento_id bigint,
  p_template_id integer,
  p_usuario uuid DEFAULT NULL,
  p_origem_forcada text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resolucao record;
  v_anterior  bigint;
  v_versao    integer;
  v_novo      bigint;
BEGIN
  -- Um evento por vez, na mesma ordem em todo lugar: evita que duas gravacoes
  -- simultaneas troquem a revisao vigente uma por cima da outra.
  PERFORM 1 FROM public.eventos_financeiros WHERE id = p_evento_id FOR UPDATE;

  SELECT * INTO v_resolucao
    FROM public.dre_resolver_evento(p_evento_id, p_template_id);

  SELECT max(versao_catalogo) INTO v_versao FROM public.classificacoes_resultado;

  SELECT id INTO v_anterior
    FROM public.eventos_financeiros_classificacao
   WHERE evento_id = p_evento_id AND vigente;

  UPDATE public.eventos_financeiros_classificacao
     SET vigente = false
   WHERE evento_id = p_evento_id AND vigente;

  INSERT INTO public.eventos_financeiros_classificacao
    (evento_id, classificacao_id, regra_id, conta_id, grupo_id, template_id, linha_id,
     resultado, motivo, versao_catalogo, classificado_por, origem_resolucao,
     reclassificacao_de_id)
  VALUES
    (p_evento_id, v_resolucao.classificacao_id, v_resolucao.regra_id,
     v_resolucao.conta_id, v_resolucao.grupo_id, p_template_id, v_resolucao.linha_id,
     v_resolucao.resultado, v_resolucao.motivo, coalesce(v_versao, 1), p_usuario,
     coalesce(p_origem_forcada, v_resolucao.origem_resolucao), v_anterior)
  RETURNING id INTO v_novo;

  UPDATE public.eventos_financeiros
     SET dre_linha_id = v_resolucao.linha_id,
         updated_at = now()
   WHERE id = p_evento_id
     AND dre_linha_id IS DISTINCT FROM v_resolucao.linha_id;

  RETURN v_novo;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7) Congelamento do legado
-- ---------------------------------------------------------------------------
-- Antes de ativar, a resolucao que a DRE usa HOJE precisa virar dado. Sem isso,
-- ativar reclassificaria o passado inteiro pela regra nova, e nenhum relatorio
-- ja publicado poderia ser reproduzido.
--
-- Nao altera valor, competencia nem `dre_linha_id`: apenas grava o que ja
-- valia. Trabalha em lote e pula o que ja foi congelado, para poder ser
-- retomado depois de uma interrupcao.

CREATE OR REPLACE FUNCTION public.dre_congelar_classificacao_legado(
  p_template_id integer,
  p_lote integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_congelados integer := 0;
  v_versao integer;
BEGIN
  IF p_lote IS NULL OR p_lote < 1 OR p_lote > 5000 THEN
    RAISE EXCEPTION 'Tamanho de lote invalido: %.', p_lote USING ERRCODE = '22023';
  END IF;

  SELECT max(versao_catalogo) INTO v_versao FROM public.classificacoes_resultado;

  WITH alvo AS (
    SELECT e.id AS evento_id,
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
       AND NOT EXISTS (
         SELECT 1 FROM public.eventos_financeiros_classificacao ec
          WHERE ec.evento_id = e.id AND ec.vigente)
     ORDER BY e.id
     LIMIT p_lote
  )
  INSERT INTO public.eventos_financeiros_classificacao
    (evento_id, template_id, linha_id, resultado, motivo, versao_catalogo, origem_resolucao)
  SELECT a.evento_id, p_template_id, a.linha_id,
         CASE WHEN a.linha_id IS NULL THEN 'PENDENTE' ELSE 'CLASSIFICADO' END,
         CASE WHEN a.linha_id IS NULL
              THEN 'Congelado do legado sem destino: o lancamento ja nao entrava em nenhum total.'
         END,
         coalesce(v_versao, 1), 'LEGADO'
    FROM alvo a;

  GET DIAGNOSTICS v_congelados = ROW_COUNT;
  RETURN v_congelados;
END;
$function$;

COMMENT ON FUNCTION public.dre_congelar_classificacao_legado(integer, integer) IS
  'Congela em dado a resolucao que a DRE ja usa, em lotes retomaveis. Nao altera valor, competencia nem dre_linha_id. Evento sem destino e congelado como PENDENTE, preservando sua situacao original.';

-- Uma classificacao congelada como LEGADO nao pode ser exigida a ter
-- `classificacao_id`: o legado resolvia por linha, sem catalogo. A restricao
-- criada na Fase 1 exigia classificacao em CLASSIFICADO; passa a exigir apenas
-- para o que o resolvedor novo produzir.
ALTER TABLE public.eventos_financeiros_classificacao
  DROP CONSTRAINT IF EXISTS eventos_financeiros_classificacao_coerencia_check;
ALTER TABLE public.eventos_financeiros_classificacao
  ADD CONSTRAINT eventos_financeiros_classificacao_coerencia_check CHECK (
    (resultado = 'CLASSIFICADO' AND linha_id IS NOT NULL
      AND (classificacao_id IS NOT NULL OR origem_resolucao = 'LEGADO'))
 OR (resultado = 'EXCLUIDO'     AND linha_id IS NULL AND classificacao_id IS NOT NULL)
 OR (resultado = 'PENDENTE'     AND linha_id IS NULL AND motivo IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 8) Resolucao de linha compartilhada por soma, detalhamento e badge
-- ---------------------------------------------------------------------------
-- Hoje as tres funcoes repetem a mesma expressao de resolucao, copiada. Duas
-- copias de uma regra acabam divergindo, e quando isso acontece o drill-down
-- deixa de fechar com o total sem que ninguem consiga dizer qual dos dois esta
-- certo. Passam a chamar esta funcao.
--
-- Em LEGADO o caminho e exatamente o anterior: `dre_linha_id` gravado no evento
-- e, na falta dele, o mapeamento da origem automatica.
--
-- Em ATIVO, um evento com competencia a partir da vigencia usa a revisao
-- vigente; os anteriores continuam pelo legado congelado. Cada evento cai em
-- exatamente um dos dois ramos, entao um periodo que cruze a data soma os dois
-- sem perder nem contar duas vezes.
--
-- O estado vem por parametro de proposito: quem varre milhares de eventos le a
-- configuracao uma vez, em vez de uma vez por linha.

CREATE OR REPLACE FUNCTION public.dre_linha_do_evento(
  p_evento_id   bigint,
  p_template_id integer,
  p_estado      text,
  p_vigencia    date
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN p_estado = 'ATIVO'
                AND p_vigencia IS NOT NULL
                AND e.competencia_em >= p_vigencia
           THEN (SELECT ec.linha_id
                   FROM public.eventos_financeiros_classificacao ec
                  WHERE ec.evento_id = e.id AND ec.vigente)
           ELSE coalesce(
             e.dre_linha_id,
             (SELECT mp.linha_id
                FROM public.dre_mapeamento mp
               WHERE mp.template_id = p_template_id
                 AND mp.ativo
                 AND mp.origem_tipo = 'EVENTO_ORIGEM'
                 AND mp.origem_valor = e.origem || ':' || e.natureza
                 AND (mp.vigencia_inicio IS NULL OR e.competencia_em >= mp.vigencia_inicio)
                 AND (mp.vigencia_fim IS NULL OR e.competencia_em <= mp.vigencia_fim)
               LIMIT 1))
         END
    FROM public.eventos_financeiros e
   WHERE e.id = p_evento_id;
$function$;

COMMENT ON FUNCTION public.dre_linha_do_evento(bigint, integer, text, date) IS
  'Linha da DRE de um evento, unica para soma, detalhamento e badge. Em LEGADO usa dre_linha_id e o mapeamento da origem; em ATIVO usa a revisao vigente a partir da data de vigencia.';

-- Falta de configuracao nao vira legado em silencio: sem registro de
-- implantacao a leitura aborta, e a tela mostra erro em vez de um total
-- plausivel construido sobre uma suposicao.
CREATE OR REPLACE FUNCTION public.dre_modo_apuracao()
RETURNS TABLE (estado text, vigencia_inicio date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT i.estado, i.vigencia_inicio FROM public.dre_implantacao i LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Implantacao da DRE nao configurada neste banco: nao e possivel decidir o modo de apuracao.'
      USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dre_somar_por_linha(
  p_template_id integer,
  p_de timestamptz,
  p_ate timestamptz
)
RETURNS TABLE (linha_id integer, valor numeric, lancamentos bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_modo record;
BEGIN
  SELECT * INTO v_modo FROM public.dre_modo_apuracao();

  RETURN QUERY
  SELECT l.linha_id,
         round(sum(l.valor), 2) AS valor,
         count(*)::bigint       AS lancamentos
    FROM (
      SELECT public.dre_linha_do_evento(
               e.id, p_template_id, v_modo.estado, v_modo.vigencia_inicio) AS linha_id,
             e.valor
        FROM public.eventos_financeiros e
       WHERE e.status IN ('ATIVO', 'CONVERTIDO')
         AND e.competencia_em IS NOT NULL
         AND e.competencia_em >= p_de
         AND e.competencia_em <= p_ate
    ) l
   WHERE l.linha_id IS NOT NULL
   GROUP BY l.linha_id;
END;
$function$;

COMMENT ON FUNCTION public.dre_somar_por_linha(integer, timestamptz, timestamptz) IS
  'Soma os lancamentos por linha no periodo. Inclui CONVERTIDO: virar transacao define como a despesa sera paga, nao desfaz o fato economico. Resolve a linha por dre_linha_do_evento, a mesma do drill-down e do badge.';

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_modo record;
BEGIN
  SELECT * INTO v_modo FROM public.dre_modo_apuracao();

  RETURN QUERY
  SELECT l.id, l.linha_id, l.competencia_em, l.origem, l.natureza, l.natureza_dre,
         l.descricao, l.detalhe, l.valor, l.source_type, l.source_id,
         l.ordemservicoid, l.transacaoid, l.is_manual, l.estorno_de_id,
         coalesce((l.dados_snapshot ->> 'custo_nao_informado')::boolean, false) AS sem_custo
    FROM (
      SELECT e.*,
             public.dre_linha_do_evento(
               e.id, p_template_id, v_modo.estado, v_modo.vigencia_inicio) AS linha_id
        FROM public.eventos_financeiros e
       WHERE e.status IN ('ATIVO', 'CONVERTIDO')
         AND e.competencia_em IS NOT NULL
         AND e.competencia_em >= p_de
         AND e.competencia_em <= p_ate
    ) l
   WHERE l.linha_id = ANY (p_linha_ids)
   ORDER BY l.competencia_em DESC, l.id DESC;
END;
$function$;

COMMENT ON FUNCTION public.dre_lancamentos_por_linha(integer, integer[], timestamptz, timestamptz) IS
  'Lancamentos de uma linha no periodo. Resolve a linha por dre_linha_do_evento, a mesma da soma: o detalhamento nao pode divergir do total.';

DROP FUNCTION IF EXISTS public.dre_linha_da_transacao(bigint);

CREATE FUNCTION public.dre_linha_da_transacao(p_transacaoid bigint)
RETURNS TABLE (
  papel          text,
  documento_tipo text,
  documento_id   bigint,
  linha_id       integer,
  codigo         text,
  nome           text,
  natureza_dre   text,
  valor          numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_modo record;
  v_template integer;
BEGIN
  SELECT * INTO v_modo FROM public.dre_modo_apuracao();
  SELECT t.id INTO v_template
    FROM public.dre_template t WHERE t.ativo ORDER BY t.versao DESC, t.id DESC LIMIT 1;

  RETURN QUERY
  WITH tx AS (
    SELECT * FROM public.transacao WHERE id = p_transacaoid
  ),
  -- Documentos que esta transacao LIQUIDA. Pagamento multiplo cobre varios (o
  -- rateio diz quais); pagamento comum cobre um; avulso nao cobre nenhum.
  --
  -- `evento_financeiro_id IS NULL` e o que separa liquidar de materializar.
  -- Uma despesa da OS — servico terceirizado, comissao — vira transacao com
  -- `ordemservicoid` preenchido, mas ela nao paga a OS: ela E aquela despesa, e
  -- aponta para o evento que virou. Sem este filtro, abrir os R$ 200 de um
  -- terceirizado mostraria tambem a receita inteira da OS, como se aquele
  -- pagamento a tivesse quitado. O papel dela e DIRETO, so.
  documentos AS (
    SELECT 'OS'::text AS tipo, t.ordemservicoid::bigint AS id
      FROM tx t WHERE t.ordemservicoid IS NOT NULL AND t.evento_financeiro_id IS NULL
    UNION
    SELECT 'VENDA'::text, t.vendaid::bigint
      FROM tx t WHERE t.vendaid IS NOT NULL AND t.evento_financeiro_id IS NULL
    UNION
    SELECT r.tipo_documento::text, r.documento_id::bigint
      FROM public.pagamento_multiplo_rateio r
     WHERE r.transacao_id = p_transacaoid
  ),
  eventos AS (
    SELECT 'DIRETO'::text AS papel, NULL::text AS doc_tipo, NULL::bigint AS doc_id,
           e.id AS evento_id, e.valor
      FROM public.eventos_financeiros e
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND ((e.source_type = 'TRANSACAO' AND e.source_id = p_transacaoid)
            OR e.transacaoid = p_transacaoid)
    UNION ALL
    SELECT 'DOCUMENTO'::text, d.tipo, d.id, e.id, e.valor
      FROM documentos d
      JOIN public.eventos_financeiros e
        -- OS tem DOIS vinculos possiveis. `ordemservicoid` e a coluna original,
        -- de quando o livro so servia a OS; `source_type`/`source_id` vieram na
        -- 20260802160000, que generalizou a tabela mas nao fez backfill das
        -- linhas antigas. No Demir isso e a maioria: 225 dos 377 eventos de OS
        -- tem `source_type` nulo. Casar so pelo par novo perderia todos eles —
        -- e a OS apareceria como se nao tivesse lancamento nenhum.
        -- Venda nasceu depois da generalizacao e nao tem esse legado.
        ON (d.tipo = 'OS'    AND (e.ordemservicoid = d.id
                                  OR (e.source_type = 'ORDEM_SERVICO' AND e.source_id = d.id)))
        OR (d.tipo = 'VENDA' AND e.source_type = 'VENDA' AND e.source_id = d.id)
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       -- Ja contado como DIRETO: e a despesa que esta propria transacao pagou.
       AND e.transacaoid IS DISTINCT FROM p_transacaoid
  ),
  resolvidos AS (
    SELECT ev.papel, ev.doc_tipo, ev.doc_id, ev.valor,
           public.dre_linha_do_evento(
             ev.evento_id, v_template, v_modo.estado, v_modo.vigencia_inicio) AS linha_id
      FROM eventos ev
  )
  SELECT r.papel, r.doc_tipo, r.doc_id, dl.id, dl.codigo, dl.nome, dl.natureza_dre,
         round(sum(r.valor), 2) AS valor
    FROM resolvidos r
    JOIN public.dre_linha dl ON dl.id = r.linha_id
   GROUP BY r.papel, r.doc_tipo, r.doc_id, dl.id, dl.codigo, dl.nome, dl.natureza_dre
   ORDER BY r.doc_id NULLS FIRST, dl.codigo;
END;
$function$;

COMMENT ON FUNCTION public.dre_linha_da_transacao(bigint) IS
  'Como uma transacao aparece na DRE. papel=DIRETO: ela e o fato, e o valor dela e o valor na linha. papel=DOCUMENTO: ela apenas liquida OS/venda, e o que entra na DRE sao os lancamentos do documento, com o valor deles. Mesma resolucao de linha que dre_somar_por_linha.';

-- ---------------------------------------------------------------------------
-- 9) Previa de uma conta, sem gravar
-- ---------------------------------------------------------------------------
-- Alimenta a tela de cadastro e o seletor de lancamento. Usa a mesma resolucao
-- da soma: a explicacao mostrada nao pode ser calculada por outro caminho.

CREATE OR REPLACE FUNCTION public.dre_previa_da_conta(
  p_conta_id integer,
  p_natureza text,
  p_competencia date DEFAULT current_date,
  p_template_id integer DEFAULT NULL
)
RETURNS TABLE (
  resultado        text,
  classificacao    text,
  classificacao_nome text,
  linha_codigo     text,
  linha_nome       text,
  origem           text,
  motivo           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_template integer;
  v_grupo integer;
  v_class integer;
  v_origem text;
  v_regra integer;
  v_naturezas text[];
  v_codigo text;
  v_nome text;
  v_linha integer;
  v_exclui boolean;
  v_motivo text;
BEGIN
  IF p_natureza IS NULL OR p_natureza NOT IN ('RECEITA', 'DESPESA') THEN
    RAISE EXCEPTION 'Natureza invalida: %.', p_natureza USING ERRCODE = '22023';
  END IF;

  v_template := coalesce(
    p_template_id,
    (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1));

  SELECT c.grupo_id INTO v_grupo FROM public.planosdeconta c WHERE c.id = p_conta_id;
  IF v_grupo IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::text, NULL::text, NULL::text, NULL::text,
      'RESOLVEDOR'::text, 'Conta inexistente.'::text;
    RETURN;
  END IF;

  SELECT r.classificacao_id, r.origem, r.regra_id
    INTO v_class, v_origem, v_regra
    FROM public.dre_classificacao_do_cadastro(p_conta_id, v_grupo, p_competencia) r;

  IF v_class IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::text, NULL::text, NULL::text, NULL::text,
      'RESOLVEDOR'::text,
      'Conta e grupo sem classificacao vigente nesta competencia.'::text;
    RETURN;
  END IF;

  SELECT c.naturezas, c.codigo, c.nome INTO v_naturezas, v_codigo, v_nome
    FROM public.classificacoes_resultado c WHERE c.id = v_class AND c.ativo;

  IF v_naturezas IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, NULL::text, NULL::text, NULL::text, NULL::text,
      v_origem, 'Classificacao inativa ou inexistente.'::text;
    RETURN;
  END IF;

  IF NOT (p_natureza = ANY (v_naturezas)) THEN
    RETURN QUERY SELECT 'INCOMPATIVEL'::text, v_codigo, v_nome, NULL::text, NULL::text,
      v_origem,
      format('%s nao aceita lancamento de %s.', v_nome, lower(p_natureza));
    RETURN;
  END IF;

  SELECT d.linha_id, d.exclui, d.motivo INTO v_linha, v_exclui, v_motivo
    FROM public.dre_destino_da_classificacao(v_template, v_class) d;

  IF v_exclui IS NULL THEN
    RETURN QUERY SELECT 'PENDENTE'::text, v_codigo, v_nome, NULL::text, NULL::text,
      v_origem, format('Classificacao %s sem destino no template.', v_codigo);
    RETURN;
  END IF;

  IF v_exclui THEN
    RETURN QUERY SELECT 'EXCLUIDO'::text, v_codigo, v_nome, NULL::text, NULL::text,
      v_origem, coalesce(v_motivo, 'Nao compoe resultado.');
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'CLASSIFICADO'::text, v_codigo, v_nome, l.codigo, l.nome, v_origem, NULL::text
    FROM public.dre_linha l WHERE l.id = v_linha;
END;
$function$;

COMMENT ON FUNCTION public.dre_previa_da_conta(integer, text, date, integer) IS
  'Explica, sem gravar, para onde um lancamento nesta conta vai: linha da DRE, exclusao com motivo, incompatibilidade de natureza ou pendencia. Mesma resolucao usada pela soma.';

-- ---------------------------------------------------------------------------
-- 10) Guarda de ativacao
-- ---------------------------------------------------------------------------
-- Em ATIVO, a soma le a revisao vigente dos eventos a partir da vigencia. Um
-- evento elegivel sem revisao nao aparece em linha nenhuma: some do total sem
-- avisar. Foi o que a validacao no Demir mostrou — congelamento incompleto e
-- ativacao em seguida derrubaram o periodo de R$ 2.700.822,32 para
-- R$ 1.323.768,53, sem nenhum erro na tela.
--
-- Por isso a ativacao e recusada enquanto existir evento elegivel sem revisao
-- vigente. Congelar o legado inteiro deixa de ser disciplina de quem implanta e
-- passa a ser condicao verificada pelo banco.

CREATE OR REPLACE FUNCTION public.tg_dre_implantacao_exige_congelamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_faltando bigint;
BEGIN
  IF new.estado <> 'ATIVO' THEN
    RETURN new;
  END IF;

  SELECT count(*) INTO v_faltando
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em IS NOT NULL
     AND e.competencia_em >= new.vigencia_inicio
     AND NOT EXISTS (
       SELECT 1 FROM public.eventos_financeiros_classificacao ec
        WHERE ec.evento_id = e.id AND ec.vigente);

  IF v_faltando > 0 THEN
    RAISE EXCEPTION
      'Ativacao recusada: % evento(s) a partir de % ainda nao tem classificacao vigente. Rode dre_congelar_classificacao_legado ate zerar.',
      v_faltando, new.vigencia_inicio
      USING ERRCODE = '23514';
  END IF;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dre_implantacao_exige_congelamento ON public.dre_implantacao;
CREATE TRIGGER trg_dre_implantacao_exige_congelamento
BEFORE INSERT OR UPDATE OF estado, vigencia_inicio ON public.dre_implantacao
FOR EACH ROW EXECUTE FUNCTION public.tg_dre_implantacao_exige_congelamento();

REVOKE ALL ON FUNCTION public.tg_dre_implantacao_exige_congelamento()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11) Acesso
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.dre_modo_apuracao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_linha_do_evento(bigint, integer, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_classificacao_do_cadastro(integer, integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_destino_da_classificacao(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_resolver_evento(bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_gravar_classificacao_evento(bigint, integer, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_congelar_classificacao_legado(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dre_previa_da_conta(integer, text, date, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dre_modo_apuracao() TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_linha_do_evento(bigint, integer, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_classificacao_do_cadastro(integer, integer, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_destino_da_classificacao(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_resolver_evento(bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_gravar_classificacao_evento(bigint, integer, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_congelar_classificacao_legado(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dre_previa_da_conta(integer, text, date, integer) TO service_role;

COMMIT;
