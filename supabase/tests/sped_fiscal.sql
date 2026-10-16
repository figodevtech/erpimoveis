BEGIN;

DO $$
BEGIN
  IF public.fiscal_cnpj_normalizar('00.000.000/e08g-12') <> '00000000E08G12' THEN
    RAISE EXCEPTION 'normalizacao do CNPJ alfanumerico divergiu';
  END IF;
  IF NOT public.fiscal_cnpj_valido('04.252.011/0001-10') THEN
    RAISE EXCEPTION 'CNPJ numerico oficial foi recusado';
  END IF;
  IF NOT public.fiscal_cnpj_valido('00.000.000/E08G-12') THEN
    RAISE EXCEPTION 'CNPJ alfanumerico oficial foi recusado';
  END IF;
  IF public.fiscal_cnpj_valido('00000000E08G13') THEN
    RAISE EXCEPTION 'DV invalido foi aceito';
  END IF;
  IF public.fiscal_cnpj_valido('00000000E08G1A') THEN
    RAISE EXCEPTION 'letra nas posicoes de DV foi aceita';
  END IF;
  IF public.fiscal_cnpj_valido('00000000000000') THEN
    RAISE EXCEPTION 'base repetida foi aceita';
  END IF;
END
$$;

-- Ciclo completo da competência: abrir, validar com bloqueio, validar limpa,
-- fechar, provar a imutabilidade, reabrir e fechar a retificadora.
DO $$
DECLARE
  v_empresa_id integer;
  v_usuario_id uuid;
  v_produto_id integer;
  v_competencia_id bigint;
  v_v1 bigint;
  v_v2 bigint;
  v_execucao bigint;
  v_lock integer;
  v_resultado jsonb;
  v_hash_1 text := repeat('a', 64);
  v_hash_2 text := repeat('b', 64);
  v_snapshots_v1 integer;
  v_status text;
