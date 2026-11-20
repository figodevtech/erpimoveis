-- Exclusão definitiva da reserva, com tudo o que ela movimentou.
--
-- Pedida na lista de reservas (reservas:excluir). Depende de 20261119160000 (imovel_servico).
--
-- imob_excluir_reserva(p_id, p_actor, p_executar, p_confirmar_valores):
--   p_executar=false  só devolve o impacto, para o aviso: cobranças em aberto, o que foi recebido
--                     do hóspede, despesas e repasses, lançamentos e extrato do proprietário,
--                     eventos da DRE, consumo de estoque, conciliações bancárias, arquivos e
--                     serviços; e os bloqueios.
--   p_executar=true   apaga, numa transação só:
--     - consumo de estoque: a saída é cancelada e o item volta ao estoque;
--     - o extrato do proprietário da reserva, dos lançamentos dela e das transações dela. É a
--       exceção à regra de que o extrato é histórico, e só vale para as linhas que esta função
--       marca (app.imob_excluir_movimentos); a auditoria guarda cada linha apagada;
--     - as transações (cobranças, recebimentos e baixas, repasses, despesas, custos): os gatilhos
--       de sempre desfazem a conciliação bancária e os eventos da DRE de cada uma;
--     - os grupos de lançamento dos custos, os eventos financeiros da reserva (receita, custos,
--       taxa de administração, consumo) e os lançamentos do proprietário;
--     - os serviços (limpeza), a ocupação do calendário, os arquivos (o storage é limpo pela
--       API, com a lista devolvida aqui) e a reserva.
--
-- Recusa quando algum valor da reserva está numa NFS-e, foi pago ou devolvido com crédito do
-- cliente, está num pagamento múltiplo, está num grupo de lançamento com custos de fora da
-- reserva ou é referência de uma transação de fora dela (antecipação ou estorno). Com dinheiro
-- recebido ou pago, ou com extrato do proprietário, exige p_confirmar_valores.
--
-- imob_movimento_imutavel: igual a 20261113130000, com a exceção da exclusão da reserva.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- --------------------------------------------------------------------------- extrato
CREATE OR REPLACE FUNCTION public.imob_movimento_imutavel() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(new)-'nfse_id'-'transacao_id')=(to_jsonb(old)-'nfse_id'-'transacao_id') AND (new.transacao_id=old.transacao_id OR new.transacao_id IS NULL) THEN RETURN new; END IF;
 IF TG_OP='UPDATE' AND public.imob_correcao_proprietario_ativa(old.imovel_id)
    AND (to_jsonb(new)-'proprietario_id')=(to_jsonb(old)-'proprietario_id') THEN RETURN new; END IF;
 -- Exclusão definitiva da reserva (imob_excluir_reserva): só as linhas que ela marcou nesta transação.
 IF TG_OP='DELETE' AND old.id::text = ANY(string_to_array(nullif(current_setting('app.imob_excluir_movimentos', true), ''), ',')) THEN
  RETURN old;
 END IF;
 RAISE EXCEPTION 'Movimentos imobiliários são históricos; registre estorno pelo financeiro.' USING ERRCODE='23514';
END $$;

