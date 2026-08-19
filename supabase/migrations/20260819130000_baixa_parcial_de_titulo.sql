-- Baixa parcial: o título pode ser pago em partes e carrega o saldo.
--
-- O PROBLEMA
-- A baixa era tudo ou nada. O cliente que pagava R$ 400 de um título de R$ 1.000
-- não tinha como ser registrado: ou o título ia inteiro para liquidado, dizendo
-- que entrou o que não entrou, ou ficava inteiro em aberto, escondendo o dinheiro
-- que já estava na conta. Na prática se excluía e relançava, perdendo o vínculo
-- com o documento e o histórico da cobrança.
--
-- O MODELO
-- O título continua sendo um só. Cada pagamento vira uma transação própria,
-- ligada a ele por `baixa_de_transacao_id`, e o título carrega em `valor_baixado`
-- quanto já foi pago. Só sai de aberto quando as baixas cobrem o valor cheio.
--
-- POR QUE O DINHEIRO PRECISA DE LINHA PRÓPRIA
-- O extrato — aba Fluxo, cards, KPIs, relatórios, exportação — soma
-- `valorLiquido` das linhas que têm banco. Um título de R$ 1.000 com R$ 400 pagos
-- não pode carregar o banco: apareceria por R$ 1.000. A alternativa seria uma
-- segunda coluna de dinheiro e ensinar cada uma daquelas consultas a preferi-la,
-- o que é uma segunda verdade sobre o mesmo número — e o erro ficaria escondido
-- em qualquer consulta que ficasse para trás. Com uma linha de R$ 400, todas elas
-- acertam sem serem tocadas.
--
-- É a mesma forma que a antecipação já usa: o dinheiro num lançamento à parte, os
-- títulos com `banco_id` nulo.
--
-- DUAS FORMAS, E A REGRA QUE AS SEPARA
-- A baixa de uma vez continua como sempre foi: o título recebe o banco em si
-- mesmo. Mudar isso obrigaria a migrar todo o histórico e trocaria a
-- representação de toda transação já lançada. Então a regra é: **um título ou tem
-- banco, ou tem filhas, nunca os dois** — e um gatilho recusa a mistura, que é de
-- onde viria a dupla contagem.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) As colunas
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS baixa_de_transacao_id bigint
    REFERENCES public.transacao(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.transacao.baixa_de_transacao_id IS
  'Esta linha é o dinheiro que entrou ou saiu numa baixa parcial daquele título. Nula em lançamento comum. O título apontado carrega o saldo em valor_baixado.';

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS valor_baixado numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.transacao.valor_baixado IS
  'Quanto das baixas parciais já cobriu este título. O saldo em aberto é valorLiquido - valor_baixado. Mantida pelo gatilho transacao_baixa_parcial_trg; não escrever à mão.';

CREATE INDEX IF NOT EXISTS idx_transacao_baixa_de_transacao
  ON public.transacao (baixa_de_transacao_id)
  WHERE baixa_de_transacao_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) O saldo, mantido por gatilho
-- ---------------------------------------------------------------------------
--
-- Coluna e não subconsulta porque listas, KPIs e ordenação precisam do número em
-- toda linha. Gatilho e não conta na aplicação para não haver duas verdades — é
-- o mesmo desenho de `recalcular_valores_transacao`, que mantém
-- `valor_acrescimos` a partir de `transacao_ajuste`.

