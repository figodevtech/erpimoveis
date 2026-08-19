-- Baixa parcial num título que já tem banco preenchido.
--
-- O QUE QUEBROU
-- `20260819130000` criou a trava "ou o título tem banco, ou tem baixas parciais",
-- para o mesmo dinheiro não ser contado no título e nas baixas dele. A trava está
-- certa, mas a pergunta que ela fazia estava errada: ela testava `banco_id IS NOT
-- NULL` e concluía "este título foi baixado de uma vez".
--
-- Não é o que `banco_id` significa num título EM ABERTO. Ali ele é a conta
-- prevista — de onde a pessoa espera receber, ou por onde vai pagar —, e é
-- preenchido no lançamento, muito antes de existir pagamento. No banco de
-- demonstração havia seis títulos assim; o #245 estava em aberto, com banco 2 e
-- nenhum centavo recebido, e a trava recusou a baixa parcial dele dizendo que ele
-- já tinha sido baixado.
--
-- A CORREÇÃO, EM DUAS PARTES
-- 1. A trava passa a perguntar o que de fato importa: o título está LIQUIDADO e
--    com banco? Só aí o dinheiro dele está nele, e uma baixa parcial duplicaria.
--    Título em aberto com banco é estado normal e segue aceitando baixa parcial.
--
-- 2. A primeira baixa parcial limpa o banco do título. Sem isso a trava passaria
--    agora e o estrago apareceria depois: quando as parciais cobrissem o valor, o
--    título viraria `pendente = false` ainda com banco, e o extrato somaria o
--    título inteiro ao lado das baixas dele. O banco de verdade passa a ser o de
--    cada baixa, que é onde o dinheiro entrou mesmo.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A trava olha para o título liquidado, não para o banco previsto
-- ---------------------------------------------------------------------------

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

    -- LIQUIDADO e com banco: o dinheiro está no próprio título, e uma baixa
    -- parcial em cima dele contaria o mesmo valor duas vezes. Em aberto o banco é
    -- só a conta prevista, e não impede nada.
    IF EXISTS (
      SELECT 1 FROM public.transacao p
       WHERE p.id = new.baixa_de_transacao_id
         AND p.pendente = false
         AND p.banco_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'O título #% já foi baixado de uma vez e o dinheiro dele está nele: ou ele tem banco, ou tem baixas parciais.',
        new.baixa_de_transacao_id USING ERRCODE = '22023';
    END IF;
    RETURN new;
  END IF;

  -- O outro lado da mesma regra, e aqui NÃO se olha `pendente`.
  --
  -- Tentei afrouxar para "só quando fechar", já que título em aberto não aparece
  -- no extrato. Mas aceitar o banco agora só adia o estouro: quando as parciais
  -- cobrissem o valor, o gatilho do saldo poria `pendente = false` e a trava
  -- dispararia ali — no meio da baixa que o usuário acabou de mandar, com uma
  -- mensagem sobre um banco que ele gravou dias antes. Recusar na hora em que se
  -- tenta gravar é o único lugar em que dá para explicar o motivo.
  IF new.banco_id IS NOT NULL
     AND EXISTS (
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

-- ---------------------------------------------------------------------------
-- 2) A primeira baixa parcial limpa o banco previsto do título
-- ---------------------------------------------------------------------------

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

    -- O banco que estava no título era a conta PREVISTA, escolhida no
    -- lançamento. A partir daqui o dinheiro mora nas baixas, e cada uma sabe por
    -- onde entrou de verdade. Deixá-lo aqui faria o título somar junto com elas
    -- no extrato assim que fosse coberto.
    IF v_atual.banco_id IS NOT NULL THEN
      UPDATE public.transacao SET banco_id = NULL, updated_at = now()
       WHERE id = p_transacao_id;
    END IF;

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

  UPDATE public.transacao
  SET vencimento_em = coalesce(vencimento_em, data),
      data = p_pago_em,
      pago_em = p_pago_em,
      baixado_por = p_baixado_por,
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

COMMIT;