-- --------------------------------------------------------------------------- exclusão da reserva
CREATE OR REPLACE FUNCTION public.imob_excluir_reserva(p_id bigint, p_actor uuid, p_executar boolean DEFAULT false, p_confirmar_valores boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  r public.reserva_imovel%ROWTYPE;
  v_actor uuid;
  v_lanc bigint[]; v_grupos bigint[]; v_tx bigint[]; v_eventos bigint[]; v_mov bigint[];
  v_bloqueios text[] := '{}';
  v_nfse text;
  v_movimentou boolean;
  v_itens jsonb;
  v_arquivos jsonb;
  e record;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Excluir reserva é exclusivo do ERP.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.reserva_imovel WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.' USING ERRCODE = 'P0002'; END IF;

  -- O que é da reserva: lançamentos do proprietário, grupos de custo, transações (com as baixas
  -- parciais), eventos financeiros e extrato.
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_lanc FROM public.imovel_lancamento WHERE reserva_id = p_id;
  SELECT coalesce(array_agg(DISTINCT lancamento_id), '{}') INTO v_grupos FROM public.eventos_financeiros
   WHERE source_type = 'RESERVA' AND source_id = p_id AND lancamento_id IS NOT NULL;
  WITH RECURSIVE t(id) AS (
    SELECT x.id FROM public.transacao x
     WHERE x.reserva_imovel_id = p_id OR x.imovel_lancamento_contabil_id = ANY(v_lanc) OR x.lancamento_id = ANY(v_grupos)
        OR x.id IN (SELECT transacao_id FROM public.imovel_lancamento WHERE id = ANY(v_lanc) AND transacao_id IS NOT NULL)
    UNION
    SELECT x.id FROM public.transacao x JOIN t ON x.baixa_de_transacao_id = t.id
  )
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tx FROM t;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_eventos FROM public.eventos_financeiros
   WHERE (source_type = 'RESERVA' AND source_id = p_id)
      OR (source_type = 'IMOVEL_TAXA' AND (source_id = ANY(v_tx) OR dados_snapshot->>'reserva_id' = p_id::text))
      OR (source_type = 'TRANSACAO' AND source_id = ANY(v_tx));
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_mov FROM public.imovel_movimento
   WHERE reserva_id = p_id OR lancamento_id = ANY(v_lanc) OR transacao_chave = ANY(v_tx) OR transacao_id = ANY(v_tx);

  -- Bloqueios: o que não pode sumir junto com a reserva.
  SELECT string_agg(DISTINCT coalesce(nullif(n.referencia, ''), '#' || n.id) || ' (' || coalesce(n.status::text, 'sem situação') || ')', ', ')
    INTO v_nfse
    FROM public.imovel_nfse_origem o JOIN public.nfse n ON n.id = o.nfse_id
   WHERE o.transacao_id = ANY(v_tx) OR o.movimento_id = ANY(v_mov);
  IF v_nfse IS NOT NULL THEN
    v_bloqueios := v_bloqueios || ('Valores desta reserva estão em nota fiscal de serviço (' || v_nfse || '). A nota não pode sumir junto: trate-a no Fiscal antes.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.cliente_saldo_movimento WHERE transacao_id = ANY(v_tx)) THEN
    v_bloqueios := v_bloqueios || 'Parte do valor foi paga ou devolvida com crédito do cliente. Desfaça esse uso do crédito no Financeiro antes.'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pagamento_multiplo_rateio WHERE transacao_id = ANY(v_tx)) THEN
    v_bloqueios := v_bloqueios || 'Um pagamento desta reserva entrou num pagamento múltiplo. Desfaça o pagamento múltiplo no Financeiro antes.'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.eventos_financeiros WHERE lancamento_id = ANY(v_grupos) AND NOT (id = ANY(v_eventos))) THEN
    v_bloqueios := v_bloqueios || 'Um lançamento de custos desta reserva também tem custos de fora dela. Desfaça esse lançamento no Financeiro antes.'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.transacao WHERE NOT (id = ANY(v_tx)) AND (adiantamento_id = ANY(v_tx) OR estorno_transacao_id = ANY(v_tx)))
     OR EXISTS (SELECT 1 FROM public.transacao WHERE id = ANY(v_tx)
                 AND ((adiantamento_id IS NOT NULL AND NOT (adiantamento_id = ANY(v_tx)))
                   OR (estorno_transacao_id IS NOT NULL AND NOT (estorno_transacao_id = ANY(v_tx))))) THEN
    v_bloqueios := v_bloqueios || 'Uma transação desta reserva está ligada a outra de fora dela (antecipação ou estorno). Desfaça esse vínculo no Financeiro antes.'::text;
  END IF;

  -- O que sai: os valores que o aviso mostra.
  SELECT jsonb_build_object(
    'a_receber', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(valor - coalesce(valor_baixado, 0)), 0))
                    FROM public.transacao WHERE id = ANY(v_tx) AND NOT is_deleted AND baixa_de_transacao_id IS NULL
                     AND tipo::text = 'RECEITA' AND pendente AND coalesce(imovel_natureza, '') <> 'REEMBOLSO'),
    'recebido', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(coalesce(nullif("valorLiquido", 0), valor)), 0))
                    FROM public.transacao WHERE id = ANY(v_tx) AND NOT is_deleted AND tipo::text = 'RECEITA' AND NOT pendente),
    'a_pagar', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(valor - coalesce(valor_baixado, 0)), 0))
                    FROM public.transacao WHERE id = ANY(v_tx) AND NOT is_deleted AND baixa_de_transacao_id IS NULL
                     AND tipo::text <> 'RECEITA' AND pendente),
    'pago', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(coalesce(nullif("valorLiquido", 0), valor)), 0))
                    FROM public.transacao WHERE id = ANY(v_tx) AND NOT is_deleted AND tipo::text <> 'RECEITA' AND NOT pendente),
    'lancamentos_proprietario', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(valor), 0))
                    FROM public.imovel_lancamento WHERE id = ANY(v_lanc) AND cancelado_em IS NULL),
    'extrato', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(abs(valor)), 0))
                    FROM public.imovel_movimento WHERE id = ANY(v_mov)),
    'eventos_dre', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(valor), 0))
                    FROM public.eventos_financeiros WHERE id = ANY(v_eventos) AND status <> 'CANCELADO'),
    'consumo', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(valor), 0))
                    FROM public.eventos_financeiros WHERE id = ANY(v_eventos) AND origem = 'CONSUMO' AND status <> 'CANCELADO'),
    'conciliacoes', (SELECT jsonb_build_object('quantidade', count(*))
                    FROM public.ofx_movimento WHERE transacao_id = ANY(v_tx) OR titulo_origem_id = ANY(v_tx)),
    'transacoes', jsonb_build_object('quantidade', cardinality(v_tx)),
    'servicos', (SELECT jsonb_build_object('quantidade', count(*)) FROM public.imovel_servico WHERE reserva_id = p_id),
    'arquivos', (SELECT jsonb_build_object('quantidade', count(*)) FROM public.imovel_arquivo WHERE reserva_id = p_id)
  ) INTO v_itens;

  -- Dinheiro que entrou ou saiu, ou extrato do proprietário: pede a confirmação dos valores.
  v_movimentou := cardinality(v_mov) > 0
    OR EXISTS (SELECT 1 FROM public.transacao WHERE id = ANY(v_tx) AND NOT is_deleted AND (NOT pendente OR coalesce(valor_baixado, 0) > 0));

  IF NOT p_executar THEN
    RETURN jsonb_build_object(
      'excluido', false,
      'reserva', jsonb_build_object('id', r.id, 'status', r.status, 'inicio', r.inicio, 'fim', r.fim, 'valor_total', r.valor_total),
      'bloqueios', to_jsonb(v_bloqueios),
      'movimentou', v_movimentou,
      'itens', v_itens);
  END IF;

  IF cardinality(v_bloqueios) > 0 THEN RAISE EXCEPTION '%', v_bloqueios[1] USING ERRCODE = 'P0001'; END IF;
  IF v_movimentou AND NOT coalesce(p_confirmar_valores, false) THEN
    RAISE EXCEPTION 'Esta reserva tem valores recebidos, pagos ou no extrato do proprietário. Confirme que eles serão apagados.' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Consumo de estoque: a saída é cancelada e o item volta ao estoque (como ao excluir o consumo).
  FOR e IN SELECT id, consumo_saida_id, consumo_usoconsumo_saida_id FROM public.eventos_financeiros
            WHERE id = ANY(v_eventos) AND origem = 'CONSUMO' AND status <> 'CANCELADO' LOOP
    PERFORM set_config('app.consumo_reserva_estorno', 'permitido', true);
    IF e.consumo_saida_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.estoque_saida WHERE id = e.consumo_saida_id AND status <> 'CANCELADA') THEN
      PERFORM public.cancelar_saida_estoque(e.consumo_saida_id, 'Exclusão da reserva #' || p_id, v_actor);
    ELSIF e.consumo_usoconsumo_saida_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.usoconsumo_saida WHERE id = e.consumo_usoconsumo_saida_id AND status <> 'CANCELADA') THEN
      PERFORM public.cancelar_saida_usoconsumo(e.consumo_usoconsumo_saida_id, 'Exclusão da reserva #' || p_id, v_actor);
    END IF;
    PERFORM set_config('app.consumo_reserva_estorno', '', true);
  END LOOP;

  -- 2) Extrato do proprietário: antes das transações, para os gatilhos delas não gravarem estornos.
  PERFORM set_config('app.imob_excluir_movimentos', array_to_string(v_mov, ','), true);
  DELETE FROM public.imovel_movimento WHERE id = ANY(v_mov);

  -- 3) Transações: primeiro as que apontam para outras da reserva (baixas, antecipação, estorno).
  DELETE FROM public.transacao WHERE id = ANY(v_tx) AND baixa_de_transacao_id IS NOT NULL;
  DELETE FROM public.transacao WHERE id = ANY(v_tx) AND (adiantamento_id IS NOT NULL OR estorno_transacao_id IS NOT NULL);
  DELETE FROM public.transacao WHERE id = ANY(v_tx);

  -- Algum gatilho das transações pode ter gravado estorno no extrato: sai também.
  SELECT coalesce(array_agg(id), '{}') INTO v_mov FROM public.imovel_movimento
   WHERE reserva_id = p_id OR lancamento_id = ANY(v_lanc) OR transacao_chave = ANY(v_tx);
  IF cardinality(v_mov) > 0 THEN
    PERFORM set_config('app.imob_excluir_movimentos', array_to_string(v_mov, ','), true);
    DELETE FROM public.imovel_movimento WHERE id = ANY(v_mov);
  END IF;
  PERFORM set_config('app.imob_excluir_movimentos', '', true);

  -- 4) Grupos de custo, eventos da reserva (também os que os gatilhos acabaram de recriar) e lançamentos.
  DELETE FROM public.lancamento_de_eventos WHERE id = ANY(v_grupos);
  DELETE FROM public.eventos_financeiros
   WHERE id = ANY(v_eventos)
      OR (source_type = 'RESERVA' AND source_id = p_id)
      OR (source_type = 'IMOVEL_TAXA' AND (source_id = ANY(v_tx) OR dados_snapshot->>'reserva_id' = p_id::text))
      OR (source_type = 'TRANSACAO' AND source_id = ANY(v_tx));
  DELETE FROM public.imovel_lancamento WHERE id = ANY(v_lanc);

  -- 5) Serviços, calendário, arquivos e a reserva.
  DELETE FROM public.imovel_servico WHERE reserva_id = p_id;
  DELETE FROM public.imovel_ocupacao WHERE reserva_id = p_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'path', path)), '[]'::jsonb) INTO v_arquivos
    FROM public.imovel_arquivo WHERE reserva_id = p_id;
  DELETE FROM public.imovel_arquivo WHERE reserva_id = p_id;
  DELETE FROM public.reserva_imovel WHERE id = p_id;

  RETURN jsonb_build_object('excluido', true, 'reserva_id', p_id, 'itens', v_itens, 'arquivos', v_arquivos);
END $$;

REVOKE ALL ON FUNCTION public.imob_excluir_reserva(bigint, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_excluir_reserva(bigint, uuid, boolean, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
