-- Um boleto so que quita despesas de OS diferentes.
--
-- O terceirizado que cobra num boleto unico os servicos que fez em tres carros
-- nao respeita a fronteira da OS, e ate aqui o lancamento em grupo respeitava:
-- `lancamento_de_eventos.ordemservicoid` era NOT NULL e a RPC recusava qualquer
-- despesa de outra ordem. Quem pagava esse boleto precisava inventar tres
-- lancamentos com valores partidos a mao.
--
-- O que muda: `ordemservicoid` do grupo passa a aceitar NULL, e NULL significa
-- "atravessa OSs". As ordens envolvidas sao derivadas dos eventos que apontam
-- para o grupo — mesma escolha que ja dispensou `valor_total` aqui: dois numeros
-- para manter em sincronia, quando a resposta certa e sempre reler as linhas.
--
-- O caminho de OS unica grava exatamente o que gravava antes, incluindo
-- `transacao.ordemservicoid`. Nao ha backfill: toda linha existente tem uma OS
-- so e continua por ali.
--
-- CUIDADO QUE ESTA MIGRATION PRECISA TER
-- 1. Com varias OSs, as parcelas nascem com `ordemservicoid` NULO — nao existe
--    como atribuir a parcela de um boleto a uma ordem. Isso tira das parcelas a
--    primeira condicao da lista de exclusao de `sincronizar_eventos_financeiros_
--    transacao`... exceto que `lancamento_id` continua preenchido, e ele esta na
--    mesma lista desde 20260825140000 justamente como protecao redundante. E ela
--    que impede a DRE de contar o custo DUAS VEZES aqui.
-- 2. A Guarda 2 de `excluir_lancamento_de_eventos` lia `v_grupo.ordemservicoid`,
--    que agora pode ser NULO. Sem trocar a leitura pelas OSs dos eventos, um
--    lancamento multi-OS passaria pela guarda sem checar OS nenhuma e desfaria
--    despesa de ordem ja concluida.

BEGIN;

-- ------------------------------------------------------------------ o grupo
ALTER TABLE public.lancamento_de_eventos
  ALTER COLUMN ordemservicoid DROP NOT NULL;

COMMENT ON COLUMN public.lancamento_de_eventos.ordemservicoid IS
  'A OS do lancamento quando ele tem uma so. NULO quando o boleto atravessa OSs: nesse caso as ordens sao as dos eventos_financeiros que apontam para este grupo. Preenchido e o caso comum e o unico que existia antes de 20260904120000.';

COMMENT ON TABLE public.lancamento_de_eventos IS
  'Um lancamento de despesas de OS no financeiro. As parcelas sao as transacoes com este lancamento_id; as despesas quitadas sao os eventos_financeiros com este lancamento_id. Existe para expressar o que as FKs escalares nao expressam: N despesas pagas por P parcelas de um boleto so — e, desde 20260904120000, despesas de OSs diferentes no mesmo boleto (ordemservicoid NULO).';

