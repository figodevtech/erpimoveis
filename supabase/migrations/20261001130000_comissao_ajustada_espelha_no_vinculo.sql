-- A comissao corrigida a mao no evento financeiro da OS passa a valer tambem no vinculo.
--
-- O PROBLEMA. A comissao de um servico e corrigida editando o evento COMISSAO
-- da OS (`editarEventoDaOs`, override que marca `is_manual`). A edicao
-- so tocava `eventos_financeiros`. `osservico_realizador.valor_comissao` seguia
-- com o valor calculado -- e e dali que leem o relatorio de Servicos
-- Realizados, a Central Pessoal (lista e cards), os relatorios de comissao por
-- realizador e por setor, a rentabilidade e o detalhe da OS. Medido no Demir:
-- os eventos das OS #163, #290 e #350 registram R$ 190, R$ 60 e R$ 190 para o
-- ADRIANO ELETRICISTA, e todos esses lugares mostravam R$ 0; o da #434 zerou os
-- R$ 9,68 do GUILHERME LEOPOLDO, e eles seguiam mostrando R$ 9,68.
--
-- A REGRA. O evento e o registro contabil da comissao -- e ele que entra na
-- DRE pela competencia, e e dele que o setor financeiro parte quando lancar o
-- pagamento no caixa ou no a pagar --, entao e ele quem manda. Ele ainda nao e
-- dinheiro: so vira fluxo de caixa quando alguem o lanca. O valor ajustado fica
-- guardado em `valor_comissao_manual` e e copiado para `valor_comissao`, que
-- continua sendo a coluna efetiva para todos os leitores. O recalculo segue
-- atualizando base e percentual -- o que a regra daria --, mas nao reescreve o
-- valor ajustado, pelo mesmo motivo que a reconciliacao nao reescreve evento
-- `is_manual`: sem isso a correcao voltaria sozinha no proximo toque no
-- orcamento, e o vinculo divergiria do evento outra vez.
--
-- A comissao de criacao (`os_comissao_criacao`) aceita o mesmo override e tinha
-- a mesma brecha, ainda sem nenhum caso. Recebe o mesmo tratamento.
--
-- POR GATILHO. Duas familias de rota editam o evento (`/api/ordens/...` e
-- `/api/eventos-financeiros/...`); no banco o espelho vale para as duas e para
-- qualquer caminho futuro. Nao ha laco: os gatilhos de recalculo do vinculo sao
-- de INSERT/DELETE, e nada que atualiza o vinculo escreve em evento.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Onde o ajuste mora
-- ---------------------------------------------------------------------------
ALTER TABLE public.osservico_realizador
  ADD COLUMN IF NOT EXISTS valor_comissao_manual numeric(12,2);

COMMENT ON COLUMN public.osservico_realizador.valor_comissao_manual IS
  'Comissao corrigida a mao no evento financeiro da OS. Quando preenchida, e o valor de valor_comissao e o recalculo nao a substitui. NULL = valor calculado.';

ALTER TABLE public.os_comissao_criacao
  ADD COLUMN IF NOT EXISTS valor_comissao_manual numeric(12,2);

COMMENT ON COLUMN public.os_comissao_criacao.valor_comissao_manual IS
  'Comissao de criacao corrigida a mao no evento financeiro da OS. Quando preenchida, e o valor de valor_comissao e o recalculo nao a substitui. NULL = valor calculado.';