CREATE OR REPLACE FUNCTION public.recalcular_baixas_transacao(p_transacao_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_baixado numeric(14,2);
  v_quantas int;
  v_liquido numeric(14,2);
  v_ultimo_pago timestamptz;
BEGIN
  SELECT coalesce(sum(coalesce(nullif(f."valorLiquido", 0), f.valor)), 0),
         count(*), max(f.pago_em)
    INTO v_baixado, v_quantas, v_ultimo_pago
    FROM public.transacao f
   WHERE f.baixa_de_transacao_id = p_transacao_id
     AND f.is_deleted = false;

  SELECT coalesce(nullif(t."valorLiquido", 0), t.valor) INTO v_liquido
    FROM public.transacao t WHERE t.id = p_transacao_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF round(v_baixado, 2) > round(coalesce(v_liquido, 0), 2) THEN
    RAISE EXCEPTION
      'As baixas do título #% somam % e passam do valor dele (%).',
      p_transacao_id, v_baixado, v_liquido USING ERRCODE = '22023';
  END IF;

  -- Título sem baixa parcial nenhuma não é assunto desta função: `pendente` dele
  -- continua sendo decidido pela baixa comum. Mexer aqui reabriria à força tudo
  -- que foi baixado do jeito de sempre.
  IF v_quantas = 0 THEN
    UPDATE public.transacao SET valor_baixado = 0, updated_at = now()
     WHERE id = p_transacao_id AND valor_baixado <> 0;
    RETURN;
  END IF;

  UPDATE public.transacao
     SET valor_baixado = round(v_baixado, 2),
         -- Só fecha quando cobre tudo. Foi a regra escolhida: para perdoar
         -- diferença lança-se desconto, que baixa o líquido, e aí a conta fecha.
         pendente = (round(v_baixado, 2) < round(coalesce(v_liquido, 0), 2)),
         pago_em = CASE
           WHEN round(v_baixado, 2) >= round(coalesce(v_liquido, 0), 2) THEN v_ultimo_pago
           ELSE NULL
         END,
         updated_at = now()
   WHERE id = p_transacao_id;
END;
$function$;

ALTER FUNCTION public.recalcular_baixas_transacao(bigint) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tg_transacao_baixa_parcial()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF old.baixa_de_transacao_id IS NOT NULL THEN
      PERFORM public.recalcular_baixas_transacao(old.baixa_de_transacao_id);
    END IF;
    RETURN old;
  END IF;

  IF new.baixa_de_transacao_id IS NOT NULL THEN
    PERFORM public.recalcular_baixas_transacao(new.baixa_de_transacao_id);
  END IF;

  -- Mover ou apagar logicamente uma filha tem que acertar as duas pontas.
  IF TG_OP = 'UPDATE'
     AND old.baixa_de_transacao_id IS NOT NULL
     AND old.baixa_de_transacao_id IS DISTINCT FROM new.baixa_de_transacao_id THEN
    PERFORM public.recalcular_baixas_transacao(old.baixa_de_transacao_id);
  END IF;

  RETURN new;
END;
$function$;

ALTER FUNCTION public.tg_transacao_baixa_parcial() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_baixa_parcial_trg ON public.transacao;
CREATE TRIGGER transacao_baixa_parcial_trg
  AFTER INSERT OR DELETE OR UPDATE OF
    baixa_de_transacao_id, valor, "valorLiquido", is_deleted, pago_em
  ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_baixa_parcial();

-- ---------------------------------------------------------------------------
-- 3) A trava: ou banco, ou filhas
-- ---------------------------------------------------------------------------
--
-- Um título que tem filhas já teve o dinheiro dele contado nelas. Dar banco a ele
-- somaria o mesmo valor duas vezes no extrato — exatamente o estrago que
-- `transacao_antecipado_sem_banco` foi criada para impedir do outro lado.

CREATE OR REPLACE FUNCTION public.tg_transacao_baixa_parcial_coerente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF new.baixa_de_transacao_id IS NOT NULL THEN
    IF new.banco_id IS NULL THEN
      RAISE EXCEPTION
        'A baixa parcial do título #% precisa de banco: ela é o dinheiro que se moveu.',
        new.baixa_de_transacao_id USING ERRCODE = '22023';
    END IF;
    IF coalesce(new.pendente, false) THEN
      RAISE EXCEPTION
        'A baixa parcial do título #% nasce liquidada: ela registra pagamento que já aconteceu.',
        new.baixa_de_transacao_id USING ERRCODE = '22023';
    END IF;
    IF new.baixa_de_transacao_id = new.id THEN
      RAISE EXCEPTION 'Uma transação não pode ser baixa de si mesma.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.transacao p
       WHERE p.id = new.baixa_de_transacao_id AND p.banco_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'O título #% foi baixado de uma vez e já carrega o banco: ou ele tem banco, ou tem baixas parciais.',
        new.baixa_de_transacao_id USING ERRCODE = '22023';
    END IF;
    RETURN new;
  END IF;

  -- O outro lado da mesma regra.
  IF new.banco_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.transacao f
     WHERE f.baixa_de_transacao_id = new.id AND f.is_deleted = false
  ) THEN
    RAISE EXCEPTION
      'O título #% é pago em partes e o dinheiro dele está nas baixas parciais. Dar banco a ele somaria o mesmo valor duas vezes.',
      new.id USING ERRCODE = '23514';
  END IF;

  RETURN new;
