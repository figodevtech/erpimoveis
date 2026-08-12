-- Correções vindas do primeiro uso real do pagamento múltiplo em venda.
--
-- CASO: duas vendas (R$ 300,00 e R$ 10,05) pagas com um parcelado de R$ 310,05
-- cobrados e R$ 300,00 líquidos, em 2x. O resultado saiu errado em três frentes,
-- duas delas resolvidas aqui.
--
-- 1. A TAXA SUMIA. A RPC não recebia o líquido: gravava `valorLiquido = valor` em
--    cada parcela. Os R$ 10,05 retidos pela adquirente não ficavam registrados em
--    lugar nenhum. Agora o grupo carrega o líquido e cada parcela recebe a sua
--    parte, com a diferença de centavos na última — a soma fecha com o informado.
--
-- 2. VENDA NÃO QUITAVA COM TÍTULO FUTURO. `recalcular_status_financeiro_venda`
--    só contava título já baixado, enquanto a OS conta o pendente como
--    compromisso e conclui na hora. Eram duas regras para o mesmo fato: o cliente
--    assumiu a dívida, e a baixa é tarefa do financeiro depois. A venda passa a
--    seguir a mesma regra da OS.
--
--    Consequência direta: venda com boleto parcelado sai de PAGAMENTO assim que o
--    pagamento é registrado, e volta se um título for excluído.
--
-- 3. Excluir uma venda apagava suas transações por `vendaid`. Numa transação de
--    pagamento múltiplo esse campo é nulo — a exclusão passaria batido e deixaria
--    o rateio apontando para uma venda que não existe mais. Passa a barrar, como
--    já acontece na reversão de status da OS.
BEGIN;

-- ---------------------------------------------------------------- 2: a venda
CREATE OR REPLACE FUNCTION public.recalcular_status_financeiro_venda(p_venda_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_total_devido numeric(14,2);
  v_comprometido numeric(14,2);
  v_status text;
  v_novo text;
BEGIN
  SELECT v.status::text,
         round(
           greatest(coalesce(v.valortotal, 0), 0) +
           CASE
             WHEN v.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
               greatest(coalesce(v.valortotal, 0), 0) *
               least(greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0), 100) / 100
             WHEN v.acrescimo_financeiro_tipo = 'FIXO' THEN
               greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0)
             ELSE 0
           END,
           2
         )
    INTO v_status, v_total_devido
  FROM public.venda v
  WHERE v.id = p_venda_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_status = 'CANCELADA' THEN RETURN; END IF;

  -- Pendente conta: título em aberto é compromisso assumido, igual à OS. Quem
  -- recebe de fato é a baixa, que é trabalho do financeiro e não do vendedor.
  SELECT coalesce(round(sum(r.valor), 2), 0)
    INTO v_comprometido
  FROM public.recebimento_por_documento r
  WHERE r.tipo_documento = 'VENDA'
    AND r.documento_id = p_venda_id;

  v_novo := CASE WHEN v_total_devido > 0 AND v_comprometido >= v_total_devido
                 THEN 'FINALIZADA' ELSE 'PAGAMENTO' END;

  UPDATE public.venda
  SET status = v_novo::public.enum_status_venda,
      updatedat = now()
  WHERE id = p_venda_id
    AND status::text IS DISTINCT FROM v_novo;
END;
$function$;

ALTER FUNCTION public.recalcular_status_financeiro_venda(integer) OWNER TO postgres;

COMMENT ON FUNCTION public.recalcular_status_financeiro_venda(integer) IS
  'Status financeiro da venda. Título pendente conta como comprometido e já finaliza a venda, mesma regra da ordem de serviço.';