-- ---------------------------------------------------------------------------
-- 2) O recalculo de realizacao respeita o ajuste
-- ---------------------------------------------------------------------------
-- Copia fiel de 20260903160000; so a atribuicao de `valor_comissao` muda.
CREATE OR REPLACE FUNCTION public.recalcular_comissao_osservico(
  p_ordemservicoid integer,
  p_servicoid integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_subtotal numeric;
  v_qtd int;
  v_gera_comissao boolean;
  v_total_itens numeric := 0;
  v_total_os_sem_frete numeric := 0;
  v_fator numeric := 1;
  v_base_liquida numeric;
  v_percent_maior numeric := 0;
  v_execucao_encerrada boolean := true;
BEGIN
  SELECT coalesce(s.subtotal, 0) INTO v_subtotal
    FROM public.osservico s
   WHERE s.ordemservicoid = p_ordemservicoid AND s.servicoid = p_servicoid;
  SELECT coalesce(sv.gera_comissao, true) INTO v_gera_comissao
    FROM public.servico sv WHERE sv.id = p_servicoid;
  SELECT count(*) INTO v_qtd FROM public.osservico_realizador r
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;
  IF v_qtd <= 0 THEN RETURN; END IF;

  SELECT greatest(coalesce(o.orcamentototal, 0) - coalesce(o.valor_frete, 0), 0),
         coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.subtotal, 0)) FROM public.osservico os WHERE os.ordemservicoid = o.id), 0),
         o.execucao_fim_em IS NOT NULL
    INTO v_total_os_sem_frete, v_total_itens, v_execucao_encerrada
    FROM public.ordemservico o WHERE o.id = p_ordemservicoid;

  -- Enquanto o servico nao foi entregue, quem manda e o cadastro de hoje: a
  -- taxa que vale e a do dia da entrega, nao a do dia da atribuicao.
  IF NOT v_execucao_encerrada THEN
    PERFORM public.recarimbar_comissao_osservico(p_ordemservicoid, p_servicoid);
  END IF;

  IF v_total_itens > 0 THEN v_fator := v_total_os_sem_frete / v_total_itens; END IF;
  v_base_liquida := round(v_subtotal * v_fator / v_qtd, 2);

  -- O maior percentual entre quem executou. Com um realizador so, e a taxa dele
  -- e nada muda em relacao ao comportamento anterior.
  SELECT coalesce(max(coalesce(r.comissao_percent_aplicada, 0)), 0)
    INTO v_percent_maior
    FROM public.osservico_realizador r
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;

  -- Servico que nao comissiona zera a taxa efetiva, e nao so o valor: assim a
  -- linha zerada no relatorio se explica sozinha.
  IF NOT coalesce(v_gera_comissao, true) THEN
    v_percent_maior := 0;
  END IF;

  -- O ajuste feito no evento prevalece; base e percentual seguem dizendo
  -- o que a regra calcularia.
  UPDATE public.osservico_realizador r
     SET valor_base = v_base_liquida,
         comissao_percent_efetiva = v_percent_maior,
         valor_comissao = coalesce(r.valor_comissao_manual, round(v_base_liquida * v_percent_maior / 100.0, 2)),
         updated_at = now()
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) O recalculo de criacao respeita o ajuste
-- ---------------------------------------------------------------------------
-- Copia fiel de 20260904150000; so o ON CONFLICT de `valor_comissao` muda.
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
      -- O ajuste feito no evento prevalece sobre o calculo.
      valor_comissao = coalesce(c.valor_comissao_manual, excluded.valor_comissao),
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

-- ---------------------------------------------------------------------------
-- 4) O espelho: evento ajustado -> vinculo
-- ---------------------------------------------------------------------------
-- A chave do evento e a mesma que a reconciliacao monta: `servico:usuario` para
-- a realizacao e `CRIACAO:usuario:<S|P|A>item` para a criacao. Casar pela chave
-- inteira evita interpretar pedacos dela.
CREATE OR REPLACE FUNCTION public.tg_espelhar_comissao_ajustada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_servicoid integer;
BEGIN
  IF new.chave_origem LIKE 'CRIACAO:%' THEN
    IF new.status = 'CANCELADO' THEN
      UPDATE public.os_comissao_criacao c
         SET valor_comissao_manual = NULL, updated_at = now()
       WHERE c.ordemservicoid = new.ordemservicoid
         AND 'CRIACAO:' || c.usuarioid || ':'
             || CASE c.tipo WHEN 'SERVICO' THEN 'S' WHEN 'PRODUTO' THEN 'P' ELSE 'A' END
             || c.item_id = new.chave_origem
         AND c.valor_comissao_manual IS NOT NULL;
      IF FOUND THEN
        PERFORM public.recalcular_comissao_criacao_os(new.ordemservicoid);
      END IF;
    ELSE
      UPDATE public.os_comissao_criacao c
         SET valor_comissao_manual = new.valor,
             valor_comissao = new.valor,
             updated_at = now()
       WHERE c.ordemservicoid = new.ordemservicoid
         AND 'CRIACAO:' || c.usuarioid || ':'
             || CASE c.tipo WHEN 'SERVICO' THEN 'S' WHEN 'PRODUTO' THEN 'P' ELSE 'A' END
             || c.item_id = new.chave_origem
         AND (c.valor_comissao_manual IS DISTINCT FROM new.valor
              OR c.valor_comissao IS DISTINCT FROM new.valor);
    END IF;
    RETURN NULL;
  END IF;

  IF new.status = 'CANCELADO' THEN
    UPDATE public.osservico_realizador r
       SET valor_comissao_manual = NULL, updated_at = now()
     WHERE r.ordemservicoid = new.ordemservicoid
       AND r.servicoid || ':' || r.usuarioid = new.chave_origem
       AND r.valor_comissao_manual IS NOT NULL
    RETURNING r.servicoid INTO v_servicoid;
    IF v_servicoid IS NOT NULL THEN
      PERFORM public.recalcular_comissao_osservico(new.ordemservicoid, v_servicoid);
    END IF;
  ELSE
    UPDATE public.osservico_realizador r
       SET valor_comissao_manual = new.valor,
           valor_comissao = new.valor,
           updated_at = now()
     WHERE r.ordemservicoid = new.ordemservicoid
       AND r.servicoid || ':' || r.usuarioid = new.chave_origem
       AND (r.valor_comissao_manual IS DISTINCT FROM new.valor
            OR r.valor_comissao IS DISTINCT FROM new.valor);
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.tg_espelhar_comissao_ajustada() IS
  'Copia o valor de um evento COMISSAO ajustado a mao (is_manual) para o vinculo de origem (osservico_realizador ou os_comissao_criacao), onde relatorios e Central Pessoal leem. Evento cancelado devolve o vinculo ao calculo.';

