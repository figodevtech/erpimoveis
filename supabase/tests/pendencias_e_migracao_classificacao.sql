-- Regressao transacional da Fase 4: fila, lote de migracao e catalogo padrao.
BEGIN;

DO $test$
DECLARE
  v_grupo        integer;
  v_conta        integer;
  v_despesa_adm  integer;
  v_receita      integer;
  v_banco        bigint;
  v_categoria    integer;
  v_tx           bigint;
  v_lote         integer;
  v_versao       integer;
  v_json         jsonb;
  v_linha        record;
  v_resultado    record;
  v_total        integer;
  v_antes        numeric;
  v_depois       numeric;
  v_aceitou      boolean;
  v_de           constant timestamptz := TIMESTAMPTZ '2026-08-01';
  v_ate          constant timestamptz := TIMESTAMPTZ '2026-08-31 23:59:59';
BEGIN
  SELECT id INTO v_despesa_adm FROM public.classificacoes_resultado WHERE codigo = 'DESPESA_ADMINISTRATIVA';
  SELECT id INTO v_receita FROM public.classificacoes_resultado WHERE codigo = 'RECEITA_SERVICOS';
  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  SELECT id INTO v_categoria FROM public.categoriatransacao ORDER BY id LIMIT 1;

  -- ------------------------------------------------------------ fila
  -- Um grupo novo sem classificacao tem de aparecer na fila. Antes de existir
  -- lancamento nenhum: e um problema de cadastro, nao de periodo.
  INSERT INTO public.planosdecontagrupos (codigo, nome)
  VALUES ('ZZF4', 'Grupo sem destino da Fase 4') RETURNING id INTO v_grupo;
  INSERT INTO public.planosdeconta (codigo, nome, grupo_id)
  VALUES ('ZZF4.1', 'Conta sem destino da Fase 4', v_grupo) RETURNING id INTO v_conta;

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'GRUPO_SEM_DESTINO';
  IF v_linha.quantidade IS NULL OR v_linha.quantidade < 1 THEN
    RAISE EXCEPTION 'A fila deveria acusar grupo sem destino.';
  END IF;
  IF v_linha.escopo <> 'CADASTRO' THEN
    RAISE EXCEPTION 'Grupo sem destino e problema de cadastro, nao de periodo.';
  END IF;

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'CONTA_SEM_REGRA';
  IF v_linha.quantidade IS NULL OR v_linha.quantidade < 1 THEN
    RAISE EXCEPTION 'A fila deveria acusar conta sem classificacao.';
  END IF;

  -- Lancamento sem destino tem de aparecer com VALOR, nao so com contagem.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 1234.56, now(), TIMESTAMPTZ '2026-08-10', v_banco, v_conta, v_categoria,
          'ZZF4 sem destino', 'FIXTURE F4', '00000000000')
  RETURNING id INTO v_tx;

  INSERT INTO public.eventos_financeiros
    (origem, natureza, valor, chave_origem, status, source_type, source_id,
     competencia_em, natureza_dre, is_manual, descricao)
  VALUES ('AVULSO', 'DESPESA', 1234.56, 'zzf4-1', 'ATIVO', 'TRANSACAO', v_tx,
          TIMESTAMPTZ '2026-08-10', 'DESPESA', true, 'ZZF4 sem destino');

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'EVENTO_SEM_LINHA';
  IF v_linha.valor IS NULL OR v_linha.valor < 1234.56 THEN
    RAISE EXCEPTION 'A fila deveria somar o valor sem destino; veio %.', v_linha.valor;
  END IF;

  -- Evento sem competencia nao pertence a mes nenhum: fila de escopo GERAL.
  INSERT INTO public.eventos_financeiros
    (origem, natureza, valor, chave_origem, status, source_type, source_id,
     natureza_dre, is_manual, descricao)
  VALUES ('AVULSO', 'DESPESA', 77, 'zzf4-2', 'ATIVO', 'TRANSACAO', v_tx,
          'DESPESA', true, 'ZZF4 sem competencia');

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'EVENTO_SEM_COMPETENCIA';
  IF v_linha.quantidade IS NULL OR v_linha.quantidade < 1 THEN
    RAISE EXCEPTION 'A fila deveria acusar evento sem competencia.';
  END IF;

  -- Itens: a tela precisa conseguir abrir cada motivo.
  SELECT count(*) INTO v_total
    FROM public.dre_pendencias_itens('GRUPO_SEM_DESTINO', v_de, v_ate, 100, 0);
  IF v_total < 1 THEN
    RAISE EXCEPTION 'O detalhe de GRUPO_SEM_DESTINO veio vazio.';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.dre_pendencias_itens('EVENTO_SEM_LINHA', v_de, v_ate, 100, 0);
  IF v_total < 1 THEN
    RAISE EXCEPTION 'O detalhe de EVENTO_SEM_LINHA veio vazio.';
  END IF;

  -- Motivo desconhecido e erro, nao lista vazia: uma tela que recebe zero de um
  -- motivo inexistente diria "sem pendencias".
  BEGIN
    PERFORM * FROM public.dre_pendencias_itens('NAO_EXISTE', v_de, v_ate, 10, 0);
    v_aceitou := true;
  EXCEPTION WHEN sqlstate '22023' THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Motivo desconhecido deveria abortar.';
  END IF;

  -- ------------------------------------------------------------ lote
  SELECT versao_registro INTO v_versao FROM public.planosdecontagrupos WHERE id = v_grupo;

  INSERT INTO public.plano_contas_lote (referencia, vigencia_inicio, versao_catalogo, observacao)
  VALUES ('zzf4-teste', DATE '2026-09-01', 1, 'lote do teste') RETURNING id INTO v_lote;

  INSERT INTO public.plano_contas_lote_item
    (lote_id, entidade, entidade_id, classificacao_id, versao_esperada, certeza, justificativa,
     destino_atual, destino_proposto)
  VALUES (v_lote, 'GRUPO', v_grupo, v_despesa_adm, v_versao, 'ALTA',
          'nome do grupo identifica a finalidade', 'SEM DESTINO', '6.2');

  -- Baseline: aplicar a migracao nao pode mexer no que ja estava classificado.
  SELECT coalesce(sum(valor), 0) INTO v_antes
    FROM public.dre_somar_por_linha(
      (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1), v_de, v_ate);

  SELECT * INTO v_resultado FROM public.plano_contas_aplicar_lote(v_lote, NULL, 500);
  IF v_resultado.aplicados <> 1 OR v_resultado.restantes <> 0 THEN
    RAISE EXCEPTION 'Esperava 1 aplicado e 0 restantes; veio % / %.',
      v_resultado.aplicados, v_resultado.restantes;
  END IF;

  IF (SELECT estado FROM public.plano_contas_lote WHERE id = v_lote) <> 'APLICADO' THEN
    RAISE EXCEPTION 'O lote deveria ficar APLICADO quando nao sobra unidade.';
  END IF;

  IF (SELECT classificacao_padrao_id FROM public.planosdecontagrupos WHERE id = v_grupo)
     IS DISTINCT FROM v_despesa_adm THEN
    RAISE EXCEPTION 'A classificacao do grupo nao foi aplicada.';
  END IF;

  -- A migracao classificou o cadastro; a DRE do passado nao muda, porque a
  -- vigencia comeca em setembro e o lancamento e de agosto.
  SELECT coalesce(sum(valor), 0) INTO v_depois
    FROM public.dre_somar_por_linha(
      (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1), v_de, v_ate);
  IF v_depois <> v_antes THEN
    RAISE EXCEPTION 'Aplicar a migracao mudou a DRE de agosto: antes %, depois %.', v_antes, v_depois;
  END IF;

  -- Reaplicar nao repete nada.
  SELECT * INTO v_resultado FROM public.plano_contas_aplicar_lote(v_lote, NULL, 500);
  IF v_resultado.aplicados <> 0 THEN
    RAISE EXCEPTION 'Reaplicar o lote repetiu % unidade(s).', v_resultado.aplicados;
  END IF;

  -- Cadastro alterado depois da simulacao vira CONFLITO, nao sobrescrita.
  INSERT INTO public.plano_contas_lote (referencia, vigencia_inicio, versao_catalogo)
  VALUES ('zzf4-conflito', DATE '2026-10-01', 1) RETURNING id INTO v_lote;
  INSERT INTO public.plano_contas_lote_item
    (lote_id, entidade, entidade_id, classificacao_id, versao_esperada, certeza)
  VALUES (v_lote, 'GRUPO', v_grupo, v_receita, 1, 'ALTA');

  SELECT * INTO v_resultado FROM public.plano_contas_aplicar_lote(v_lote, NULL, 500);
  IF v_resultado.conflitos <> 1 OR v_resultado.aplicados <> 0 THEN
    RAISE EXCEPTION 'Versao desatualizada deveria virar conflito; veio % conflito(s), % aplicado(s).',
      v_resultado.conflitos, v_resultado.aplicados;
  END IF;
  IF (SELECT classificacao_padrao_id FROM public.planosdecontagrupos WHERE id = v_grupo)
     IS DISTINCT FROM v_despesa_adm THEN
    RAISE EXCEPTION 'O conflito sobrescreveu a classificacao mesmo assim.';
  END IF;

  -- Uma unidade que falha nao derruba as outras.
  INSERT INTO public.plano_contas_lote (referencia, vigencia_inicio, versao_catalogo)
  VALUES ('zzf4-erro', DATE '2026-11-01', 1) RETURNING id INTO v_lote;
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta;
  INSERT INTO public.plano_contas_lote_item
    (lote_id, entidade, entidade_id, classificacao_id, versao_esperada, certeza)
  VALUES
    (v_lote, 'CONTA', v_conta, v_receita, v_versao, 'ALTA'),
    (v_lote, 'GRUPO', 999999999, v_despesa_adm, 1, 'ALTA');

  SELECT * INTO v_resultado FROM public.plano_contas_aplicar_lote(v_lote, NULL, 500);
  -- A conta pediu RECEITA_SERVICOS num grupo de despesa: familia incompativel.
  IF v_resultado.erros <> 1 THEN
    RAISE EXCEPTION 'Esperava 1 unidade com erro; veio %.', v_resultado.erros;
  END IF;
  IF v_resultado.conflitos <> 1 THEN
    RAISE EXCEPTION 'Cadastro inexistente deveria virar conflito; veio %.', v_resultado.conflitos;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.plano_contas_lote_item
     WHERE lote_id = v_lote AND estado = 'ERRO' AND motivo IS NOT NULL) THEN
    RAISE EXCEPTION 'A unidade com erro deveria registrar o motivo.';
  END IF;

  -- ------------------------------------------------- catalogo padrao
  v_json := jsonb_build_object(
    'grupos', jsonb_build_array(jsonb_build_object(
      'codigo', 'ZZ_GRP_TESTE', 'nome', 'Grupo padrao de teste',
      'codigo_sugerido', 'ZZS1', 'classificacao', 'DESPESA_ADMINISTRATIVA')),
    'contas', jsonb_build_array(jsonb_build_object(
      'codigo', 'ZZ_CTA_TESTE', 'nome', 'Conta padrao de teste',
      'grupo', 'ZZ_GRP_TESTE', 'instalacao', 'BASE')));

  SELECT count(*) INTO v_total
    FROM public.plano_contas_instalar_padrao(v_json, DATE '2026-01-01', true, NULL) r
   WHERE r.acao IN ('CRIADO', 'CRIADA');
  IF v_total <> 2 THEN
    RAISE EXCEPTION 'A instalacao deveria criar grupo e conta; criou %.', v_total;
  END IF;

  IF (SELECT origem_cadastro FROM public.planosdecontagrupos WHERE codigo_sistema = 'ZZ_GRP_TESTE')
     <> 'SISTEMA' THEN
    RAISE EXCEPTION 'O grupo padrao deveria nascer SISTEMA.';
  END IF;

  -- Reinstalar nao duplica.
  SELECT count(*) INTO v_total
    FROM public.plano_contas_instalar_padrao(v_json, DATE '2026-01-01', true, NULL) r
   WHERE r.acao IN ('CRIADO', 'CRIADA');
  IF v_total <> 0 THEN
    RAISE EXCEPTION 'Reinstalar criou % cadastro(s) de novo.', v_total;
  END IF;

  -- Nome ja existente nao e vinculado por semelhanca: vira aviso.
  v_json := jsonb_build_object(
    'grupos', jsonb_build_array(jsonb_build_object(
      'codigo', 'ZZ_GRP_OUTRO', 'nome', 'Grupo padrao de teste',
      'codigo_sugerido', 'ZZS2', 'classificacao', 'DESPESA_ADMINISTRATIVA')),
    'contas', '[]'::jsonb);
  SELECT count(*) INTO v_total
    FROM public.plano_contas_instalar_padrao(v_json, DATE '2026-01-01', true, NULL) r
   WHERE r.acao = 'COLISAO_NOME';
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'Colisao de nome deveria virar aviso, nao vinculo automatico.';
  END IF;

  RAISE NOTICE 'Pendencias e migracao: todas as verificacoes passaram.';
END
$test$;

ROLLBACK;