-- ------------------------------------------------------------- registrar
-- Identica a versao de 20260825140000, com tres mudancas: a OS do payload virou
-- opcional, as OSs sao derivadas dos eventos, e a OS efetiva (grupo e parcelas)
-- so existe quando ha uma so.
CREATE OR REPLACE FUNCTION public.registrar_lancamento_de_eventos(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_os_id integer := nullif(p_payload->>'ordemservicoid', '')::integer;
  v_created_by uuid := nullif(p_payload->>'created_by', '')::uuid;
  v_pendente boolean := coalesce((p_payload->>'pendente')::boolean, true);
  v_data timestamptz := coalesce(nullif(p_payload->>'data', '')::timestamptz, now());
  v_metodo public.metodo_pagamento := nullif(p_payload->>'metodopagamento', '')::public.metodo_pagamento;
  v_categoria text := coalesce(nullif(p_payload->>'categoria', ''), 'NAO RELACIONADO');
  v_categoria_id integer := nullif(p_payload->>'categoria_id', '')::integer;
  v_plano_id integer := nullif(p_payload->>'plano_de_conta_id', '')::integer;
  v_centro_id integer := nullif(p_payload->>'centro_custo_id', '')::integer;
  v_fornecedor_id integer := nullif(p_payload->>'fornecedor_id', '')::integer;
  v_banco_id bigint := nullif(p_payload->>'banco_id', '')::bigint;
  v_nome text := coalesce(nullif(btrim(p_payload->>'nomepagador'), ''), 'Despesa interna');
  v_cpfcnpj text := coalesce(nullif(btrim(p_payload->>'cpfcnpjpagador'), ''), 'NAO INFORMADO');
  v_ids bigint[];
  v_os_ids integer[];
  v_qtd_os integer;
  v_os_efetiva integer;
  v_qtd integer;
  v_soma_eventos numeric(14,2);
  v_soma_linhas numeric(14,2);
  v_maus text;
  v_grupo_id bigint;
  v_descricao_grupo text;
  v_descricao text;
  v_total_parcelas integer;
  v_parcela record;
BEGIN
  IF jsonb_typeof(p_payload->'eventos_ids') <> 'array'
     OR jsonb_array_length(p_payload->'eventos_ids') = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma despesa para lancar.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_payload->'linhas') <> 'array'
     OR jsonb_array_length(p_payload->'linhas') = 0 THEN
    RAISE EXCEPTION 'Informe as parcelas do lancamento.' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT item::text::bigint)
    INTO v_ids
    FROM jsonb_array_elements(p_payload->'eventos_ids') AS item;

  -- Trava todas as despesas ate o fim desta transacao: duas telas lancando
  -- grupos que dividem uma despesa serializam aqui, e a segunda encontra o
  -- vinculo ja preenchido.
  PERFORM 1 FROM public.eventos_financeiros WHERE id = ANY (v_ids) FOR UPDATE;

  SELECT count(*), round(coalesce(sum(e.valor), 0), 2)
    INTO v_qtd, v_soma_eventos
    FROM public.eventos_financeiros e WHERE e.id = ANY (v_ids);

  IF v_qtd <> coalesce(array_length(v_ids, 1), 0) THEN
    RAISE EXCEPTION 'Uma ou mais despesas selecionadas nao existem mais.' USING ERRCODE = 'P0002';
  END IF;

  SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
    FROM public.eventos_financeiros e
   WHERE e.id = ANY (v_ids)
     AND (e.status <> 'ATIVO' OR e.transacaoid IS NOT NULL OR e.lancamento_id IS NOT NULL);
  IF v_maus IS NOT NULL THEN
    RAISE EXCEPTION 'Despesa(s) % ja foi(ram) lancada(s) no financeiro ou cancelada(s).', v_maus
      USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
    FROM public.eventos_financeiros e
   WHERE e.id = ANY (v_ids) AND NOT e.pode_gerar_transacao;
  IF v_maus IS NOT NULL THEN
    RAISE EXCEPTION 'Despesa(s) % e(sao) lancamento(s) automatico(s) e nao gera(m) transacao.', v_maus
      USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
    FROM public.eventos_financeiros e
   WHERE e.id = ANY (v_ids) AND e.natureza <> 'DESPESA';
  IF v_maus IS NOT NULL THEN
    RAISE EXCEPTION 'Lancamento(s) % nao e(sao) despesa.', v_maus USING ERRCODE = 'P0001';
  END IF;

  -- Evento sem OS existe (entrada fiscal, transacao avulsa) e nao pertence a
  -- este caminho: o grupo e o boleto de despesas de ordem de servico.
  SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
    FROM public.eventos_financeiros e
   WHERE e.id = ANY (v_ids) AND e.ordemservicoid IS NULL;
  IF v_maus IS NOT NULL THEN
    RAISE EXCEPTION 'Despesa(s) % nao pertence(m) a nenhuma ordem de servico.', v_maus
      USING ERRCODE = 'P0001';
  END IF;

  -- Quem informa a OS continua preso a ela. E o caminho do painel da propria OS,
  -- que sabe de qual ordem esta falando; afrouxar ali so esconderia um engano.
  IF v_os_id IS NOT NULL THEN
    SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
      FROM public.eventos_financeiros e
     WHERE e.id = ANY (v_ids) AND e.ordemservicoid IS DISTINCT FROM v_os_id;
    IF v_maus IS NOT NULL THEN
      RAISE EXCEPTION 'Despesa(s) % nao pertence(m) a esta OS.', v_maus USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT array_agg(DISTINCT e.ordemservicoid)
    INTO v_os_ids
    FROM public.eventos_financeiros e WHERE e.id = ANY (v_ids);

  v_qtd_os := coalesce(array_length(v_os_ids, 1), 0);
  -- Uma OS so: grupo e parcelas ficam carimbados com ela, como sempre foram.
  -- Varias: nao ha resposta unica, e inventar uma seria pior que a ausencia.
  v_os_efetiva := CASE WHEN v_qtd_os = 1 THEN v_os_ids[1] ELSE NULL END;

  SELECT round(coalesce(sum((item->>'valor')::numeric), 0), 2)
    INTO v_soma_linhas
    FROM jsonb_array_elements(p_payload->'linhas') AS item;

  IF v_soma_linhas <> v_soma_eventos THEN
    RAISE EXCEPTION 'A soma das parcelas (%) difere da soma das despesas selecionadas (%).',
      v_soma_linhas, v_soma_eventos USING ERRCODE = 'P0001';
  END IF;

  v_descricao_grupo := coalesce(
    nullif(btrim(p_payload->>'descricao'), ''),
    CASE WHEN v_os_efetiva IS NOT NULL
      THEN 'Despesas da OS #' || v_os_efetiva
      ELSE 'Despesas de ' || v_qtd_os || ' OS'
    END);

  INSERT INTO public.lancamento_de_eventos (ordemservicoid, descricao, created_by)
  VALUES (v_os_efetiva, v_descricao_grupo, v_created_by)
  RETURNING id INTO v_grupo_id;

  SELECT max((item->>'total_parcelas')::integer) INTO v_total_parcelas
    FROM jsonb_array_elements(p_payload->'linhas') AS item;
  v_total_parcelas := greatest(coalesce(v_total_parcelas, 1), 1);

  FOR v_parcela IN
    SELECT (item->>'parcela')::integer AS numero,
           round((item->>'valor')::numeric, 2) AS valor,
           round(coalesce((item->>'valor_liquido')::numeric,
                          (item->>'valor')::numeric), 2) AS valor_liquido,
           nullif(item->>'vencimento_em', '') AS vencimento
      FROM jsonb_array_elements(p_payload->'linhas') AS item
     ORDER BY 1
  LOOP
    v_descricao := v_descricao_grupo;
    IF v_total_parcelas > 1 THEN
      v_descricao := v_descricao || ' - Parcela ' || v_parcela.numero || '/' || v_total_parcelas;
    END IF;

    INSERT INTO public.transacao (
      descricao, valor, "valorLiquido", data, vencimento_em, metodopagamento,
      categoria, categoria_id, plano_de_conta_id, centro_custo_id, tipo,
      fornecedor_id, banco_id, nomepagador, cpfcnpjpagador, pendente, pago_em,
      ordemservicoid, lancamento_id, created_by, baixado_por
    ) VALUES (
      v_descricao,
      v_parcela.valor,
      v_parcela.valor_liquido,
      coalesce(v_parcela.vencimento::timestamptz, v_data),
      v_parcela.vencimento::timestamptz,
      v_metodo, v_categoria, v_categoria_id, v_plano_id, v_centro_id,
      'DESPESA'::public.tipos_transacao,
      v_fornecedor_id,
      CASE WHEN v_pendente THEN NULL ELSE v_banco_id END,
      v_nome, v_cpfcnpj,
      v_pendente,
      CASE WHEN v_pendente THEN NULL ELSE v_data END,
      v_os_efetiva, v_grupo_id, v_created_by,
      CASE WHEN v_pendente THEN NULL ELSE v_created_by END
    );
  END LOOP;

  UPDATE public.eventos_financeiros
     SET status = 'CONVERTIDO', lancamento_id = v_grupo_id, updated_at = now()
   WHERE id = ANY (v_ids);

  RETURN v_grupo_id;
