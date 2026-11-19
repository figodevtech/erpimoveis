-- Troca do proprietário de um imóvel levando junto o que pertence a ele.
--
-- Até aqui a edição do imóvel só trocava imovel.proprietario_id: reservas, locações, cobranças
-- e extrato continuavam no dono anterior, e um pagamento futuro de uma reserva já transferida
-- ia para o extrato (e o repasse) do dono errado. Agora a troca passa por imob_trocar_proprietario,
-- com o motivo informado no ERP:
--
--   TRANSFERENCIA  o imóvel mudou de dono. Vai para o novo dono o que ainda vai acontecer:
--                  reservas confirmadas/em andamento, locações ativas, as cobranças delas ainda
--                  não pagas e os arquivos delas. O que já foi recebido, taxado ou repassado
--                  fica com quem recebeu (o extrato de cada um continua batendo com o dinheiro).
--   CORRECAO       o cadastro estava errado. Tudo do imóvel passa para o novo dono, inclusive o
--                  histórico (reservas concluídas, extrato, lançamentos e transações já pagas),
--                  como se ele sempre tivesse sido o dono. Pode ser usada com o mesmo dono atual
--                  para recolher o que ficou ligado a outro. Ficam de fora a venda do imóvel
--                  (o vendedor é fato da venda) e as notas fiscais emitidas (documento fiscal).
--
-- O extrato (imovel_movimento) e os vínculos de transação recebida são imutáveis por gatilho.
-- A correção abre uma exceção estreita: só dentro desta função (configuração local da
-- transação, com o id do imóvel) e só quando a única coluna alterada é o proprietário.
BEGIN;

CREATE OR REPLACE FUNCTION public.imob_correcao_proprietario_ativa(p_imovel_id bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT p_imovel_id IS NOT NULL
     AND coalesce(current_setting('app.imob_correcao_proprietario', true), '') = p_imovel_id::text
$$;

-- Extrato: além da exceção de sempre (nfse/transacao), aceita trocar só o proprietário na correção.
CREATE OR REPLACE FUNCTION public.imob_movimento_imutavel() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(new)-'nfse_id'-'transacao_id')=(to_jsonb(old)-'nfse_id'-'transacao_id') AND (new.transacao_id=old.transacao_id OR new.transacao_id IS NULL) THEN RETURN new; END IF;
 IF TG_OP='UPDATE' AND public.imob_correcao_proprietario_ativa(old.imovel_id)
    AND (to_jsonb(new)-'proprietario_id')=(to_jsonb(old)-'proprietario_id') THEN RETURN new; END IF;
 RAISE EXCEPTION 'Movimentos imobiliários são históricos; registre estorno pelo financeiro.' USING ERRCODE='23514';
END $$;