END;
$function$;

ALTER FUNCTION public.tg_transacao_baixa_parcial_coerente() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_baixa_parcial_coerente_trg ON public.transacao;
CREATE TRIGGER transacao_baixa_parcial_coerente_trg
  BEFORE INSERT OR UPDATE OF banco_id, baixa_de_transacao_id, pendente
  ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_baixa_parcial_coerente();

-- ---------------------------------------------------------------------------
-- 4) A baixa aceita um valor
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, boolean
);

CREATE OR REPLACE FUNCTION public.baixar_transacao_pendente(
  p_transacao_id bigint,
  p_pago_em timestamp with time zone,
  p_banco_id bigint,
  p_metodopagamento text,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_baixado_por uuid DEFAULT NULL,
  p_lancar_no_caixa boolean DEFAULT false,
  p_valor numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_metodo public.metodo_pagamento;
  v_antecipada boolean;
  v_lancar boolean := coalesce(p_lancar_no_caixa, false);
  v_atual public.transacao%ROWTYPE;
  v_liquido numeric(14,2);
  v_saldo numeric(14,2);
  v_filha_id bigint;
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_pago_em IS NULL THEN
    RAISE EXCEPTION 'Data do pagamento obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF p_banco_id IS NULL OR p_banco_id <= 0 THEN
    RAISE EXCEPTION 'Banco obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_metodopagamento), '') IS NULL THEN
    RAISE EXCEPTION 'Método de pagamento obrigatório.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_metodo := btrim(p_metodopagamento)::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Método de pagamento inválido: %.', btrim(p_metodopagamento)
      USING ERRCODE = '22023';
  END;

  SELECT * INTO v_atual FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_atual.pendente, false) THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  v_antecipada := v_atual.adiantamento_id IS NOT NULL;
  v_liquido := round(coalesce(nullif(v_atual."valorLiquido", 0), v_atual.valor, 0), 2);
  v_saldo := round(v_liquido - coalesce(v_atual.valor_baixado, 0), 2);

  IF v_lancar AND NOT coalesce(v_antecipada, false) THEN
    RAISE EXCEPTION
      'Só título antecipado escolhe se a baixa entra no caixa: neste o banco já é sempre gravado.'
      USING ERRCODE = '22023';
  END IF;

  -- ---------------------------------------------------------------- parcial
  --
  -- `p_valor` menor que o saldo é uma baixa parcial: nasce a linha filha com o
  -- dinheiro e o título fica aberto pelo que falta. Igual ao saldo, ela fecha o
  -- título — mas se ele já tem filhas, a última também é filha, para o dinheiro
  -- dele não ficar metade num lugar e metade no outro.
  IF p_valor IS NOT NULL THEN
    IF round(p_valor, 2) <= 0 THEN
      RAISE EXCEPTION 'O valor da baixa deve ser maior que zero.' USING ERRCODE = '22023';
    END IF;
    IF round(p_valor, 2) > v_saldo THEN
      RAISE EXCEPTION
        'A baixa de % passa do saldo em aberto do título, que é de %.',
        round(p_valor, 2), v_saldo USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_antecipada, false) THEN
      RAISE EXCEPTION
        'Título antecipado ainda não aceita baixa parcial.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_valor IS NOT NULL
     AND (round(p_valor, 2) < v_saldo OR coalesce(v_atual.valor_baixado, 0) > 0) THEN

    INSERT INTO public.transacao (
      descricao, valor, valor_base, "valorLiquido",
      valor_acrescimos, valor_descontos,
      data, competencia_em, vencimento_em, pago_em,
      tipo, pendente, banco_id, metodopagamento,
      categoria, categoria_id,
      plano_de_conta_id, centro_custo_id,
      cliente_id, fornecedor_id, nomepagador, cpfcnpjpagador,
      baixa_de_transacao_id, created_by, baixado_por
    ) VALUES (
      'Pagamento do título #' || v_atual.id || ' — ' ||
        coalesce(nullif(btrim(v_atual.descricao), ''), 'sem descrição'),
      round(p_valor, 2), round(p_valor, 2), round(p_valor, 2),
      0, 0,
      p_pago_em, coalesce(v_atual.competencia_em, p_pago_em),
      coalesce(v_atual.vencimento_em, v_atual.data), p_pago_em,
      v_atual.tipo, false, p_banco_id, v_metodo,
      v_atual.categoria, v_atual.categoria_id,
      coalesce(p_plano_de_conta_id, v_atual.plano_de_conta_id),
      coalesce(p_centro_custo_id, v_atual.centro_custo_id),
      v_atual.cliente_id, v_atual.fornecedor_id,
      v_atual.nomepagador, v_atual.cpfcnpjpagador,
      v_atual.id, p_baixado_por, p_baixado_por
    ) RETURNING id INTO v_filha_id;

    -- O gatilho já acertou `valor_baixado` e `pendente` do título.
    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
    ) VALUES (
      v_atual.id, coalesce(v_atual.vencimento_em, v_atual.data), p_pago_em,
      p_baixado_por, p_banco_id, v_metodo
    );

    SELECT * INTO v_transacao FROM public.transacao WHERE id = p_transacao_id;

    IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_transacao.id,
      'baixa_id', v_filha_id,
      'valor_baixado', v_transacao.valor_baixado,
      'saldo', round(v_liquido - v_transacao.valor_baixado, 2),
      'pendente', v_transacao.pendente,
      'parcial', true
    );
  END IF;

  -- ------------------------------------------------------------- de uma vez
  UPDATE public.transacao
  SET vencimento_em = coalesce(vencimento_em, data),
      data = p_pago_em,
      pago_em = p_pago_em,
      baixado_por = p_baixado_por,
      -- Título antecipado e honrado não traz dinheiro novo: o caixa já recebeu
      -- pela antecipação, e gravar o banco aqui contaria a mesma entrada duas
      -- vezes. Quando o banco debitou de volta é o contrário.
      banco_id = CASE
        WHEN coalesce(v_antecipada, false) AND NOT v_lancar THEN NULL
        ELSE p_banco_id
      END,
      metodopagamento = v_metodo,
      plano_de_conta_id = p_plano_de_conta_id,
      centro_custo_id = p_centro_custo_id,
      pendente = false,
      updated_at = now()
  WHERE id = p_transacao_id
    AND pendente = true
    AND is_deleted = false
  RETURNING * INTO v_transacao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    v_transacao.baixado_por, v_transacao.banco_id, v_transacao.metodopagamento
  );

  IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
    IF v_transacao.ordemservicoid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
    END IF;

    IF v_transacao.vendaid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
    END IF;

    IF v_transacao.pagamento_multiplo_id IS NOT NULL THEN
      PERFORM public.recalcular_documentos_da_transacao(v_transacao.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pago_em', v_transacao.pago_em,
    'vencimento_em', v_transacao.vencimento_em,
    'pendente', false,
    'parcial', false,
    'lancado_no_caixa', v_transacao.banco_id IS NOT NULL
  );
