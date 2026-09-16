-- Regressao transacional: linha da DRE por plano de conta, valendo em LEGADO.
--
-- Fixtures proprias: dois grupos com mapeamento antigo (um que soma na 6.6, um
-- fora do resultado), tres contas e quatro transacoes. Cada passo muda a
-- classificacao pela RPC da tela e confere o evento que a DRE soma.
BEGIN;

DO $test$
DECLARE
  v_template    integer;
  v_banco       bigint;
  v_categoria   integer;
  v_grupo       integer;
  v_grupo_fora  integer;
  v_conta       integer;
  v_conta2      integer;
  v_conta_fora  integer;
  v_tx_jul      bigint;
  v_tx_set      bigint;
  v_tx2         bigint;
  v_tx_fora     bigint;
  v_linha_62    integer;
  v_linha_63    integer;
  v_linha_66    integer;
  v_linha_112   integer;
  v_linha_131   integer;
  c_irpj        integer;
  c_adm         integer;
  c_pessoal     integer;
  c_outra       integer;
  c_transf      integer;
  c_perda       integer;
  c_receita     integer;
  v_versao      integer;
  v_regras      integer;
  v_linha       integer;
  v_status      text;
  v_visao       record;
  v_previa      record;
  v_aceitou     boolean;
BEGIN
  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1;
  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  SELECT id INTO v_categoria FROM public.categoriatransacao ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN
    RAISE EXCEPTION 'O teste exige ao menos uma conta bancaria cadastrada.';
  END IF;

  SELECT id INTO v_linha_62  FROM public.dre_linha WHERE template_id = v_template AND codigo = '6.2';
  SELECT id INTO v_linha_63  FROM public.dre_linha WHERE template_id = v_template AND codigo = '6.3';
  SELECT id INTO v_linha_66  FROM public.dre_linha WHERE template_id = v_template AND codigo = '6.6';
  SELECT id INTO v_linha_112 FROM public.dre_linha WHERE template_id = v_template AND codigo = '11.2';
  SELECT id INTO v_linha_131 FROM public.dre_linha WHERE template_id = v_template AND codigo = '13.1';

  SELECT id INTO c_irpj    FROM public.classificacoes_resultado WHERE codigo = 'IRPJ_RESULTADO';
  SELECT id INTO c_adm     FROM public.classificacoes_resultado WHERE codigo = 'DESPESA_ADMINISTRATIVA';
  SELECT id INTO c_pessoal FROM public.classificacoes_resultado WHERE codigo = 'DESPESA_PESSOAL';
  SELECT id INTO c_outra   FROM public.classificacoes_resultado WHERE codigo = 'DESPESA_OPERACIONAL_OUTRA';
  SELECT id INTO c_transf  FROM public.classificacoes_resultado WHERE codigo = 'TRANSFERENCIA_INTERNA';
  SELECT id INTO c_perda   FROM public.classificacoes_resultado WHERE codigo = 'OUTRA_PERDA';
  SELECT id INTO c_receita FROM public.classificacoes_resultado WHERE codigo = 'RECEITA_SERVICOS';

  -- ----------------------------------------------------------------- fixtures
  INSERT INTO public.planosdecontagrupos (codigo, nome)
  VALUES ('ZZLD', 'Grupo legado da linha por conta') RETURNING id INTO v_grupo;
  INSERT INTO public.dre_mapeamento (template_id, origem_tipo, origem_id, linha_id, ativo, observacao)
  VALUES (v_template, 'PLANO_GRUPO', v_grupo, v_linha_66, true, 'Fixture: mapeamento antigo.');

  INSERT INTO public.planosdeconta (codigo, nome, grupo_id)
  VALUES ('ZZLD.1', 'Conta que muda de linha', v_grupo) RETURNING id INTO v_conta;
  INSERT INTO public.planosdeconta (codigo, nome, grupo_id)
  VALUES ('ZZLD.2', 'Conta que segue o grupo', v_grupo) RETURNING id INTO v_conta2;

  INSERT INTO public.planosdecontagrupos (codigo, nome)
  VALUES ('ZZLDX', 'Grupo legado fora do resultado') RETURNING id INTO v_grupo_fora;
  INSERT INTO public.dre_mapeamento (template_id, origem_tipo, origem_id, exclui_do_resultado, ativo, observacao)
  VALUES (v_template, 'PLANO_GRUPO', v_grupo_fora, true, true, 'Fixture: fora do resultado.');
  INSERT INTO public.planosdeconta (codigo, nome, grupo_id)
  VALUES ('ZZLDX.1', 'Despesa nao identificada de teste', v_grupo_fora) RETURNING id INTO v_conta_fora;

  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 700, TIMESTAMPTZ '2026-07-10', TIMESTAMPTZ '2026-07-10', v_banco, v_conta,
          v_categoria, 'ZZLD julho', 'FIXTURE LD', '00000000000')
  RETURNING id INTO v_tx_jul;

  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 900, TIMESTAMPTZ '2026-09-10', TIMESTAMPTZ '2026-09-10', v_banco, v_conta,
          v_categoria, 'ZZLD setembro', 'FIXTURE LD', '00000000000')
  RETURNING id INTO v_tx_set;

  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 300, TIMESTAMPTZ '2026-07-15', TIMESTAMPTZ '2026-07-15', v_banco, v_conta2,
          v_categoria, 'ZZLD irma', 'FIXTURE LD', '00000000000')
  RETURNING id INTO v_tx2;

  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 1234, TIMESTAMPTZ '2026-08-05', TIMESTAMPTZ '2026-08-05', v_banco, v_conta_fora,
          v_categoria, 'ZZLD nao identificada', 'FIXTURE LD', '00000000000')
  RETURNING id INTO v_tx_fora;

  -- ------------------------------------------ sem classificacao, nada muda
  SELECT dre_linha_id, status INTO v_linha, v_status
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx_jul;
  IF v_linha IS DISTINCT FROM v_linha_66 OR v_status <> 'ATIVO' THEN
    RAISE EXCEPTION 'Sem classificacao, a conta deveria seguir o mapeamento antigo (6.6); veio % / %.',
      v_linha, v_status;
  END IF;

  IF EXISTS (SELECT 1 FROM public.eventos_financeiros
              WHERE source_type = 'TRANSACAO' AND source_id = v_tx_fora AND status = 'ATIVO') THEN
    RAISE EXCEPTION 'Grupo antigo fora do resultado deveria continuar sem evento.';
  END IF;

  -- A tela diz o que a DRE soma: pelo grupo, nao "sem classificacao".
  SELECT * INTO v_visao FROM public.plano_contas_visao(NULL) v WHERE v.conta_id = v_conta;
  IF v_visao.situacao <> 'CLASSIFICADO' OR v_visao.linha_codigo <> '6.6'
     OR v_visao.classificacao_origem <> 'MAPEAMENTO_GRUPO' THEN
    RAISE EXCEPTION 'Visao da conta legada deveria dizer 6.6 pelo mapeamento; veio % / % / %.',
      v_visao.situacao, v_visao.linha_codigo, v_visao.classificacao_origem;
  END IF;

  SELECT * INTO v_visao FROM public.plano_contas_grupos_visao(NULL) v WHERE v.grupo_id = v_grupo;
  IF v_visao.situacao <> 'CLASSIFICADO' OR v_visao.linha_codigo <> '6.6' THEN
    RAISE EXCEPTION 'Visao do grupo legado deveria dizer 6.6; veio % / %.', v_visao.situacao, v_visao.linha_codigo;
  END IF;

  IF EXISTS (SELECT 1 FROM public.dre_pendencias_itens('CONTA_SEM_REGRA', now(), now(), 500) i
              WHERE i.referencia_id IN (v_conta, v_conta2, v_conta_fora)) THEN
    RAISE EXCEPTION 'Conta com destino pelo grupo nao e pendencia de cadastro.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dre_pendencias_itens('GRUPO_SEM_DESTINO', now(), now(), 500) i
              WHERE i.referencia_id IN (v_grupo, v_grupo_fora)) THEN
    RAISE EXCEPTION 'Grupo com mapeamento antigo nao e grupo sem destino.';
  END IF;

  -- ------------------------------ classificar o grupo com a mesma linha
  SELECT versao_registro INTO v_versao FROM public.planosdecontagrupos WHERE id = v_grupo;
  PERFORM public.plano_contas_salvar_grupo(
    v_grupo, 'ZZLD', 'Grupo legado da linha por conta', NULL, true, c_outra, v_versao, NULL, NULL, NULL);

  IF (SELECT vigencia_inicio FROM public.plano_contas_classificacao_regra WHERE grupo_id = v_grupo)
       <> public.plano_contas_inicio_do_historico() THEN
    RAISE EXCEPTION 'Vigencia em branco deveria gravar a regra desde o inicio do historico.';
  END IF;

  SELECT dre_linha_id INTO v_linha
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx_jul;
  IF v_linha IS DISTINCT FROM v_linha_66 THEN
    RAISE EXCEPTION 'Classificar o grupo na mesma linha nao pode mover o evento; veio %.', v_linha;
  END IF;

  -- --------------- excecao de outra familia, historico inteiro, na hora
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta;
  BEGIN
    PERFORM public.plano_contas_salvar_conta(
      v_conta, 'ZZLD.1', 'Conta que muda de linha', NULL, true, v_grupo, c_irpj, v_versao, NULL, NULL, NULL);
    v_aceitou := true;
  EXCEPTION WHEN sqlstate 'PT422' THEN
    v_aceitou := false;
  END;
  IF NOT v_aceitou THEN
    RAISE EXCEPTION 'Excecao de outra familia deveria ser aceita: a conta escolhe a propria linha.';
  END IF;

  SELECT dre_linha_id INTO v_linha
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx_jul;
  IF v_linha IS DISTINCT FROM v_linha_131 THEN
    RAISE EXCEPTION 'O lancamento de julho deveria ter ido para 13.1 na mesma operacao; veio %.', v_linha;
  END IF;
  SELECT dre_linha_id INTO v_linha
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx2;
  IF v_linha IS DISTINCT FROM v_linha_66 THEN
    RAISE EXCEPTION 'A conta irma nao tem excecao e deveria continuar na 6.6; veio %.', v_linha;
  END IF;

  SELECT * INTO v_visao FROM public.plano_contas_visao(NULL) v WHERE v.conta_id = v_conta;
  IF v_visao.linha_codigo <> '13.1' OR v_visao.classificacao_origem <> 'CONTA' THEN
    RAISE EXCEPTION 'Visao deveria dizer 13.1 pela conta; veio % / %.', v_visao.linha_codigo, v_visao.classificacao_origem;
  END IF;

  -- ------------------------------------------- vigencia "a partir de"
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta;
  PERFORM public.plano_contas_salvar_conta(
    v_conta, 'ZZLD.1', 'Conta que muda de linha', NULL, true, v_grupo, c_adm, v_versao,
    DATE '2026-09-01', NULL, NULL);

  SELECT dre_linha_id INTO v_linha
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx_jul;
  IF v_linha IS DISTINCT FROM v_linha_131 THEN
    RAISE EXCEPTION 'Com data, julho deveria manter 13.1; veio %.', v_linha;
  END IF;
  SELECT dre_linha_id INTO v_linha
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx_set;
  IF v_linha IS DISTINCT FROM v_linha_62 THEN
    RAISE EXCEPTION 'Com data, setembro deveria ir para 6.2; veio %.', v_linha;
  END IF;

  -- ------------------------------ corrigir todo o historico por cima
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta;
  PERFORM public.plano_contas_salvar_conta(
    v_conta, 'ZZLD.1', 'Conta que muda de linha', NULL, true, v_grupo, c_pessoal, v_versao, NULL, NULL, NULL);

  SELECT count(*) INTO v_regras FROM public.plano_contas_classificacao_regra WHERE conta_id = v_conta;
  IF v_regras <> 1 THEN
    RAISE EXCEPTION 'Historico inteiro deveria deixar uma regra so; ficaram %.', v_regras;
  END IF;
  IF EXISTS (SELECT 1 FROM public.eventos_financeiros
              WHERE source_type = 'TRANSACAO' AND source_id IN (v_tx_jul, v_tx_set)
                AND dre_linha_id IS DISTINCT FROM v_linha_63) THEN
    RAISE EXCEPTION 'Historico inteiro deveria levar julho e setembro para 6.3.';
  END IF;

  -- -------------------------------------------- conta patrimonial sai
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta;
  PERFORM public.plano_contas_salvar_conta(
    v_conta, 'ZZLD.1', 'Conta que muda de linha', NULL, true, v_grupo, c_transf, v_versao, NULL, NULL, NULL);

  IF EXISTS (SELECT 1 FROM public.eventos_financeiros
              WHERE source_type = 'TRANSACAO' AND source_id IN (v_tx_jul, v_tx_set) AND status = 'ATIVO') THEN
    RAISE EXCEPTION 'Conta patrimonial deveria cancelar os eventos dela.';
  END IF;
  IF public.transacao_gera_evento_de_resultado(v_tx_jul) THEN
    RAISE EXCEPTION 'Transacao em conta patrimonial nao deveria gerar evento.';
  END IF;

  -- ------------------------------------------------ voltar a herdar
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta;
  PERFORM public.plano_contas_salvar_conta(
    v_conta, 'ZZLD.1', 'Conta que muda de linha', NULL, true, v_grupo, NULL, v_versao, NULL, NULL, NULL);

  SELECT dre_linha_id, status INTO v_linha, v_status
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx_jul;
  IF v_linha IS DISTINCT FROM v_linha_66 OR v_status <> 'ATIVO' THEN
    RAISE EXCEPTION 'Sem excecao, a conta deveria voltar a linha do grupo (6.6) e reativar; veio % / %.',
      v_linha, v_status;
  END IF;

  -- -------------------------- grupo muda, contas que herdam acompanham
  SELECT versao_registro INTO v_versao FROM public.planosdecontagrupos WHERE id = v_grupo;
  PERFORM public.plano_contas_salvar_grupo(
    v_grupo, 'ZZLD', 'Grupo legado da linha por conta', NULL, true, c_adm, v_versao, NULL, NULL, NULL);

  IF EXISTS (SELECT 1 FROM public.eventos_financeiros
              WHERE source_type = 'TRANSACAO' AND source_id IN (v_tx_jul, v_tx_set, v_tx2)
                AND dre_linha_id IS DISTINCT FROM v_linha_62) THEN
    RAISE EXCEPTION 'Trocar a linha do grupo deveria refazer os lancamentos das contas que herdam.';
  END IF;

  -- ------------------- conta de grupo fora do resultado entra como perda
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta_fora;
  PERFORM public.plano_contas_salvar_conta(
    v_conta_fora, 'ZZLDX.1', 'Despesa nao identificada de teste', NULL, true, v_grupo_fora, c_perda,
    v_versao, NULL, NULL, NULL);

  SELECT dre_linha_id, status INTO v_linha, v_status
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx_fora;
  IF v_linha IS DISTINCT FROM v_linha_112 OR v_status IS DISTINCT FROM 'ATIVO' THEN
    RAISE EXCEPTION 'A conta classificada como perda deveria entrar na 11.2; veio % / %.', v_linha, v_status;
  END IF;

  -- --------------------------------------- natureza continua protegida
  SELECT versao_registro INTO v_versao FROM public.planosdeconta WHERE id = v_conta2;
  PERFORM public.plano_contas_salvar_conta(
    v_conta2, 'ZZLD.2', 'Conta que segue o grupo', NULL, true, v_grupo, c_receita, v_versao, NULL, NULL, NULL);

  SELECT dre_linha_id, status INTO v_linha, v_status
    FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = v_tx2;
  IF v_linha IS NOT NULL OR v_status <> 'ATIVO' THEN
    RAISE EXCEPTION 'Despesa em conta de receita deveria ficar ativa e sem linha; veio % / %.', v_linha, v_status;
  END IF;

  SELECT * INTO v_previa FROM public.dre_previa_da_conta(v_conta2, 'DESPESA', DATE '2026-07-15');
  IF v_previa.resultado <> 'INCOMPATIVEL' THEN
    RAISE EXCEPTION 'Previa de despesa em conta de receita deveria ser INCOMPATIVEL; veio %.', v_previa.resultado;
  END IF;

  -- ------------- campo do cadastro so vale para cadastro sem historico
  -- Regra da conta so a partir de setembro e um campo gravado por fora: em
  -- julho quem decide e o grupo, nao o campo.
  UPDATE public.planosdeconta SET classificacao_especifica_id = c_irpj WHERE id = v_conta;
  INSERT INTO public.plano_contas_classificacao_regra
    (conta_id, classificacao_id, vigencia_inicio, versao_catalogo, origem_regra)
  VALUES (v_conta, c_pessoal, DATE '2026-09-01', 1, 'MANUAL');

  IF (SELECT r.classificacao_id FROM public.dre_classificacao_do_cadastro(v_conta, NULL, DATE '2026-07-10') r)
       IS DISTINCT FROM c_adm THEN
    RAISE EXCEPTION 'Antes da primeira regra da conta, deveria valer o grupo, nao o campo do cadastro.';
  END IF;
  IF (SELECT r.classificacao_id FROM public.dre_classificacao_do_cadastro(v_conta, NULL, DATE '2026-09-10') r)
       IS DISTINCT FROM c_pessoal THEN
    RAISE EXCEPTION 'A partir da regra da conta, deveria valer a regra.';
  END IF;

  RAISE NOTICE 'linha_da_dre_por_plano_de_conta: OK';
END;
$test$;

ROLLBACK;
