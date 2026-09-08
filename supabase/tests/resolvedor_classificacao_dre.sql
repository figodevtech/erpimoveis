-- Regressao transacional da Fase 2: resolucao canonica da classificacao.
--
-- Usa fixtures proprias — grupo, contas e transacoes criados aqui — para nao
-- depender das quantidades reais de OS e clientes de cada banco.
BEGIN;

DO $test$
DECLARE
  v_template     integer;
  v_grupo        integer;
  v_conta_ok     integer;
  v_conta_excec  integer;
  v_conta_patri  integer;
  v_conta_solta  integer;
  v_grupo_sem    integer;
  v_banco        bigint;
  v_categoria    integer;
  v_tx           bigint;
  v_evento       bigint;
  v_evento_excl  bigint;
  v_evento_incomp bigint;
  v_evento_solto bigint;
  v_receita      integer;
  v_despesa_adm  integer;
  v_transferencia integer;
  v_resolucao    record;
  v_previa       record;
  v_linha_62     integer;
  v_linha_12     integer;
  v_congelados   integer;
  v_total        numeric;
  v_antes        numeric;
  v_aceitou      boolean;
  v_voltas       integer;
BEGIN
  SELECT id INTO v_template FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1;
  SELECT id INTO v_receita FROM public.classificacoes_resultado WHERE codigo = 'RECEITA_SERVICOS';
  SELECT id INTO v_despesa_adm FROM public.classificacoes_resultado WHERE codigo = 'DESPESA_ADMINISTRATIVA';
  SELECT id INTO v_transferencia FROM public.classificacoes_resultado WHERE codigo = 'TRANSFERENCIA_INTERNA';
  SELECT id INTO v_linha_62 FROM public.dre_linha WHERE template_id = v_template AND codigo = '6.2';
  SELECT id INTO v_linha_12 FROM public.dre_linha WHERE template_id = v_template AND codigo = '1.2';

  -- ----------------------------------------------------------------- fixtures
  INSERT INTO public.planosdecontagrupos (codigo, nome, classificacao_padrao_id)
  VALUES ('ZZRES', 'Grupo de teste do resolvedor', v_despesa_adm)
  RETURNING id INTO v_grupo;

  INSERT INTO public.planosdeconta (codigo, nome, grupo_id)
  VALUES ('ZZRES.1', 'Conta herdando o grupo', v_grupo) RETURNING id INTO v_conta_ok;

  INSERT INTO public.planosdeconta (codigo, nome, grupo_id, classificacao_especifica_id)
  VALUES ('ZZRES.2', 'Conta com excecao', v_grupo, v_receita) RETURNING id INTO v_conta_excec;

  INSERT INTO public.planosdeconta (codigo, nome, grupo_id, classificacao_especifica_id)
  VALUES ('ZZRES.3', 'Conta patrimonial', v_grupo, v_transferencia) RETURNING id INTO v_conta_patri;

  INSERT INTO public.planosdecontagrupos (codigo, nome)
  VALUES ('ZZSEM', 'Grupo sem classificacao') RETURNING id INTO v_grupo_sem;
  INSERT INTO public.planosdeconta (codigo, nome, grupo_id)
  VALUES ('ZZSEM.1', 'Conta sem destino', v_grupo_sem) RETURNING id INTO v_conta_solta;

  -- ------------------------------------------- precedencia sobre o cadastro
  SELECT * INTO v_resolucao
    FROM public.dre_classificacao_do_cadastro(v_conta_ok, NULL, DATE '2026-08-15');
  IF v_resolucao.classificacao_id <> v_despesa_adm OR v_resolucao.origem <> 'GRUPO' THEN
    RAISE EXCEPTION 'Conta sem excecao deveria herdar o grupo; veio % / %.',
      v_resolucao.classificacao_id, v_resolucao.origem;
  END IF;

  SELECT * INTO v_resolucao
    FROM public.dre_classificacao_do_cadastro(v_conta_excec, NULL, DATE '2026-08-15');
  IF v_resolucao.classificacao_id <> v_receita OR v_resolucao.origem <> 'CONTA' THEN
    RAISE EXCEPTION 'Excecao da conta deveria prevalecer sobre o grupo.';
  END IF;

  -- Regra com vigencia vence o campo do cadastro: e ela que sabe a competencia.
  INSERT INTO public.plano_contas_classificacao_regra
    (conta_id, classificacao_id, vigencia_inicio, vigencia_fim, versao_catalogo, origem_regra)
  VALUES (v_conta_ok, v_receita, DATE '2026-01-01', DATE '2026-07-01', 1, 'MIGRACAO');

  SELECT * INTO v_resolucao
    FROM public.dre_classificacao_do_cadastro(v_conta_ok, NULL, DATE '2026-03-10');
  IF v_resolucao.classificacao_id <> v_receita OR v_resolucao.origem <> 'CONTA' THEN
    RAISE EXCEPTION 'Regra vigente da conta deveria prevalecer na competencia coberta.';
  END IF;

  -- Fim exclusivo: 2026-07-01 ja esta fora da regra acima.
  SELECT * INTO v_resolucao
    FROM public.dre_classificacao_do_cadastro(v_conta_ok, NULL, DATE '2026-07-01');
  IF v_resolucao.classificacao_id <> v_despesa_adm THEN
    RAISE EXCEPTION 'A vigencia deveria terminar antes de 2026-07-01 (fim exclusivo).';
  END IF;

  -- Nada para o cadastro sem classificacao nenhuma.
  SELECT * INTO v_resolucao
    FROM public.dre_classificacao_do_cadastro(v_conta_solta, NULL, DATE '2026-08-15');
  IF v_resolucao.classificacao_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cadastro sem classificacao nao pode receber uma por aproximacao.';
  END IF;

  -- ------------------------------------------------------------ previa
  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(v_conta_ok, 'DESPESA', DATE '2026-08-15', v_template);
  IF v_previa.resultado <> 'CLASSIFICADO' OR v_previa.linha_codigo <> '6.2' THEN
    RAISE EXCEPTION 'Previa deveria levar a 6.2; veio % / %.', v_previa.resultado, v_previa.linha_codigo;
  END IF;

  -- Despesa numa conta de receita: bloqueada antes de gravar, com explicacao.
  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(v_conta_excec, 'DESPESA', DATE '2026-08-15', v_template);
  IF v_previa.resultado <> 'INCOMPATIVEL' THEN
    RAISE EXCEPTION 'Despesa em conta de receita deveria ser incompativel; veio %.', v_previa.resultado;
  END IF;

  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(v_conta_patri, 'DESPESA', DATE '2026-08-15', v_template);
  IF v_previa.resultado <> 'EXCLUIDO' OR v_previa.motivo IS NULL THEN
    RAISE EXCEPTION 'Conta patrimonial deveria sair como EXCLUIDO com motivo.';
  END IF;

  SELECT * INTO v_previa
    FROM public.dre_previa_da_conta(v_conta_solta, 'DESPESA', DATE '2026-08-15', v_template);
  IF v_previa.resultado <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Conta sem classificacao deveria sair como PENDENTE.';
  END IF;

  -- ------------------------------------------------- resolucao de eventos
  SELECT id INTO v_banco FROM public.bancoconta ORDER BY id LIMIT 1;
  SELECT id INTO v_categoria FROM public.categoriatransacao ORDER BY id LIMIT 1;
  IF v_banco IS NULL THEN
    RAISE EXCEPTION 'O teste exige ao menos uma conta bancaria cadastrada.';
  END IF;

  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id, descricao,
     nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 100, now(), TIMESTAMPTZ '2026-08-15', v_banco, v_conta_ok, v_categoria,
          'ZZRES despesa', 'FIXTURE RESOLVEDOR', '00000000000')
  RETURNING id INTO v_tx;

  INSERT INTO public.eventos_financeiros
    (origem, natureza, valor, chave_origem, status, source_type, source_id,
     competencia_em, natureza_dre, is_manual, descricao)
  VALUES ('AVULSO', 'DESPESA', 100, 'zzres-1', 'ATIVO', 'TRANSACAO', v_tx,
          TIMESTAMPTZ '2026-08-15', 'DESPESA', true, 'ZZRES despesa avulsa')
  RETURNING id INTO v_evento;

  SELECT * INTO v_resolucao FROM public.dre_resolver_evento(v_evento, v_template);
  IF v_resolucao.resultado <> 'CLASSIFICADO' OR v_resolucao.linha_id <> v_linha_62 THEN
    RAISE EXCEPTION 'Evento avulso deveria resolver para 6.2; veio % / %.',
      v_resolucao.resultado, v_resolucao.linha_id;
  END IF;
  IF v_resolucao.origem_resolucao <> 'GRUPO' THEN
    RAISE EXCEPTION 'A resolucao deveria vir do grupo; veio %.', v_resolucao.origem_resolucao;
  END IF;

  -- Natureza incompativel nao vira linha, vira pendencia com motivo.
  UPDATE public.transacao SET plano_de_conta_id = v_conta_excec WHERE id = v_tx;
  SELECT * INTO v_resolucao FROM public.dre_resolver_evento(v_evento, v_template);
  IF v_resolucao.resultado <> 'PENDENTE' OR v_resolucao.motivo IS NULL THEN
    RAISE EXCEPTION 'Despesa em conta de receita deveria virar PENDENTE com motivo.';
  END IF;
  IF v_resolucao.linha_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pendencia por natureza incompativel nao pode carregar linha.';
  END IF;

  -- Patrimonial sai como exclusao explicita, nao como pendencia.
  UPDATE public.transacao SET plano_de_conta_id = v_conta_patri WHERE id = v_tx;
  SELECT * INTO v_resolucao FROM public.dre_resolver_evento(v_evento, v_template);
  IF v_resolucao.resultado <> 'EXCLUIDO' OR v_resolucao.motivo IS NULL THEN
    RAISE EXCEPTION 'Conta patrimonial deveria resolver como EXCLUIDO com motivo.';
  END IF;

  -- Origem automatica vence o cadastro: receber nao reclassifica a receita.
  INSERT INTO public.eventos_financeiros
    (origem, natureza, valor, chave_origem, status, source_type, source_id,
     competencia_em, natureza_dre, descricao)
  VALUES ('SERVICO', 'RECEITA', 250, 'zzres-2', 'ATIVO', 'TRANSACAO', v_tx,
          TIMESTAMPTZ '2026-08-15', 'RECEITA', 'ZZRES receita de servico')
  RETURNING id INTO v_evento_excl;

  SELECT * INTO v_resolucao FROM public.dre_resolver_evento(v_evento_excl, v_template);
  IF v_resolucao.origem_resolucao <> 'ORIGEM_EVENTO' OR v_resolucao.linha_id <> v_linha_12 THEN
    RAISE EXCEPTION 'Evento de servico deveria resolver por origem para 1.2; veio % / %.',
      v_resolucao.origem_resolucao, v_resolucao.linha_id;
  END IF;

  -- Evento sem conta nenhuma vira pendencia, nao "outras despesas".
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, categoria_id, descricao,
     nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 40, now(), TIMESTAMPTZ '2026-08-15', v_banco, v_categoria,
          'ZZRES sem conta', 'FIXTURE RESOLVEDOR', '00000000000')
  RETURNING id INTO v_tx;
  INSERT INTO public.eventos_financeiros
    (origem, natureza, valor, chave_origem, status, source_type, source_id,
     competencia_em, natureza_dre, is_manual, descricao)
  VALUES ('AVULSO', 'DESPESA', 40, 'zzres-3', 'ATIVO', 'TRANSACAO', v_tx,
          TIMESTAMPTZ '2026-08-15', 'DESPESA', true, 'ZZRES sem conta')
  RETURNING id INTO v_evento_solto;

  SELECT * INTO v_resolucao FROM public.dre_resolver_evento(v_evento_solto, v_template);
  IF v_resolucao.resultado <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Evento sem conta deveria virar PENDENTE; veio %.', v_resolucao.resultado;
  END IF;

  -- --------------------------------------------------- gravacao da revisao
  PERFORM public.dre_gravar_classificacao_evento(v_evento_excl, v_template);
  SELECT count(*) INTO v_congelados
    FROM public.eventos_financeiros_classificacao
   WHERE evento_id = v_evento_excl AND vigente;
  IF v_congelados <> 1 THEN
    RAISE EXCEPTION 'Deveria existir uma revisao vigente; achei %.', v_congelados;
  END IF;

  -- A projecao acompanha a revisao na mesma operacao.
  IF (SELECT dre_linha_id FROM public.eventos_financeiros WHERE id = v_evento_excl) <> v_linha_12 THEN
    RAISE EXCEPTION 'A projecao dre_linha_id nao acompanhou a revisao.';
  END IF;

  -- Gravar de novo troca a vigente e preserva a anterior, encadeada.
  PERFORM public.dre_gravar_classificacao_evento(v_evento_excl, v_template);
  SELECT count(*) INTO v_congelados
    FROM public.eventos_financeiros_classificacao WHERE evento_id = v_evento_excl;
  IF v_congelados <> 2 THEN
    RAISE EXCEPTION 'A revisao anterior deveria ser preservada; achei % no total.', v_congelados;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.eventos_financeiros_classificacao
     WHERE evento_id = v_evento_excl AND vigente AND reclassificacao_de_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A revisao nova deveria apontar para a anterior.';
  END IF;

  -- --------------------------------------------------- congelamento do legado
  SELECT public.dre_congelar_classificacao_legado(v_template, 500) INTO v_congelados;
  IF v_congelados < 1 THEN
    RAISE EXCEPTION 'O congelamento nao processou nenhum evento.';
  END IF;

  -- Congelar nao pode ter mexido em valor nem em competencia.
  IF EXISTS (
    SELECT 1 FROM public.eventos_financeiros WHERE id = v_evento_excl AND valor <> 250) THEN
    RAISE EXCEPTION 'O congelamento alterou o valor de um evento.';
  END IF;

  -- Ativar com congelamento pela metade e o erro que derruba um total inteiro
  -- sem avisar. O banco recusa.
  IF EXISTS (
    SELECT 1 FROM public.eventos_financeiros e
     WHERE e.status IN ('ATIVO', 'CONVERTIDO') AND e.competencia_em IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.eventos_financeiros_classificacao ec
                        WHERE ec.evento_id = e.id AND ec.vigente)
  ) THEN
    BEGIN
      UPDATE public.dre_implantacao
         SET estado = 'ATIVO', vigencia_inicio = DATE '2000-01-01',
             versao_catalogo = 1, template_id = v_template, ativado_em = now();
      v_aceitou := true;
    EXCEPTION WHEN check_violation THEN
      v_aceitou := false;
    END;
    IF v_aceitou THEN
      RAISE EXCEPTION 'Ativacao foi aceita com eventos ainda sem classificacao vigente.';
    END IF;
  END IF;

  -- Retomavel: cada chamada avanca ate zerar, e a chamada seguinte nao repete.
  v_voltas := 0;
  LOOP
    SELECT public.dre_congelar_classificacao_legado(v_template, 2000) INTO v_congelados;
    EXIT WHEN v_congelados = 0;
    v_voltas := v_voltas + 1;
    IF v_voltas > 200 THEN
      RAISE EXCEPTION 'O congelamento nao converge: 200 lotes sem terminar.';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.eventos_financeiros e
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND NOT EXISTS (SELECT 1 FROM public.eventos_financeiros_classificacao ec
                        WHERE ec.evento_id = e.id AND ec.vigente)
  ) THEN
    RAISE EXCEPTION 'Sobrou evento sem classificacao vigente depois do congelamento.';
  END IF;

  -- Uma revisao vigente por evento, nunca duas.
  IF EXISTS (
    SELECT 1 FROM public.eventos_financeiros_classificacao
     WHERE vigente GROUP BY evento_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Evento com mais de uma revisao vigente.';
  END IF;

  -- ------------------------------------------------------- soma por modo
  SELECT coalesce(sum(valor), 0) INTO v_antes
    FROM public.dre_somar_por_linha(v_template, TIMESTAMPTZ '2026-08-01', TIMESTAMPTZ '2026-08-31 23:59:59');

  -- Ativar com vigencia no meio do periodo: o mes passa a combinar os dois
  -- modelos. O total nao pode mudar, porque o congelamento preservou o legado.
  UPDATE public.dre_implantacao
     SET estado = 'ATIVO',
         vigencia_inicio = DATE '2026-08-10',
         versao_catalogo = 1,
         template_id = v_template,
         ativado_em = now();

  SELECT coalesce(sum(valor), 0) INTO v_total
    FROM public.dre_somar_por_linha(v_template, TIMESTAMPTZ '2026-08-01', TIMESTAMPTZ '2026-08-31 23:59:59');

  IF v_total <> v_antes THEN
    RAISE EXCEPTION
      'Ativar mudou o total do periodo misto: antes %, depois %.', v_antes, v_total;
  END IF;

  -- O mesmo para o historico inteiro, nao so para o mes das fixtures.
  SELECT coalesce(sum(valor), 0) INTO v_total
    FROM public.dre_somar_por_linha(v_template, TIMESTAMPTZ '2000-01-01', TIMESTAMPTZ '2100-01-01');
  UPDATE public.dre_implantacao SET estado = 'LEGADO', vigencia_inicio = NULL, ativado_em = NULL;
  SELECT coalesce(sum(valor), 0) INTO v_antes
    FROM public.dre_somar_por_linha(v_template, TIMESTAMPTZ '2000-01-01', TIMESTAMPTZ '2100-01-01');
  IF v_total <> v_antes THEN
    RAISE EXCEPTION 'Legado e ativo divergem no historico: % contra %.', v_antes, v_total;
  END IF;


  -- ------------------------------------------- falta de configuracao aborta
  DELETE FROM public.dre_implantacao;
  BEGIN
    PERFORM * FROM public.dre_somar_por_linha(v_template, TIMESTAMPTZ '2026-08-01', TIMESTAMPTZ '2026-08-31');
    v_aceitou := true;
  EXCEPTION WHEN OTHERS THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Sem registro de implantacao a soma deveria abortar, nao assumir legado.';
  END IF;

  -- Devolve o registro: as verificacoes seguintes rodam na mesma transacao e
  -- um banco sem implantacao faria a guarda de gravacao abortar por outro
  -- motivo, escondendo o que elas testam.
  INSERT INTO public.dre_implantacao (estado, observacao)
  VALUES ('LEGADO', 'Restaurado pelo teste do resolvedor.');

  RAISE NOTICE 'Resolvedor de classificacao: todas as verificacoes passaram.';
END
$test$;

ROLLBACK;