-- ------------------------------------------------------------- 1: o líquido
CREATE OR REPLACE FUNCTION public.registrar_pagamento_multiplo(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tipo_documento text := upper(coalesce(p_payload->>'tipo_documento', ''));
  v_modo text := upper(coalesce(p_payload->>'modo', ''));
  v_valor_total numeric(14,2) := round(coalesce((p_payload->>'valor_total')::numeric, 0), 2);
  v_liquido_total numeric(14,2) := round(coalesce((p_payload->>'valor_liquido')::numeric, 0), 2);
  v_data timestamptz := coalesce(nullif(p_payload->>'data', '')::timestamptz, now());
  v_banco_id bigint := nullif(p_payload->>'banco_id', '')::bigint;
  v_metodo public.metodo_pagamento := nullif(p_payload->>'metodopagamento', '')::public.metodo_pagamento;
  v_created_by uuid := nullif(p_payload->>'created_by', '')::uuid;
  v_categoria text := coalesce(nullif(p_payload->>'categoria', ''), 'NÃO RELACIONADO');
  v_categoria_id integer := nullif(p_payload->>'categoria_id', '')::integer;
  v_plano_id integer := nullif(p_payload->>'plano_de_conta_id', '')::integer;
  v_centro_id integer := nullif(p_payload->>'centro_custo_id', '')::integer;
  v_pendente boolean := (v_modo = 'PARCELADO');
  v_grupo_id bigint;
  v_soma numeric(14,2);
  v_doc_id integer;
  v_documentos integer[] := ARRAY[]::integer[];
  v_cliente_id integer := nullif(p_payload->>'cliente_id', '')::integer;
  v_nome text := nullif(btrim(p_payload->>'nomepagador'), '');
  v_cpfcnpj text := nullif(btrim(p_payload->>'cpfcnpjpagador'), '');
  v_clientes integer[];
  v_descricao_grupo text;
  v_descricao text;
  v_parcela record;
  v_transacao_id bigint;
  v_total_parcelas integer;
  v_comprometido numeric(14,2);
  v_devido numeric(14,2);
  v_liquido numeric(14,2);
  v_liquido_acumulado numeric(14,2) := 0;
  v_indice integer := 0;
BEGIN
  IF v_tipo_documento NOT IN ('OS', 'VENDA') THEN
    RAISE EXCEPTION 'tipo_documento deve ser OS ou VENDA.' USING ERRCODE = 'P0001';
  END IF;
  IF v_modo NOT IN ('AVISTA', 'PARCELADO') THEN
    RAISE EXCEPTION 'modo deve ser AVISTA ou PARCELADO.' USING ERRCODE = 'P0001';
  END IF;
  IF v_valor_total <= 0 THEN
    RAISE EXCEPTION 'O valor do pagamento deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_payload->'linhas') <> 'array'
     OR jsonb_array_length(p_payload->'linhas') = 0 THEN
    RAISE EXCEPTION 'Informe as linhas do rateio.' USING ERRCODE = 'P0001';
  END IF;

  -- Sem líquido informado, líquido é o próprio valor: não houve taxa.
  IF v_liquido_total <= 0 THEN v_liquido_total := v_valor_total; END IF;

  SELECT round(coalesce(sum((item->>'valor')::numeric), 0), 2) INTO v_soma
    FROM jsonb_array_elements(p_payload->'linhas') AS item;

  IF v_soma <> v_valor_total THEN
    RAISE EXCEPTION 'A soma do rateio (%) difere do valor do pagamento (%).',
      v_soma, v_valor_total USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT (item->>'documento_id')::integer)
    INTO v_documentos
    FROM jsonb_array_elements(p_payload->'linhas') AS item;

  FOREACH v_doc_id IN ARRAY v_documentos LOOP
    PERFORM pg_advisory_xact_lock(87001, v_doc_id);
  END LOOP;

  IF v_cliente_id IS NULL THEN
    IF v_tipo_documento = 'OS' THEN
      SELECT array_agg(DISTINCT o.clienteid) INTO v_clientes
        FROM public.ordemservico o WHERE o.id = ANY (v_documentos);
    ELSE
      SELECT array_agg(DISTINCT v.clienteid) INTO v_clientes
        FROM public.venda v WHERE v.id = ANY (v_documentos);
    END IF;

    IF array_length(v_clientes, 1) = 1 THEN
      v_cliente_id := v_clientes[1];
    END IF;
  END IF;

  IF v_cliente_id IS NOT NULL AND (v_nome IS NULL OR v_cpfcnpj IS NULL) THEN
    SELECT coalesce(v_nome, c.nomerazaosocial), coalesce(v_cpfcnpj, c.cpfcnpj)
      INTO v_nome, v_cpfcnpj
      FROM public.cliente c WHERE c.id = v_cliente_id;
  END IF;

  v_descricao_grupo := coalesce(
    nullif(btrim(p_payload->>'descricao'), ''),
    'Pagamento múltiplo de ' || array_length(v_documentos, 1) || ' documento(s)');

  INSERT INTO public.pagamento_multiplo (
    descricao, modo, tipo_documento, valor_total, data, banco_id, metodopagamento, created_by
  ) VALUES (
    v_descricao_grupo, v_modo, v_tipo_documento, v_valor_total, v_data,
    v_banco_id, v_metodo, v_created_by
  ) RETURNING id INTO v_grupo_id;

  SELECT max((item->>'total_parcelas')::integer) INTO v_total_parcelas
    FROM jsonb_array_elements(p_payload->'linhas') AS item;
  v_total_parcelas := greatest(coalesce(v_total_parcelas, 1), 1);

  FOR v_parcela IN
    SELECT (item->>'parcela')::integer AS numero,
           round(sum((item->>'valor')::numeric), 2) AS valor,
           min(nullif(item->>'vencimento_em', '')) AS vencimento
      FROM jsonb_array_elements(p_payload->'linhas') AS item
     GROUP BY (item->>'parcela')::integer
     ORDER BY 1
  LOOP
    v_indice := v_indice + 1;

    -- O líquido acompanha a proporção do valor. A última parcela leva a sobra
    -- para a soma dos líquidos fechar exatamente com o informado.
    IF v_indice = v_total_parcelas THEN
      v_liquido := round(v_liquido_total - v_liquido_acumulado, 2);
    ELSE
      v_liquido := round(v_parcela.valor * v_liquido_total / v_valor_total, 2);
      v_liquido_acumulado := v_liquido_acumulado + v_liquido;
    END IF;

    v_descricao := v_descricao_grupo;
    IF v_total_parcelas > 1 THEN
      v_descricao := v_descricao || ' - Parcela ' || v_parcela.numero || '/' || v_total_parcelas;
    END IF;

    INSERT INTO public.transacao (
      descricao, valor, "valorLiquido", data, metodopagamento, categoria, categoria_id,
      plano_de_conta_id, centro_custo_id, tipo, cliente_id, banco_id,
      nomepagador, cpfcnpjpagador, pendente, pago_em,
      ordemservicoid, vendaid, pagamento_multiplo_id, created_by
    ) VALUES (
      v_descricao,
      v_parcela.valor,
      greatest(v_liquido, 0),
      coalesce(v_parcela.vencimento::timestamptz, v_data),
      v_metodo, v_categoria, v_categoria_id, v_plano_id, v_centro_id,
      'RECEITA'::public.tipos_transacao, v_cliente_id,
      CASE WHEN v_pendente THEN NULL ELSE v_banco_id END,
      coalesce(v_nome, 'Diversos'),
      coalesce(v_cpfcnpj, 'NÃO INFORMADO'),
      v_pendente,
      CASE WHEN v_pendente THEN NULL ELSE v_data END,
      NULL, NULL,
      v_grupo_id, v_created_by
    ) RETURNING id INTO v_transacao_id;

    INSERT INTO public.pagamento_multiplo_rateio (
      pagamento_multiplo_id, transacao_id, tipo_documento, documento_id, valor
    )
    SELECT v_grupo_id, v_transacao_id, v_tipo_documento,
           (item->>'documento_id')::integer,
           round((item->>'valor')::numeric, 2)
      FROM jsonb_array_elements(p_payload->'linhas') AS item
     WHERE (item->>'parcela')::integer = v_parcela.numero
       AND round((item->>'valor')::numeric, 2) > 0;
  END LOOP;

  FOREACH v_doc_id IN ARRAY v_documentos LOOP
    IF v_tipo_documento = 'OS' THEN
      SELECT r.total_devido, r.valor_comprometido
        INTO v_devido, v_comprometido
        FROM public.resumo_financeiro_os(v_doc_id) r;
    ELSE
      SELECT round(
               greatest(coalesce(v.valortotal, 0), 0) +
               CASE
                 WHEN v.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
                   greatest(coalesce(v.valortotal, 0), 0) *
                   least(greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0), 100) / 100
                 WHEN v.acrescimo_financeiro_tipo = 'FIXO' THEN
                   greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0)
                 ELSE 0
               END, 2)
        INTO v_devido
        FROM public.venda v WHERE v.id = v_doc_id;

      SELECT coalesce(round(sum(r.valor), 2), 0) INTO v_comprometido
        FROM public.recebimento_por_documento r
       WHERE r.tipo_documento = 'VENDA' AND r.documento_id = v_doc_id;
    END IF;

    IF coalesce(v_devido, 0) <= 0 THEN
      RAISE EXCEPTION 'O documento #% não possui valor financeiro disponível para pagamento.',
        v_doc_id USING ERRCODE = '23514';
    END IF;
    IF round(coalesce(v_comprometido, 0), 2) > v_devido THEN
      RAISE EXCEPTION 'O rateio ultrapassa o saldo do documento #%: comprometido % de %.',
        v_doc_id, v_comprometido, v_devido USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN v_grupo_id;
