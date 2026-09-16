-- Regressao transacional da Fase 3: cadastro atomico e bloqueio de gravacao.
BEGIN;

DO $test$
DECLARE
  v_grupo        integer;
  v_grupo_receita integer;
  v_conta        integer;
  v_conta_receita integer;
  v_receita      integer;
  v_despesa_adm  integer;
  v_despesa_pes  integer;
  v_transferencia integer;
  v_banco        bigint;
  v_categoria    integer;
  v_tx           bigint;
  v_versao       integer;
  v_regras       integer;
  v_fim          date;
  v_previa       record;
  v_uso          record;
  v_json         jsonb;
  v_aceitou      boolean;
  v_erro         text;
  v_visao        record;
  v_visao_grupo  record;
  v_conta_patrimonial integer;
BEGIN
  SELECT id INTO v_receita FROM public.classificacoes_resultado WHERE codigo = 'RECEITA_SERVICOS';
  SELECT id INTO v_despesa_adm FROM public.classificacoes_resultado WHERE codigo = 'DESPESA_ADMINISTRATIVA';
  SELECT id INTO v_despesa_pes FROM public.classificacoes_resultado WHERE codigo = 'DESPESA_PESSOAL';
  SELECT id INTO v_transferencia FROM public.classificacoes_resultado WHERE codigo = 'TRANSFERENCIA_INTERNA';

  -- ------------------------------------------------- criacao dinamica
  v_json := public.plano_contas_salvar_grupo(
    NULL, 'ZZF3', 'Grupo personalizado da Fase 3', 'teste', true, v_despesa_adm,
    NULL, DATE '2026-01-01', NULL, 'criado pelo teste');
  v_grupo := (v_json ->> 'id')::integer;

  IF (v_json ->> 'origem_cadastro') <> 'PERSONALIZADO' THEN
    RAISE EXCEPTION 'Grupo criado pela oficina deveria nascer PERSONALIZADO.';
  END IF;

  SELECT count(*) INTO v_regras
    FROM public.plano_contas_classificacao_regra WHERE grupo_id = v_grupo;
  IF v_regras <> 1 THEN
    RAISE EXCEPTION 'Criar o grupo deveria abrir uma regra; achei %.', v_regras;
  END IF;

  -- Conta sem excecao herda o grupo e nao ganha regra propria.
  v_json := public.plano_contas_salvar_conta(
    NULL, 'ZZF3.1', 'Conta herdando', NULL, true, v_grupo, NULL,
    NULL, DATE '2026-01-01', NULL, NULL);
  v_conta := (v_json ->> 'id')::integer;

  SELECT count(*) INTO v_regras
    FROM public.plano_contas_classificacao_regra WHERE conta_id = v_conta;
  IF v_regras <> 0 THEN
    RAISE EXCEPTION 'Conta sem excecao nao deveria abrir regra propria; achei %.', v_regras;
  END IF;

  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(v_conta, 'DESPESA', DATE '2026-08-15');
  IF v_previa.resultado <> 'CLASSIFICADO' OR v_previa.linha_codigo <> '6.2' THEN
    RAISE EXCEPTION 'Conta herdando deveria cair em 6.2; veio % / %.',
      v_previa.resultado, v_previa.linha_codigo;
  END IF;

  -- Excecao da mesma familia e aceita.
  v_json := public.plano_contas_salvar_conta(
    NULL, 'ZZF3.2', 'Conta com excecao', NULL, true, v_grupo, v_despesa_pes,
    NULL, DATE '2026-01-01', NULL, NULL);
  v_conta_receita := (v_json ->> 'id')::integer;

  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(v_conta_receita, 'DESPESA', DATE '2026-08-15');
  IF v_previa.linha_codigo <> '6.3' THEN
    RAISE EXCEPTION 'Excecao deveria levar a 6.3; veio %.', v_previa.linha_codigo;
  END IF;

  -- Excecao de outra familia e aceita desde a 20260915140000: a conta escolhe a
  -- propria linha, e o que protege o numero e a natureza do lancamento.
  BEGIN
    PERFORM public.plano_contas_salvar_conta(
      NULL, 'ZZF3.3', 'Conta cruzando familia', NULL, true, v_grupo, v_receita,
      NULL, DATE '2026-01-01', NULL, NULL);
    v_aceitou := true;
  EXCEPTION WHEN sqlstate 'PT422' THEN
    v_aceitou := false;
  END;
  IF NOT v_aceitou THEN
    RAISE EXCEPTION 'Excecao de outra familia foi recusada.';
  END IF;

  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(
      (SELECT id FROM public.planosdeconta WHERE codigo = 'ZZF3.3'), 'DESPESA', DATE '2026-08-15');
  IF v_previa.resultado <> 'INCOMPATIVEL' THEN
    RAISE EXCEPTION 'Despesa na conta que virou receita deveria ser INCOMPATIVEL; veio %.', v_previa.resultado;
  END IF;

  -- ------------------------------------------------- nome nao reclassifica
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta;
  v_json := public.plano_contas_salvar_conta(
    v_conta, 'ZZF3.1', 'Conta herdando renomeada', 'nova descricao', true, v_grupo, NULL,
    v_versao, DATE '2026-06-01', NULL, NULL);

  SELECT count(*) INTO v_regras
    FROM public.plano_contas_classificacao_regra WHERE conta_id = v_conta;
  IF v_regras <> 0 THEN
    RAISE EXCEPTION 'Renomear a conta abriu regra de classificacao.';
  END IF;
  IF (v_json ->> 'versao_registro')::integer <> v_versao + 1 THEN
    RAISE EXCEPTION 'A versao do registro nao avancou ao salvar.';
  END IF;

  -- ------------------------------------------------- concorrencia otimista
  BEGIN
    PERFORM public.plano_contas_salvar_conta(
      v_conta, 'ZZF3.1', 'Conta com versao velha', NULL, true, v_grupo, NULL,
      v_versao, DATE '2026-06-01', NULL, NULL);
    v_aceitou := true;
  EXCEPTION WHEN sqlstate 'PT409' THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Gravacao com versao antiga foi aceita.';
  END IF;

  -- ------------------------------------------- vigencia ao trocar classificacao
  SELECT versao_registro INTO v_versao FROM public.planosdecontagrupos WHERE id = v_grupo;
  PERFORM public.plano_contas_salvar_grupo(
    v_grupo, 'ZZF3', 'Grupo personalizado da Fase 3', 'teste', true, v_despesa_pes,
    v_versao, DATE '2026-07-01', NULL, 'mudanca de destino');

  SELECT count(*) INTO v_regras
    FROM public.plano_contas_classificacao_regra WHERE grupo_id = v_grupo;
  IF v_regras <> 2 THEN
    RAISE EXCEPTION 'Trocar a classificacao deveria abrir a segunda regra; achei %.', v_regras;
  END IF;

  SELECT vigencia_fim INTO v_fim
    FROM public.plano_contas_classificacao_regra
   WHERE grupo_id = v_grupo AND classificacao_id = v_despesa_adm;
  IF v_fim <> DATE '2026-07-01' THEN
    RAISE EXCEPTION 'A regra anterior deveria terminar em 2026-07-01 (fim exclusivo); veio %.', v_fim;
  END IF;

  -- Competencia anterior continua com o destino antigo.
  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(v_conta, 'DESPESA', DATE '2026-03-01');
  IF v_previa.linha_codigo <> '6.2' THEN
    RAISE EXCEPTION 'Competencia anterior deveria manter 6.2; veio %.', v_previa.linha_codigo;
  END IF;

  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(v_conta, 'DESPESA', DATE '2026-08-01');
  IF v_previa.linha_codigo <> '6.3' THEN
    RAISE EXCEPTION 'Competencia nova deveria usar 6.3; veio %.', v_previa.linha_codigo;
  END IF;

  -- Uma vigencia nova nao pode comecar antes de uma ja registrada.
  SELECT versao_registro INTO v_versao FROM public.planosdecontagrupos WHERE id = v_grupo;
  BEGIN
    PERFORM public.plano_contas_salvar_grupo(
      v_grupo, 'ZZF3', 'Grupo personalizado da Fase 3', 'teste', true, v_despesa_adm,
      v_versao, DATE '2026-04-01', NULL, NULL);
    v_aceitou := true;
  EXCEPTION WHEN sqlstate 'PT422' THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Vigencia retroativa por cima de uma regra existente foi aceita.';
  END IF;

  -- ------------------------------------------------- protecao do grupo
  SELECT versao_registro INTO v_versao FROM public.planosdecontagrupos WHERE id = v_grupo;
  BEGIN
    PERFORM public.plano_contas_salvar_grupo(
      v_grupo, 'ZZF3', 'Grupo personalizado da Fase 3', 'teste', false, v_despesa_pes,
      v_versao, DATE '2026-08-01', NULL, NULL);
    v_aceitou := true;
  EXCEPTION WHEN sqlstate 'PT422' THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Inativar grupo com contas ativas foi aceito.';
  END IF;

  -- Grupo do sistema nao muda de finalidade.
  UPDATE public.planosdecontagrupos
     SET origem_cadastro = 'SISTEMA', codigo_sistema = 'ZZ_TESTE_SISTEMA'
   WHERE id = v_grupo;
  SELECT versao_registro INTO v_versao FROM public.planosdecontagrupos WHERE id = v_grupo;
  BEGIN
    PERFORM public.plano_contas_salvar_grupo(
      v_grupo, 'ZZF3', 'Grupo renomeado localmente', 'teste', true, v_transferencia,
      v_versao, DATE '2026-08-01', NULL, NULL);
    v_aceitou := true;
  EXCEPTION WHEN sqlstate 'PT422' THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Grupo do sistema aceitou mudanca de finalidade.';
  END IF;

  -- Renomear um grupo do sistema continua permitido: nome e apresentacao.
  PERFORM public.plano_contas_salvar_grupo(
    v_grupo, 'ZZF3', 'Grupo renomeado localmente', 'teste', true, v_despesa_pes,
    v_versao, DATE '2026-08-01', NULL, NULL);
  UPDATE public.planosdecontagrupos
     SET origem_cadastro = 'PERSONALIZADO', codigo_sistema = NULL WHERE id = v_grupo;

  -- Conta patrimonial, para a visao explicar a exclusao.
  v_json := public.plano_contas_salvar_grupo(
    NULL, 'ZZF3T', 'Transferencias da Fase 3', NULL, true, v_transferencia,
    NULL, DATE '2026-01-01', NULL, NULL);
  v_json := public.plano_contas_salvar_conta(
    NULL, 'ZZF3T.1', 'Transferencia entre contas', NULL, true, (v_json ->> 'id')::integer, NULL,
    NULL, DATE '2026-01-01', NULL, NULL);
  v_conta_patrimonial := (v_json ->> 'id')::integer;

  -- ------------------------------------------------- uso do cadastro
  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  SELECT id INTO v_categoria FROM public.categoriatransacao ORDER BY id LIMIT 1;

  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 90, now(), TIMESTAMPTZ '2026-08-20', v_banco, v_conta, v_categoria,
          'ZZF3 despesa', 'FIXTURE F3', '00000000000')
  RETURNING id INTO v_tx;

  SELECT * INTO v_uso FROM public.plano_contas_uso_da_conta(v_conta);
  IF v_uso.transacoes <> 1 THEN
    RAISE EXCEPTION 'O uso da conta deveria contar 1 transacao; contou %.', v_uso.transacoes;
  END IF;

  -- --------------------------------------- bloqueio so vale em modo ativo
  -- Em LEGADO, o financeiro continua lancando como sempre lancou.
  v_json := public.plano_contas_salvar_conta(
    NULL, 'ZZF3.9', 'Conta de receita', NULL, true, v_grupo, NULL,
    NULL, DATE '2026-01-01', NULL, NULL);
  v_grupo_receita := (v_json ->> 'id')::integer;

  v_json := public.plano_contas_salvar_grupo(
    NULL, 'ZZF3R', 'Grupo de receita da Fase 3', NULL, true, v_receita,
    NULL, DATE '2026-01-01', NULL, NULL);
  v_conta_receita := (v_json ->> 'id')::integer;
  v_json := public.plano_contas_salvar_conta(
    NULL, 'ZZF3R.1', 'Servico da Fase 3', NULL, true, v_conta_receita, NULL,
    NULL, DATE '2026-01-01', NULL, NULL);
  v_conta_receita := (v_json ->> 'id')::integer;

  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 10, now(), TIMESTAMPTZ '2026-08-20', v_banco, v_conta_receita, v_categoria,
          'ZZF3 despesa em conta de receita', 'FIXTURE F3', '00000000000');

  -- Em ATIVO, a mesma gravacao e recusada pelo banco. Vigencia no futuro para
  -- exercitar a guarda de escrita sem exigir o congelamento do historico.
  UPDATE public.dre_implantacao
     SET estado = 'ATIVO', vigencia_inicio = DATE '2099-01-01',
         versao_catalogo = 1,
         template_id = (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1),
         ativado_em = now();

  BEGIN
    INSERT INTO public.transacao
      (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
       descricao, nomepagador, cpfcnpjpagador)
    VALUES ('DESPESA', 10, now(), TIMESTAMPTZ '2026-08-20', v_banco, v_conta_receita, v_categoria,
            'ZZF3 recusada', 'FIXTURE F3', '00000000000');
    v_aceitou := true;
  EXCEPTION WHEN sqlstate 'PT422' THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Despesa em conta de receita foi aceita em modo ativo.';
  END IF;

  -- Receita na mesma conta passa: a guarda confere natureza, nao a conta.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('RECEITA', 10, now(), TIMESTAMPTZ '2026-08-20', v_banco, v_conta_receita, v_categoria,
          'ZZF3 aceita', 'FIXTURE F3', '00000000000');

  -- Transferencia nao tem natureza de resultado a conferir.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('SAQUE', 10, now(), TIMESTAMPTZ '2026-08-20', v_banco, v_conta_receita, v_categoria,
          'ZZF3 saque', 'FIXTURE F3', '00000000000');

  UPDATE public.dre_implantacao
     SET estado = 'LEGADO', vigencia_inicio = NULL, ativado_em = NULL;

  -- ------------------------------------------------- visao da tela
  -- A explicacao mostrada tem de vir da mesma resolucao da soma. Conferir o
  -- destino aqui e o que impede a tela de prometer uma linha e a DRE somar em
  -- outra.
  SELECT * INTO v_visao
    FROM public.plano_contas_visao(DATE '2026-08-15') v WHERE v.conta_id = v_conta;
  IF v_visao.situacao <> 'CLASSIFICADO' OR v_visao.linha_codigo <> '6.3' THEN
    RAISE EXCEPTION 'Visao da conta deveria dizer 6.3 CLASSIFICADO; veio % / %.',
      v_visao.situacao, v_visao.linha_codigo;
  END IF;
  IF v_visao.classificacao_especifica IS NOT NULL THEN
    RAISE EXCEPTION 'Conta sem excecao nao deveria exibir classificacao especifica.';
  END IF;
  IF v_visao.classificacao_origem <> 'GRUPO' THEN
    RAISE EXCEPTION 'A visao deveria dizer que a classificacao veio do grupo; veio %.',
      v_visao.classificacao_origem;
  END IF;
  IF v_visao.conta_origem <> 'PERSONALIZADO' THEN
    RAISE EXCEPTION 'A conta criada pela oficina deveria aparecer como PERSONALIZADO.';
  END IF;
  IF v_visao.transacoes <> 1 THEN
    RAISE EXCEPTION 'A visao deveria contar 1 transacao; contou %.', v_visao.transacoes;
  END IF;

  -- Conta patrimonial explica por que fica fora, em vez de aparecer sem destino.
  SELECT * INTO v_visao
    FROM public.plano_contas_visao(DATE '2026-08-15') v WHERE v.conta_id = v_conta_patrimonial;
  IF v_visao.situacao <> 'EXCLUIDO' OR v_visao.motivo IS NULL THEN
    RAISE EXCEPTION 'Conta patrimonial deveria aparecer EXCLUIDO com motivo; veio % / %.',
      v_visao.situacao, v_visao.motivo;
  END IF;

  -- Grupo ainda sem classificacao aparece como pendencia, nao some da lista.
  v_json := public.plano_contas_salvar_grupo(
    NULL, 'ZZF3P', 'Grupo pendente da Fase 3', NULL, true, NULL,
    NULL, DATE '2026-01-01', NULL, NULL);
  SELECT * INTO v_visao_grupo
    FROM public.plano_contas_grupos_visao(DATE '2026-08-15') v
   WHERE v.grupo_id = (v_json ->> 'id')::integer;
  IF v_visao_grupo.situacao <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Grupo sem classificacao deveria aparecer PENDENTE; veio %.', v_visao_grupo.situacao;
  END IF;
  IF v_visao_grupo.contas <> 0 THEN
    RAISE EXCEPTION 'Grupo novo deveria aparecer com zero contas.';
  END IF;

  RAISE NOTICE 'Cadastro atomico e bloqueio: todas as verificacoes passaram.';
END
$test$;

ROLLBACK;