END;
$function$;

ALTER FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, boolean, numeric
) OWNER TO postgres;

COMMENT ON FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, boolean, numeric
) IS
  'Dá baixa num título em aberto. p_valor menor que o saldo faz baixa parcial: nasce uma transação com o dinheiro, ligada ao título, que segue aberto pelo que falta. p_lancar_no_caixa decide, em título antecipado, se a baixa move a conta.';

-- ---------------------------------------------------------------------------
-- 5) O documento enxerga a parte paga e o que falta
-- ---------------------------------------------------------------------------
--
-- `recebimento_por_documento` é a fonte única de "quanto esta OS ou venda
-- recebeu", e `resumo_financeiro_os` e `recalcular_status_financeiro_venda` leem
-- só dela, separando por `pendente`. Um título parcial passa a emitir DUAS
-- linhas — o que já foi pago e o que falta —, e os dois leitores continuam
-- valendo sem mudança de regra.

CREATE OR REPLACE VIEW public.recebimento_por_documento AS
  WITH titulo AS (
    SELECT t.id,
           CASE WHEN t.ordemservicoid IS NOT NULL THEN 'OS' ELSE 'VENDA' END AS tipo_documento,
           coalesce(t.ordemservicoid, t.vendaid) AS documento_id,
           greatest(coalesce(t.valor, 0) - greatest(coalesce(t.valor_acrescimos, 0), 0), 0) AS face,
           least(
             greatest(coalesce(t.valor_baixado, 0), 0),
             greatest(coalesce(t.valor, 0) - greatest(coalesce(t.valor_acrescimos, 0), 0), 0)
           ) AS pago,
           t.pendente,
           t.pagamento_multiplo_id
      FROM public.transacao t
     WHERE t.is_deleted = false
       AND upper(t.tipo::text) = 'RECEITA'
       AND t.evento_financeiro_id IS NULL
       AND t.baixa_de_transacao_id IS NULL
       AND (t.ordemservicoid IS NOT NULL OR t.vendaid IS NOT NULL)
  )
  -- A parte que já foi paga. Em título sem baixa parcial isto é a linha inteira,
  -- exatamente como antes.
  SELECT id AS transacao_id, tipo_documento, documento_id,
         CASE WHEN pendente AND pago > 0 THEN pago ELSE face END AS valor,
         CASE WHEN pendente AND pago > 0 THEN false ELSE pendente END AS pendente,
         pagamento_multiplo_id
    FROM titulo
   WHERE NOT (pendente AND pago > 0) OR pago > 0
  UNION ALL
  -- O que falta, só em título parcial.
  SELECT id, tipo_documento, documento_id, round(face - pago, 2), true, pagamento_multiplo_id
    FROM titulo
   WHERE pendente AND pago > 0 AND face > pago
  UNION ALL
  -- A fatia já é valor de face: o rateio é calculado sobre o saldo do documento,
  -- sem acréscimo financeiro, que pertence à transação inteira.
  SELECT t.id, r.tipo_documento, r.documento_id, r.valor, t.pendente, t.pagamento_multiplo_id
    FROM public.pagamento_multiplo_rateio r
    JOIN public.transacao t ON t.id = r.transacao_id
   WHERE t.is_deleted = false;