END;
$function$;

ALTER FUNCTION public.registrar_pagamento_multiplo(jsonb) OWNER TO postgres;

-- ------------------------------------------------------ 3: exclusão da venda
CREATE OR REPLACE FUNCTION public.tg_barrar_exclusao_venda_em_grupo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_grupos text;
BEGIN
  SELECT string_agg(DISTINCT '#' || r.pagamento_multiplo_id, ', ')
    INTO v_grupos
    FROM public.pagamento_multiplo_rateio r
    JOIN public.transacao t ON t.id = r.transacao_id AND t.is_deleted = false
   WHERE r.tipo_documento = 'VENDA' AND r.documento_id = old.id;

  IF v_grupos IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta venda foi paga em pagamento múltiplo %. Exclua o pagamento pelo financeiro antes de excluir a venda.',
      v_grupos USING ERRCODE = 'P0001';
  END IF;

  RETURN old;
END;
$function$;

DROP TRIGGER IF EXISTS trg_barrar_exclusao_venda_em_grupo ON public.venda;
CREATE TRIGGER trg_barrar_exclusao_venda_em_grupo
BEFORE DELETE ON public.venda
FOR EACH ROW EXECUTE FUNCTION public.tg_barrar_exclusao_venda_em_grupo();

-- Revalida as vendas com a regra nova.
DO $revalidar$
DECLARE v_id integer;
BEGIN
  FOR v_id IN SELECT id FROM public.venda WHERE status::text <> 'CANCELADA' LOOP
    PERFORM public.recalcular_status_financeiro_venda(v_id);
  END LOOP;
END
$revalidar$;

COMMIT;