END;
$function$;

ALTER FUNCTION public.registrar_lancamento_de_eventos(jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.registrar_lancamento_de_eventos(jsonb) IS
  'Persiste um lancamento de despesas de OS: o grupo, as P parcelas e a conversao das N despesas, numa transacao so. A OS do payload e opcional — quando vem, todas as despesas precisam ser dela; quando nao vem, as ordens saem dos proprios eventos e o grupo fica sem ordemservicoid se houver mais de uma.';

-- --------------------------------------------------------------- excluir
-- Identica a versao de 20260825140000, com a Guarda 2 lendo as OSs dos eventos
-- em vez do carimbo do grupo — que agora pode ser nulo.
CREATE OR REPLACE FUNCTION public.excluir_lancamento_de_eventos(
  p_id bigint,
  p_deleted_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_grupo public.lancamento_de_eventos%ROWTYPE;
  v_os_finalizadas text;
  v_os_ids integer[];
  v_baixadas integer;
  v_parcelas integer;
  v_despesas integer;
BEGIN
  SELECT * INTO v_grupo FROM public.lancamento_de_eventos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lancamento #% nao encontrado.', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Guarda 1: dinheiro que ja saiu. A exclusao apaga o titulo, nao a baixa: o
  -- saldo do banco subiria sozinho, sem que nada tenha acontecido no mundo.
  -- Mesma razao da trava individual do DELETE de transacao, mas valendo para o
  -- grupo — com uma parcela paga, nem as pendentes saem.
  SELECT count(*) INTO v_baixadas
    FROM public.transacao t
   WHERE t.lancamento_id = p_id AND t.is_deleted = false AND t.pendente = false;

  IF v_baixadas > 0 THEN
    RAISE EXCEPTION
      'Este lancamento tem % parcela(s) ja paga(s). Tire a baixa do fluxo de caixa antes de excluir.',
      v_baixadas USING ERRCODE = 'P0001';
  END IF;

  -- As ordens saem dos eventos, e nao do carimbo do grupo: num lancamento
  -- multi-OS ele e nulo, e ler dali passaria batido por todas elas. Precisa vir
  -- antes do UPDATE que solta o vinculo, senao nao ha mais o que ler.
  SELECT array_agg(DISTINCT e.ordemservicoid)
    INTO v_os_ids
    FROM public.eventos_financeiros e
   WHERE e.lancamento_id = p_id AND e.ordemservicoid IS NOT NULL;

  -- Guarda 2: OS finalizada. Mesmo conjunto de status que
  -- tg_reconciliar_eventos_ao_finalizar_os trata como fim de linha.
  SELECT string_agg(o.id::text, ', ' ORDER BY o.id) INTO v_os_finalizadas
    FROM public.ordemservico o
   WHERE o.id = ANY (coalesce(v_os_ids, ARRAY[]::integer[]))
     AND o.status::text IN ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO');

  IF v_os_finalizadas IS NOT NULL THEN
    RAISE EXCEPTION
      'A(s) OS #% ja foi(ram) finalizada(s). Reabra a OS para desfazer este lancamento.',
      v_os_finalizadas USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_parcelas
    FROM public.transacao t WHERE t.lancamento_id = p_id;

  -- As despesas voltam a prevista ANTES de o grupo sumir. A FK e ON DELETE SET
  -- NULL, entao o vinculo cairia sozinho — mas o status nao, e uma despesa
  -- CONVERTIDO sem vinculo nenhum seria uma despesa presa para sempre.
  UPDATE public.eventos_financeiros
     SET status = 'ATIVO', lancamento_id = NULL, updated_at = now()
   WHERE lancamento_id = p_id;

  GET DIAGNOSTICS v_despesas = ROW_COUNT;

  -- As parcelas caem por CASCADE.
  DELETE FROM public.lancamento_de_eventos WHERE id = p_id;

  RETURN jsonb_build_object(
    'id', p_id,
    'ordemservicoid', v_grupo.ordemservicoid,
    'ordemservicoids', to_jsonb(coalesce(v_os_ids, ARRAY[]::integer[])),
    'parcelas_removidas', v_parcelas,
    'despesas_revertidas', v_despesas
  );
END;
$function$;

ALTER FUNCTION public.excluir_lancamento_de_eventos(bigint, uuid) OWNER TO postgres;

COMMIT;