BEGIN
  SELECT id INTO v_empresa_id FROM public.empresa ORDER BY id LIMIT 1;
  SELECT id INTO v_usuario_id FROM public.usuario ORDER BY id LIMIT 1;
  IF v_empresa_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE NOTICE 'sem empresa ou usuario para testar workflow SPED';
    RETURN;
  END IF;

  v_competencia_id := public.fiscal_sped_criar_competencia(v_empresa_id, date '2099-08-01', v_usuario_id);
  IF v_competencia_id IS NULL THEN
    RAISE EXCEPTION 'competencia SPED nao foi criada';
  END IF;
  IF public.fiscal_sped_criar_competencia(v_empresa_id, date '2099-08-01', v_usuario_id) <> v_competencia_id THEN
    RAISE EXCEPTION 'criar a mesma competencia duas vezes gerou outra linha';
  END IF;
  BEGIN
    PERFORM public.fiscal_sped_criar_competencia(v_empresa_id, date '2099-08-15', v_usuario_id);
    RAISE EXCEPTION 'competencia fora do primeiro dia do mes foi aceita';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  v_v1 := public.fiscal_sped_abrir_versao(
    v_competencia_id, 'ORIGINAL', '020', '3.2.4', '0.1.0', '0000000', now(), v_hash_1, v_usuario_id);
  BEGIN
    PERFORM public.fiscal_sped_abrir_versao(
      v_competencia_id, 'ORIGINAL', '020', '3.2.4', '0.1.0', '0000000', now(), v_hash_1, v_usuario_id);
    RAISE EXCEPTION 'segunda versao editavel foi aberta';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;

  PERFORM public.fiscal_sped_substituir_snapshots_documentais(
    v_v1,
    jsonb_build_array(jsonb_build_object(
      'fonte_tipo', 'NFE_EMITIDA', 'fonte_tabela', 'nfe', 'fonte_id', '1',
      'operacao', 'SAIDA', 'chave_acesso', repeat('1', 44), 'modelo', '55',
      'codigo_situacao', '00', 'data_emissao_civil', '2099-08-10',
      'data_emissao_original', '2099-08-10T10:00:00-03:00', 'data_emissao_offset', '-03:00',
      'participante_documento_tipo', 'CNPJ', 'participante_documento_canonico', '00000000E08G12',
      'xml_sha256', repeat('c', 64), 'payload', '{}'::jsonb,
      'itens', jsonb_build_array(jsonb_build_object(
        'numero_item', 1, 'codigo_item', 'ITEM-1', 'unidade_documento', 'UN',
        'tratamento_credito', 'NAO_APLICAVEL', 'payload', '{}'::jsonb))
    )),
    jsonb_build_array(jsonb_build_object(
      'tipo', 'PARTICIPANTE', 'codigo', 'P1', 'documento_tipo', 'CNPJ',
      'documento_canonico', '00000000E08G12', 'payload', '{}'::jsonb,
      'payload_sha256', repeat('d', 64))),
    jsonb_build_array(jsonb_build_object(
      'tipo', 'ICMS_PROPRIO', 'periodo_inicio', '2099-08-01', 'periodo_fim', '2099-08-31',
      'payload', '{}'::jsonb, 'payload_sha256', repeat('e', 64)))
  );

  BEGIN
    PERFORM public.fiscal_sped_iniciar_validacao(v_v1, v_hash_2, v_usuario_id);
    RAISE EXCEPTION 'validacao com hash divergente foi aceita';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;

  v_execucao := public.fiscal_sped_iniciar_validacao(v_v1, v_hash_1, v_usuario_id);
  SELECT status INTO v_status FROM public.fiscal_sped_competencia WHERE id = v_competencia_id;
  IF v_status <> 'EM_VALIDACAO' THEN
    RAISE EXCEPTION 'competencia deveria estar EM_VALIDACAO, esta %', v_status;
  END IF;
  INSERT INTO public.fiscal_sped_inconsistencia(execucao_id, severidade, codigo, mensagem)
  VALUES (v_execucao, 'BLOQUEIO', 'TESTE', 'bloqueio de teste');
  v_resultado := public.fiscal_sped_concluir_validacao(v_execucao, v_usuario_id);
  IF (v_resultado->>'apta')::boolean THEN
    RAISE EXCEPTION 'validacao com bloqueio ficou apta';
  END IF;
  SELECT status INTO v_status FROM public.fiscal_sped_competencia WHERE id = v_competencia_id;
  IF v_status <> 'COM_ERROS' THEN
    RAISE EXCEPTION 'competencia com bloqueio deveria estar COM_ERROS, esta %', v_status;
  END IF;

  v_execucao := public.fiscal_sped_iniciar_validacao(v_v1, v_hash_1, v_usuario_id);
  v_resultado := public.fiscal_sped_concluir_validacao(v_execucao, v_usuario_id);
  IF NOT (v_resultado->>'apta')::boolean THEN
    RAISE EXCEPTION 'validacao limpa nao ficou apta: %', v_resultado;
  END IF;
  SELECT lock_version INTO v_lock FROM public.fiscal_sped_competencia WHERE id = v_competencia_id;

  -- Gates pendentes impedem o fechamento, mesmo com a versao validada.
  INSERT INTO public.fiscal_sped_config(empresa_id) VALUES (v_empresa_id)
  ON CONFLICT (empresa_id) DO NOTHING;
  BEGIN
    PERFORM public.fiscal_sped_fechar_versao(v_competencia_id, v_v1, v_lock, v_hash_1, v_usuario_id);
    RAISE EXCEPTION 'competencia com gates pendentes foi fechada';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  UPDATE public.fiscal_sped_config
     SET timezone_iana = 'America/Fortaleza', timezone_status = 'CONFIRMADO',
         perfil_efd = 'A', perfil_efd_status = 'CONFIRMADO',
         indicador_atividade = '1', indicador_atividade_status = 'CONFIRMADO',
         bloco_k_status = 'NAO_APLICAVEL', registro_1400_status = 'NAO_APLICAVEL',
         c176_c179_status = 'NAO_APLICAVEL', registro_1601_status = 'NAO_APLICAVEL',
         inventario_status = 'NAO_APLICAVEL', contribuinte_ipi_status = 'NAO_APLICAVEL',
         entrega_efd_contribuicoes_status = 'NAO_APLICAVEL'
   WHERE empresa_id = v_empresa_id;

  BEGIN
    PERFORM public.fiscal_sped_fechar_versao(v_competencia_id, v_v1, v_lock - 1, v_hash_1, v_usuario_id);
    RAISE EXCEPTION 'fechamento com lock antigo foi aceito';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;

  v_lock := public.fiscal_sped_fechar_versao(v_competencia_id, v_v1, v_lock, v_hash_1, v_usuario_id);
  SELECT status INTO v_status FROM public.fiscal_sped_competencia WHERE id = v_competencia_id;
  IF v_status <> 'FECHADA' THEN
    RAISE EXCEPTION 'competencia deveria estar FECHADA, esta %', v_status;
  END IF;

  -- Imutabilidade da versao fechada e da competencia.
  SELECT count(*) INTO v_snapshots_v1 FROM public.fiscal_sped_documento_snapshot WHERE versao_id = v_v1;
  BEGIN
    DELETE FROM public.fiscal_sped_documento_snapshot WHERE versao_id = v_v1;
    RAISE EXCEPTION 'snapshot de versao fechada foi excluido';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.fiscal_sped_versao SET leiaute = '021' WHERE id = v_v1;
    RAISE EXCEPTION 'versao fechada foi alterada';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.fiscal_sped_ajuste_apuracao(
      competencia_id, registro_destino, natureza, codigo_ajuste, valor, descricao, evidencia, created_by)
    VALUES (v_competencia_id, 'E111', 'DEBITO', 'PB000001', 1, 'teste', 'teste', v_usuario_id);
    RAISE EXCEPTION 'ajuste entrou em competencia fechada';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.fiscal_sped_competencia WHERE id = v_competencia_id;
    RAISE EXCEPTION 'competencia foi excluida';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM public.fiscal_sped_abrir_versao(
      v_competencia_id, 'ORIGINAL', '020', '3.2.4', '0.1.0', '0000000', now(), v_hash_1, v_usuario_id);
    RAISE EXCEPTION 'versao nova foi aberta sem reabrir a competencia';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  -- Reabertura cria a retificadora sem tocar na versao fechada.
  BEGIN
    PERFORM public.fiscal_sped_reabrir_competencia(
      v_competencia_id, v_lock, v_usuario_id, '  ', '020', '3.2.4', '0.1.0', '0000000', now(), v_hash_2);
    RAISE EXCEPTION 'reabertura sem motivo foi aceita';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_v2 := public.fiscal_sped_reabrir_competencia(
    v_competencia_id, v_lock, v_usuario_id, 'teste de reabertura', '020', '3.2.4', '0.1.0', '0000000', now(), v_hash_2);
  IF NOT EXISTS (
    SELECT 1 FROM public.fiscal_sped_versao
     WHERE id = v_v2 AND numero = 2 AND finalidade = 'RETIFICADORA'
       AND versao_anterior_id = v_v1 AND status = 'RASCUNHO'
  ) THEN
    RAISE EXCEPTION 'reabertura nao criou a versao 2 retificadora ligada a versao 1';
  END IF;
  IF (SELECT status FROM public.fiscal_sped_versao WHERE id = v_v1) <> 'FECHADA'
     OR (SELECT count(*) FROM public.fiscal_sped_documento_snapshot WHERE versao_id = v_v1) <> v_snapshots_v1 THEN
    RAISE EXCEPTION 'reabertura alterou a versao fechada';
  END IF;

  v_execucao := public.fiscal_sped_iniciar_validacao(v_v2, v_hash_2, v_usuario_id);
  PERFORM public.fiscal_sped_concluir_validacao(v_execucao, v_usuario_id);
  SELECT lock_version INTO v_lock FROM public.fiscal_sped_competencia WHERE id = v_competencia_id;
  PERFORM public.fiscal_sped_fechar_versao(v_competencia_id, v_v2, v_lock, v_hash_2, v_usuario_id);
  IF (SELECT status FROM public.fiscal_sped_versao WHERE id = v_v1) <> 'SUBSTITUIDA'
     OR (SELECT status FROM public.fiscal_sped_versao WHERE id = v_v2) <> 'FECHADA' THEN
    RAISE EXCEPTION 'fechar a retificadora deveria substituir a versao 1';
  END IF;

  -- Decisao por item em competencia aberta: grava e, repetida, atualiza a mesma linha.
  SELECT id INTO v_produto_id FROM public.produto ORDER BY id LIMIT 1;
  IF v_produto_id IS NOT NULL THEN
    v_competencia_id := public.fiscal_sped_criar_competencia(v_empresa_id, date '2099-09-01', v_usuario_id);
    v_resultado := public.fiscal_sped_configurar_item_competencia(
      v_competencia_id, v_produto_id, 'ITEM-TESTE', '00', NULL, NULL, NULL, 'evidencia de teste', v_usuario_id);
    IF (public.fiscal_sped_configurar_item_competencia(
          v_competencia_id, v_produto_id, 'ITEM-TESTE-2', '00', NULL, NULL, NULL, 'evidencia de teste', v_usuario_id
        )->>'itemConfigId') <> (v_resultado->>'itemConfigId') THEN
      RAISE EXCEPTION 'repetir a decisao do item na mesma competencia criou outra configuracao';
    END IF;
  END IF;