ALTER FUNCTION public.tg_espelhar_comissao_ajustada() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tg_espelhar_comissao_ajustada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_espelhar_comissao_ajustada ON public.eventos_financeiros;
CREATE TRIGGER trg_espelhar_comissao_ajustada
  AFTER INSERT OR UPDATE OF valor, is_manual, status ON public.eventos_financeiros
  FOR EACH ROW
  WHEN (new.origem = 'COMISSAO' AND new.natureza = 'DESPESA'
        AND new.ordemservicoid IS NOT NULL AND coalesce(new.is_manual, false))
  EXECUTE FUNCTION public.tg_espelhar_comissao_ajustada();

-- ---------------------------------------------------------------------------
-- 5) Backfill: os ajustes que ja existem
-- ---------------------------------------------------------------------------
-- Toca so os vinculos de eventos ja ajustados; o valor escrito e o que o
-- evento ja registra na DRE, entao nenhum mes muda de resultado -- so passa a
-- mostrar o mesmo numero em todo lugar.
DO $backfill$
DECLARE
  v_realizacao integer;
  v_criacao integer;
BEGIN
  UPDATE public.osservico_realizador r
     SET valor_comissao_manual = e.valor,
         valor_comissao = e.valor,
         updated_at = now()
    FROM public.eventos_financeiros e
   WHERE e.origem = 'COMISSAO'
     AND e.natureza = 'DESPESA'
     AND coalesce(e.is_manual, false)
     AND e.status <> 'CANCELADO'
     AND e.chave_origem NOT LIKE 'CRIACAO:%'
     AND e.ordemservicoid = r.ordemservicoid
     AND e.chave_origem = r.servicoid || ':' || r.usuarioid;
  GET DIAGNOSTICS v_realizacao = ROW_COUNT;

  UPDATE public.os_comissao_criacao c
     SET valor_comissao_manual = e.valor,
         valor_comissao = e.valor,
         updated_at = now()
    FROM public.eventos_financeiros e
   WHERE e.origem = 'COMISSAO'
     AND e.natureza = 'DESPESA'
     AND coalesce(e.is_manual, false)
     AND e.status <> 'CANCELADO'
     AND e.chave_origem LIKE 'CRIACAO:%'
     AND e.ordemservicoid = c.ordemservicoid
     AND e.chave_origem = 'CRIACAO:' || c.usuarioid || ':'
         || CASE c.tipo WHEN 'SERVICO' THEN 'S' WHEN 'PRODUTO' THEN 'P' ELSE 'A' END
         || c.item_id;
  GET DIAGNOSTICS v_criacao = ROW_COUNT;

  RAISE NOTICE 'Comissao ajustada espelhada em % vinculo(s) de realizacao e % de criacao.', v_realizacao, v_criacao;
END
$backfill$;

COMMIT;