COMMENT ON VIEW public.recebimento_por_documento IS
  'Fonte única de "quanto esta OS ou venda recebeu". Unifica o vínculo direto, o rateio do pagamento múltiplo e a baixa parcial — que emite duas linhas, a paga e a que falta.';

ALTER VIEW public.recebimento_por_documento OWNER TO postgres;

-- Um título parcial vira duas linhas, e `count(*)` passaria a dizer dois
-- recebimentos onde há um título. A contagem é de títulos, não de linhas da view.
CREATE OR REPLACE FUNCTION public.resumo_financeiro_os(p_ordemservicoid integer)
RETURNS TABLE (
  total_devido numeric(14,2),
  valor_recebido numeric(14,2),
  valor_pendente numeric(14,2),
  valor_comprometido numeric(14,2),
  saldo_a_receber numeric(14,2),
  saldo_disponivel_lancamento numeric(14,2),
  quantidade_transacoes bigint,
  quitada boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH dados_os AS (
    SELECT round(
      greatest(coalesce(o.orcamentototal, 0), 0) +
      CASE
        WHEN o.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
          greatest(coalesce(o.orcamentototal, 0), 0) *
          least(greatest(coalesce(o.acrescimo_financeiro_valor, 0), 0), 100) / 100
        WHEN o.acrescimo_financeiro_tipo = 'FIXO' THEN
          greatest(coalesce(o.acrescimo_financeiro_valor, 0), 0)
        ELSE 0
      END,
      2
    )::numeric(14,2) AS total
    FROM public.ordemservico o
    WHERE o.id = p_ordemservicoid
      AND coalesce(o.is_deleted, false) = false
  ),
  pagamentos AS (
    SELECT
      coalesce(round(sum(r.valor) FILTER (WHERE r.pendente = false), 2), 0)::numeric(14,2) AS recebido,
      coalesce(round(sum(r.valor) FILTER (WHERE r.pendente = true), 2), 0)::numeric(14,2) AS pendente,
      count(DISTINCT r.transacao_id)::bigint AS quantidade
    FROM public.recebimento_por_documento r
    WHERE r.tipo_documento = 'OS'
      AND r.documento_id = p_ordemservicoid
  )
  SELECT
    d.total,
    p.recebido,
    p.pendente,
    round(p.recebido + p.pendente, 2)::numeric(14,2),
    greatest(round(d.total - p.recebido, 2), 0)::numeric(14,2),
    greatest(round(d.total - p.recebido - p.pendente, 2), 0)::numeric(14,2),
    p.quantidade,
    (d.total > 0 AND round(p.recebido + p.pendente, 2) >= d.total)
  FROM dados_os d
  CROSS JOIN pagamentos p;
$function$;

ALTER FUNCTION public.resumo_financeiro_os(integer) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 6) A baixa parcial não é resultado novo
-- ---------------------------------------------------------------------------
--
-- A receita já foi reconhecida pelo título — ou pelo documento dele. A filha é a
-- liquidação, não fato novo; sem esta exclusão o mesmo dinheiro entraria duas
-- vezes na DRE.

CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_transacao(p_transacaoid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tx public.transacao%ROWTYPE;
  v_linha_id integer;
  v_exclui boolean := false;
  v_natureza text;
  v_natureza_dre text;
begin
  select * into v_tx from public.transacao where id = p_transacaoid;
  if not found then return; end if;

  if v_tx.is_deleted
     or v_tx.evento_financeiro_id is not null
     or v_tx.ordemservicoid is not null
     or v_tx.vendaid is not null
     or v_tx.entrada_id is not null
     or v_tx.usoconsumo_entrada_id is not null
     or v_tx.origem = 'ORIGEM_MIGRACAO'
     or coalesce(v_tx.eh_adiantamento, false)
     or v_tx.adiantamento_id is not null
     or v_tx.baixa_de_transacao_id is not null
     or upper(v_tx.tipo::text) in ('SAQUE', 'DEPOSITO') then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  select mp.linha_id, mp.exclui_do_resultado
    into v_linha_id, v_exclui
    from public.planosdeconta pc
    join public.dre_mapeamento mp
      on mp.origem_tipo = 'PLANO_GRUPO' and mp.origem_id = pc.grupo_id and mp.ativo
   where pc.id = v_tx.plano_de_conta_id
   limit 1;

  if coalesce(v_exclui, false) then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  v_natureza := case when upper(v_tx.tipo::text) = 'RECEITA' then 'RECEITA' else 'DESPESA' end;

  select dl.natureza_dre into v_natureza_dre
    from public.dre_linha dl where dl.id = v_linha_id;

  v_natureza_dre := coalesce(v_natureza_dre,
    case when v_natureza = 'RECEITA' then 'RECEITA' else 'DESPESA' end);

  update public.eventos_financeiros
     set natureza = v_natureza, updated_at = now()
   where source_type = 'TRANSACAO'
     and source_id = p_transacaoid
     and status <> 'CONVERTIDO'
     and natureza is distinct from v_natureza;

  insert into public.eventos_financeiros
    (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, competencia_em, dre_linha_id,
     centro_custo_id, transacaoid, dados_snapshot, pode_gerar_transacao, status)
  values
    (null, 'TRANSACAO', p_transacaoid, 'AVULSO', v_natureza, v_natureza_dre,
     'TRANSACAO', coalesce(nullif(v_tx.descricao, ''), 'Lancamento #' || p_transacaoid),
     nullif(v_tx.plano_de_conta, ''), round(coalesce(v_tx.valor, 0), 2),
     coalesce(v_tx.competencia_em, v_tx.data), v_linha_id,
     v_tx.centro_custo_id, p_transacaoid,
     jsonb_build_object('categoria', v_tx.categoria, 'sem_classificacao', v_linha_id is null),
     false, 'ATIVO')
  on conflict (source_type, source_id, origem, chave_origem, natureza)
    where ordemservicoid is null
  do update set valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                competencia_em = excluded.competencia_em,
                dre_linha_id = excluded.dre_linha_id,
                natureza_dre = excluded.natureza_dre,
                centro_custo_id = excluded.centro_custo_id,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  where public.eventos_financeiros.status <> 'CONVERTIDO';
end;
$function$;

COMMENT ON FUNCTION public.sincronizar_eventos_financeiros_transacao(bigint) IS
  'Evento de resultado de uma transacao avulsa. Ignora o que e liquidacao de algo ja reconhecido (OS, venda, evento, baixa parcial), compra que vira estoque, saldo de abertura migrado, antecipacao de recebiveis e movimentacao de tesouraria.';

DROP TRIGGER IF EXISTS trg_eventos_financeiros_transacao ON public.transacao;
CREATE TRIGGER trg_eventos_financeiros_transacao
AFTER INSERT OR UPDATE OF
  valor, tipo, competencia_em, data, plano_de_conta_id, centro_custo_id,
  is_deleted, descricao, origem, pagamento_multiplo_id,
  eh_adiantamento, adiantamento_id, baixa_de_transacao_id
ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_transacao();

-- ---------------------------------------------------------------------------
-- 7) Estornar alcança a baixa parcial
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.estornar_baixa_transacao(
  p_transacao_id bigint,
  p_estornado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_acrescimos_removidos numeric(14,2) := 0;
  v_valor_reaberto numeric(14,2);
  v_baixa_do_titulo boolean := false;
  v_titulo bigint;
BEGIN
  SELECT * INTO v_transacao
    FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Estornar uma baixa parcial é apagar aquele pagamento: o dinheiro sai do
  -- extrato e o título volta a dever aquele pedaço. O gatilho refaz o saldo e
  -- reabre o título se ele já estava fechado.
  IF v_transacao.baixa_de_transacao_id IS NOT NULL THEN
    v_titulo := v_transacao.baixa_de_transacao_id;

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_titulo, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, v_transacao.banco_id, v_transacao.metodopagamento, 'ESTORNO'
    );

    DELETE FROM public.transacao WHERE id = p_transacao_id;

    SELECT * INTO v_transacao FROM public.transacao WHERE id = v_titulo;

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_titulo,
      'baixa_estornada', p_transacao_id,
      'valor_baixado', v_transacao.valor_baixado,
      'pendente', v_transacao.pendente,
      'parcial', true
    );
  END IF;

  IF coalesce(v_transacao.pendente, false) THEN
    RAISE EXCEPTION 'Esta transação não está liquidada: não há baixa a estornar.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.adiantamento_id IS NOT NULL THEN
    SELECT coalesce(a.adiantamento_manteve_pendentes, false) INTO v_baixa_do_titulo
      FROM public.transacao a WHERE a.id = v_transacao.adiantamento_id;

    IF NOT coalesce(v_baixa_do_titulo, false) THEN
      RAISE EXCEPTION
        'Este título foi liquidado pela antecipação #%. Desfaça a antecipação: ela devolve este título e os irmãos para em aberto de uma vez.',
        v_transacao.adiantamento_id USING ERRCODE = '22023';
    END IF;
  END IF;

  IF coalesce(v_transacao.eh_adiantamento, false) THEN
    RAISE EXCEPTION
      'Esta é uma antecipação, não a baixa de um título. Excluí-la é que devolve os títulos para em aberto.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta baixa é uma perna do pagamento múltiplo #%. Desfaça o pagamento inteiro.',
      v_transacao.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;

  -- Título fechado por baixas parciais: o estorno é de cada pagamento, um a um,
  -- porque cada um tem data, banco e valor próprios e some do extrato sozinho.
  IF EXISTS (
    SELECT 1 FROM public.transacao f
     WHERE f.baixa_de_transacao_id = p_transacao_id AND f.is_deleted = false
  ) THEN
    RAISE EXCEPTION
      'Este título foi pago em partes. Estorne os pagamentos dele, um a um.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.transacao
     SET pendente = true,
         data = coalesce(vencimento_em, data),
         pago_em = NULL,
         baixado_por = NULL,
         banco_id = CASE WHEN v_transacao.adiantamento_id IS NOT NULL THEN NULL ELSE banco_id END,
         updated_at = now()
   WHERE id = p_transacao_id;

  WITH removidos AS (
    DELETE FROM public.transacao_ajuste
     WHERE transacao_id = p_transacao_id
       AND natureza = 'ACRESCIMO'
    RETURNING valor_calculado
  )
  SELECT coalesce(sum(valor_calculado), 0) INTO v_acrescimos_removidos FROM removidos;

  v_valor_reaberto := round(coalesce(v_transacao.valor_base, v_transacao.valor), 2);

  UPDATE public.transacao
     SET valor = v_valor_reaberto,
         valor_acrescimos = 0,
         "valorLiquido" = round(v_valor_reaberto - coalesce(valor_descontos, 0), 2),
         updated_at = now()
   WHERE id = p_transacao_id;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id,
    coalesce(v_transacao.vencimento_em, v_transacao.data),
    coalesce(v_transacao.pago_em, v_transacao.data),
    p_estornado_por,
    v_transacao.banco_id,
    v_transacao.metodopagamento,
    'ESTORNO'
  );

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', true,
    'valor', v_valor_reaberto,
    'acrescimos_removidos', v_acrescimos_removidos,
    'vencimento_em', coalesce(v_transacao.vencimento_em, v_transacao.data)
  );
END;
$$;

ALTER FUNCTION public.estornar_baixa_transacao(bigint, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) TO service_role;

COMMIT;