END
$$;

-- Cancelamento de NF-e preserva o evento e é idempotente.
DO $$
DECLARE
  v_nfe record;
  v_hash text := repeat('f', 64);
BEGIN
  SELECT id, empresaid, chave_acesso INTO v_nfe
    FROM public.nfe
   WHERE status = 'AUTORIZADA'
     AND chave_acesso ~ '^[0-9]{44}$'
   ORDER BY id DESC
   LIMIT 1;
  IF v_nfe.id IS NULL THEN
    RAISE NOTICE 'sem NF-e autorizada para testar cancelamento';
    RETURN;
  END IF;

  PERFORM public.fiscal_registrar_cancelamento_nfe(
    v_nfe.id, v_nfe.empresaid, v_nfe.chave_acesso, 'teste de cancelamento', '135', '999999999999999',
    '2099-08-10T10:00:00-03:00', date '2099-08-10', '-03:00', timestamptz '2099-08-10T13:00:00Z',
    '<evento/>', '<retorno/>', v_hash, v_hash);
  IF (SELECT status FROM public.nfe WHERE id = v_nfe.id) <> 'CANCELADA' THEN
    RAISE EXCEPTION 'NF-e nao ficou CANCELADA';
  END IF;

  PERFORM public.fiscal_registrar_cancelamento_nfe(
    v_nfe.id, v_nfe.empresaid, v_nfe.chave_acesso, 'teste de cancelamento', '135', '999999999999999',
    '2099-08-10T10:00:00-03:00', date '2099-08-10', '-03:00', timestamptz '2099-08-10T13:00:00Z',
    '<evento/>', '<retorno/>', v_hash, v_hash);
  IF (SELECT count(*) FROM public.fiscal_documento_evento WHERE nfe_id = v_nfe.id) <> 1 THEN
    RAISE EXCEPTION 'repetir o cancelamento duplicou o evento';
  END IF;

  BEGIN
    PERFORM public.fiscal_registrar_cancelamento_nfe(
      v_nfe.id, v_nfe.empresaid, v_nfe.chave_acesso, 'teste', '135', '888888888888888',
      NULL, NULL, NULL, NULL, '<evento/>', '<retorno/>', v_hash, v_hash);
    RAISE EXCEPTION 'cancelamento divergente foi aceito';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;

  BEGIN
    UPDATE public.fiscal_documento_evento SET protocolo_evento = 'x' WHERE nfe_id = v_nfe.id;
    RAISE EXCEPTION 'evento fiscal foi alterado';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END