-- Transação: mesma função de 20261108130000; a trava de vínculos aceita a troca só do proprietário na correção.
CREATE OR REPLACE FUNCTION public.imob_preparar_transacao() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p public.transacao%ROWTYPE;
BEGIN
 IF new.baixa_de_transacao_id IS NOT NULL THEN
  SELECT * INTO p FROM public.transacao WHERE id=new.baixa_de_transacao_id;
  IF p.imovel_id IS NOT NULL THEN
   new.imovel_id:=p.imovel_id; new.proprietario_id:=p.proprietario_id; new.reserva_imovel_id:=p.reserva_imovel_id;
   new.locacao_imovel_id:=p.locacao_imovel_id; new.venda_imovel_id:=p.venda_imovel_id;
   new.recurso_terceiros:=p.recurso_terceiros; new.imovel_percentual_admin:=p.imovel_percentual_admin;
   new.imovel_natureza:=p.imovel_natureza; new.imovel_competencia:=p.imovel_competencia;
  END IF;
 END IF;
 IF new.imovel_id IS NOT NULL AND (new.proprietario_id IS NULL OR new.imovel_natureza IS NULL) THEN RAISE EXCEPTION 'Transação imobiliária exige proprietário e natureza.'; END IF;
 IF new.imovel_natureza IN ('RECEBIMENTO','DESPESA_PROPRIETARIO','REPASSE','REEMBOLSO') AND NOT new.recurso_terceiros THEN RAISE EXCEPTION 'Recursos do proprietário devem ser segregados do resultado.'; END IF;
 IF TG_OP='UPDATE' AND old.imovel_id IS NOT NULL AND (new.imovel_id,new.proprietario_id,new.reserva_imovel_id,new.locacao_imovel_id,new.venda_imovel_id,new.imovel_percentual_admin,new.imovel_natureza,new.recurso_terceiros) IS DISTINCT FROM (old.imovel_id,old.proprietario_id,old.reserva_imovel_id,old.locacao_imovel_id,old.venda_imovel_id,old.imovel_percentual_admin,old.imovel_natureza,old.recurso_terceiros)
 AND NOT (public.imob_correcao_proprietario_ativa(old.imovel_id)
   AND (new.imovel_id,new.reserva_imovel_id,new.locacao_imovel_id,new.venda_imovel_id,new.imovel_percentual_admin,new.imovel_natureza,new.recurso_terceiros) IS NOT DISTINCT FROM (old.imovel_id,old.reserva_imovel_id,old.locacao_imovel_id,old.venda_imovel_id,old.imovel_percentual_admin,old.imovel_natureza,old.recurso_terceiros))
 AND (NOT old.pendente OR old.valor_baixado>0 OR EXISTS(SELECT 1 FROM public.imovel_movimento WHERE transacao_chave=old.id)) THEN RAISE EXCEPTION 'Vínculos e percentual de transação recebida são históricos e imutáveis.'; END IF;
 RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.imob_trocar_proprietario(p_imovel_id bigint, p_novo_id bigint, p_modo text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  i public.imovel%ROWTYPE;
  v_actor uuid;
  v_modo text := upper(btrim(coalesce(p_modo, '')));
  v_reservas bigint[] := '{}';
  v_locacoes bigint[] := '{}';
  v_transacoes integer := 0;
  v_baixas integer := 0;
  v_movimentos integer := 0;
  v_lancamentos integer := 0;
  v_arquivos integer := 0;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE = '42501'; END IF;
  IF v_modo NOT IN ('TRANSFERENCIA', 'CORRECAO') THEN
    RAISE EXCEPTION 'Informe se a troca é uma transferência do imóvel ou uma correção de cadastro.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.imovel WHERE id = p_imovel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imóvel não encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proprietario WHERE id = p_novo_id AND ativo) THEN
    RAISE EXCEPTION 'Novo proprietário inexistente ou inativo.' USING ERRCODE = '22023';
  END IF;
  IF v_modo = 'TRANSFERENCIA' AND i.proprietario_id = p_novo_id THEN
    RAISE EXCEPTION 'O imóvel já pertence a este proprietário.' USING ERRCODE = '22023';
  END IF;

  IF v_modo = 'TRANSFERENCIA' THEN
    -- O que ainda vai acontecer acompanha o imóvel.
    WITH u AS (
      UPDATE public.reserva_imovel SET proprietario_id = p_novo_id, updated_by = v_actor, updated_at = now()
       WHERE imovel_id = i.id AND status IN ('CONFIRMADA', 'EM_ANDAMENTO') AND proprietario_id <> p_novo_id
      RETURNING id)
    SELECT coalesce(array_agg(id), '{}') INTO v_reservas FROM u;
    WITH u AS (
      UPDATE public.locacao_imovel SET proprietario_id = p_novo_id, updated_by = v_actor, updated_at = now()
       WHERE imovel_id = i.id AND status = 'ATIVA' AND proprietario_id <> p_novo_id
      RETURNING id)
    SELECT coalesce(array_agg(id), '{}') INTO v_locacoes FROM u;
    -- Só cobranças ainda sem nenhum pagamento: as já pagas (inteiras ou em parte) são do dono anterior.
    UPDATE public.transacao t SET proprietario_id = p_novo_id, updated_by = v_actor, updated_at = now()
     WHERE t.imovel_id = i.id AND t.proprietario_id <> p_novo_id AND t.baixa_de_transacao_id IS NULL
       AND t.pendente AND NOT t.is_deleted AND coalesce(t.valor_baixado, 0) = 0
       AND t.imovel_natureza IN ('RECEBIMENTO', 'REEMBOLSO')
       AND (t.reserva_imovel_id = ANY (v_reservas) OR t.locacao_imovel_id = ANY (v_locacoes))
       AND NOT EXISTS (SELECT 1 FROM public.imovel_movimento m WHERE m.transacao_chave = t.id);
    GET DIAGNOSTICS v_transacoes = ROW_COUNT;
    UPDATE public.imovel_arquivo SET proprietario_id = p_novo_id
     WHERE imovel_id = i.id AND proprietario_id IS NOT NULL AND proprietario_id <> p_novo_id
       AND (reserva_id = ANY (v_reservas) OR locacao_id = ANY (v_locacoes));
    GET DIAGNOSTICS v_arquivos = ROW_COUNT;
  ELSE
    PERFORM set_config('app.imob_correcao_proprietario', i.id::text, true);
    -- Extrato e lançamentos antes das transações: a sincronização do extrato (gatilho da
    -- transação) encontra os valores já no novo dono e não gera movimento novo.
    UPDATE public.imovel_movimento SET proprietario_id = p_novo_id
     WHERE imovel_id = i.id AND venda_id IS NULL AND proprietario_id <> p_novo_id;
    GET DIAGNOSTICS v_movimentos = ROW_COUNT;
    UPDATE public.imovel_lancamento SET proprietario_id = p_novo_id, updated_at = now()
     WHERE imovel_id = i.id AND proprietario_id <> p_novo_id;
    GET DIAGNOSTICS v_lancamentos = ROW_COUNT;
    -- Títulos antes das baixas (as baixas copiam o vínculo do título no gatilho).
    UPDATE public.transacao SET proprietario_id = p_novo_id, updated_by = v_actor, updated_at = now()
     WHERE imovel_id = i.id AND venda_imovel_id IS NULL AND baixa_de_transacao_id IS NULL AND proprietario_id <> p_novo_id;
    GET DIAGNOSTICS v_transacoes = ROW_COUNT;
    UPDATE public.transacao SET proprietario_id = p_novo_id, updated_by = v_actor, updated_at = now()
     WHERE imovel_id = i.id AND venda_imovel_id IS NULL AND baixa_de_transacao_id IS NOT NULL AND proprietario_id <> p_novo_id;
    GET DIAGNOSTICS v_baixas = ROW_COUNT;
    WITH u AS (
      UPDATE public.reserva_imovel SET proprietario_id = p_novo_id, updated_by = v_actor, updated_at = now()
       WHERE imovel_id = i.id AND proprietario_id <> p_novo_id
      RETURNING id)
    SELECT coalesce(array_agg(id), '{}') INTO v_reservas FROM u;
    -- Foto informativa do evento de receita das reservas movidas (o gatilho da reserva só a refaz
    -- quando muda valor ou situação).
    UPDATE public.eventos_financeiros
       SET dados_snapshot = dados_snapshot || jsonb_build_object('proprietario_id', p_novo_id), updated_at = clock_timestamp()
     WHERE source_type = 'RESERVA' AND source_id = ANY (v_reservas)
       AND dados_snapshot ? 'proprietario_id' AND dados_snapshot->>'proprietario_id' IS DISTINCT FROM p_novo_id::text;
    WITH u AS (
      UPDATE public.locacao_imovel SET proprietario_id = p_novo_id, updated_by = v_actor, updated_at = now()
       WHERE imovel_id = i.id AND proprietario_id <> p_novo_id
      RETURNING id)
    SELECT coalesce(array_agg(id), '{}') INTO v_locacoes FROM u;
    UPDATE public.imovel_arquivo SET proprietario_id = p_novo_id
     WHERE imovel_id = i.id AND proprietario_id IS NOT NULL AND proprietario_id <> p_novo_id AND venda_id IS NULL;
    GET DIAGNOSTICS v_arquivos = ROW_COUNT;
    PERFORM set_config('app.imob_correcao_proprietario', '', true);
  END IF;

  IF i.proprietario_id <> p_novo_id THEN
    UPDATE public.imovel SET proprietario_id = p_novo_id, updated_by = v_actor, updated_at = now() WHERE id = i.id;
  END IF;

  RETURN jsonb_build_object(
    'modo', v_modo, 'imovel_id', i.id, 'proprietario_anterior_id', i.proprietario_id, 'proprietario_id', p_novo_id,
    'reservas', coalesce(array_length(v_reservas, 1), 0), 'locacoes', coalesce(array_length(v_locacoes, 1), 0),
    'transacoes', v_transacoes + v_baixas, 'movimentos', v_movimentos, 'lancamentos', v_lancamentos, 'arquivos', v_arquivos);
END $$;

REVOKE ALL ON FUNCTION public.imob_trocar_proprietario(bigint, bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_trocar_proprietario(bigint, bigint, text, uuid) TO service_role;
-- imob_correcao_proprietario_ativa fica com a permissão padrão: roda dentro dos gatilhos, com o
-- papel de quem altera a transação, e só lê uma configuração local (não concede nada sozinha).

NOTIFY pgrst, 'reload schema';

COMMIT;