$$;


-- Geracao em um clique: pedido unico por competencia, concessao exclusiva,
-- retomada apos interrupcao, resolucao automatica idempotente e vigencia da
-- configuracao.
DO $$
DECLARE
  v_empresa_id integer;
  v_usuario_id uuid;
  v_produto_id integer;
  v_competencia_id bigint;
  v_job bigint;
  v_job_again bigint;
  v_token_a uuid := gen_random_uuid();
  v_token_b uuid := gen_random_uuid();
  v_row public.fiscal_sped_geracao%ROWTYPE;
  v_resultado jsonb;
  v_config public.fiscal_sped_config%ROWTYPE;
BEGIN
  SELECT id INTO v_empresa_id FROM public.empresa ORDER BY id LIMIT 1;
  SELECT id INTO v_usuario_id FROM public.usuario ORDER BY id LIMIT 1;
  IF v_empresa_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE NOTICE 'sem empresa ou usuario para testar a geracao automatica';
    RETURN;
  END IF;

  v_job := public.fiscal_sped_geracao_solicitar(v_empresa_id, date '2099-09-01', v_usuario_id);
  v_job_again := public.fiscal_sped_geracao_solicitar(v_empresa_id, date '2099-09-01', v_usuario_id);
  IF v_job IS NULL OR v_job_again <> v_job THEN
    RAISE EXCEPTION 'clique duplo criou dois pedidos ativos para a mesma competencia';
  END IF;
  BEGIN
    INSERT INTO public.fiscal_sped_geracao(empresa_id, competencia, solicitado_por)
    VALUES (v_empresa_id, date '2099-09-01', v_usuario_id);
    RAISE EXCEPTION 'segundo pedido ativo foi aceito pelo indice';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;

  v_row := public.fiscal_sped_geracao_reivindicar(v_job, v_token_a, 60);
  IF v_row.id IS NULL OR v_row.status <> 'PROCESSANDO' THEN
    RAISE EXCEPTION 'primeiro executor nao recebeu a concessao';
  END IF;
  v_row := public.fiscal_sped_geracao_reivindicar(v_job, v_token_b, 60);
  IF v_row.id IS NOT NULL THEN
    RAISE EXCEPTION 'segundo executor recebeu concessao valida de outro';
  END IF;
  BEGIN
    PERFORM public.fiscal_sped_geracao_avancar(v_job, v_token_b, 'VALIDANDO', NULL, 60);
    RAISE EXCEPTION 'executor sem concessao avancou a etapa';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  PERFORM public.fiscal_sped_geracao_avancar(v_job, v_token_a, 'COLETANDO_DOCUMENTOS', NULL, 60);
  IF NOT public.fiscal_sped_geracao_renovar(v_job, v_token_a, 60) THEN
    RAISE EXCEPTION 'renovacao da concessao valida falhou';
  END IF;

  -- Interrupcao: a concessao vence e outro executor retoma.
  UPDATE public.fiscal_sped_geracao SET lease_until = now() - interval '1 minute' WHERE id = v_job;
  v_row := public.fiscal_sped_geracao_reivindicar(v_job, v_token_b, 60);
  IF v_row.id IS NULL OR v_row.tentativas <> 2 THEN
    RAISE EXCEPTION 'pedido interrompido nao foi retomado';
  END IF;
  BEGIN
    PERFORM public.fiscal_sped_geracao_concluir(v_job, v_token_a, 'CONCLUIDA', '{}'::jsonb, NULL, NULL);
    RAISE EXCEPTION 'executor antigo concluiu um pedido retomado por outro';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  PERFORM public.fiscal_sped_geracao_concluir(v_job, v_token_b, 'PENDENCIAS', '{}'::jsonb, NULL, NULL);
  IF (SELECT status FROM public.fiscal_sped_geracao WHERE id = v_job) <> 'PENDENCIAS' THEN
    RAISE EXCEPTION 'pedido nao foi concluido';
  END IF;
  IF public.fiscal_sped_geracao_solicitar(v_empresa_id, date '2099-09-01', v_usuario_id) = v_job THEN
    RAISE EXCEPTION 'pedido concluido foi reaproveitado como ativo';
  END IF;

  -- Resolucao automatica: cria uma vez, ignora na repeticao, recusa DF-e alheio.
  v_competencia_id := public.fiscal_sped_criar_competencia(v_empresa_id, date '2099-09-01', v_usuario_id);
  SELECT p.id INTO v_produto_id
    FROM public.produto p
   WHERE NOT p.is_deleted
     AND NOT EXISTS (SELECT 1 FROM public.fiscal_sped_item_config c WHERE c.produto_id = p.id)
   ORDER BY p.id LIMIT 1;
  IF v_produto_id IS NOT NULL THEN
    v_resultado := public.fiscal_sped_aplicar_resolucao_automatica(v_competencia_id, jsonb_build_array(jsonb_build_object(
      'produto_id', v_produto_id, 'codigo_item', 'TESTE-' || v_produto_id, 'tipo_item', '00',
      'vigencia_inicio', '2099-09-01', 'vigencia_fim', NULL, 'evidencia', 'teste automatizado')), '[]'::jsonb, v_usuario_id);
    IF (v_resultado->>'itensCriados')::integer <> 1 THEN
      RAISE EXCEPTION 'resolucao automatica nao criou o item: %', v_resultado;
    END IF;
    v_resultado := public.fiscal_sped_aplicar_resolucao_automatica(v_competencia_id, jsonb_build_array(jsonb_build_object(
      'produto_id', v_produto_id, 'codigo_item', 'TESTE-' || v_produto_id, 'tipo_item', '00',
      'vigencia_inicio', '2099-09-01', 'vigencia_fim', NULL, 'evidencia', 'teste automatizado')), '[]'::jsonb, v_usuario_id);
    IF (v_resultado->>'itensCriados')::integer <> 0 OR (v_resultado->>'itensIgnorados')::integer <> 1 THEN
      RAISE EXCEPTION 'repetir a resolucao duplicou a configuracao: %', v_resultado;
    END IF;
  END IF;
  BEGIN
    PERFORM public.fiscal_sped_aplicar_resolucao_automatica(v_competencia_id, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
      'documento_id', -1, 'numero_item', 1, 'tratamento_credito', 'SEM_CREDITO', 'evidencia', 'teste')), v_usuario_id);
    RAISE EXCEPTION 'decisao de credito em DF-e de outro estabelecimento foi aceita';
  EXCEPTION WHEN SQLSTATE '23503' THEN NULL;
  END;

  -- Vigencia: cada competencia usa a configuracao do seu primeiro dia.
  INSERT INTO public.fiscal_sped_config_vigencia(empresa_id, vigencia_inicio, payload)
  VALUES (v_empresa_id, date '2099-01-01', jsonb_build_object('perfil_efd', 'A', 'perfil_efd_status', 'CONFIRMADO'))
  ON CONFLICT (empresa_id, vigencia_inicio) DO UPDATE SET payload = excluded.payload;
  INSERT INTO public.fiscal_sped_config_vigencia(empresa_id, vigencia_inicio, payload)
  VALUES (v_empresa_id, date '2099-10-01', jsonb_build_object('perfil_efd', 'C', 'perfil_efd_status', 'CONFIRMADO'))
  ON CONFLICT (empresa_id, vigencia_inicio) DO UPDATE SET payload = excluded.payload;
  v_config := public.fiscal_sped_config_efetiva(v_empresa_id, date '2099-09-01');
  IF v_config.perfil_efd IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'configuracao vigente em 2099-09 deveria ser A, veio %', v_config.perfil_efd;
  END IF;
  v_config := public.fiscal_sped_config_efetiva(v_empresa_id, date '2099-11-01');
  IF v_config.perfil_efd IS DISTINCT FROM 'C' THEN
    RAISE EXCEPTION 'configuracao vigente em 2099-11 deveria ser C, veio %', v_config.perfil_efd;
  END IF;
END
$$;

ROLLBACK;
