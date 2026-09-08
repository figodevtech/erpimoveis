-- Regressao transacional da Fase 1: catalogo de classificacao de resultado.
--
-- Confere o que a migration promete: catalogo semeado e coerente, guardas de
-- integridade recusando o que precisa ser recusado, e nenhum efeito sobre a
-- apuracao atual.
BEGIN;

DO $test$
DECLARE
  v_template integer;
  v_classificacao integer;
  v_patrimonial integer;
  v_grupo integer;
  v_conta integer;
  v_evento bigint;
  v_regra integer;
  v_total integer;
  v_aceitou boolean;
  v_linha integer;
BEGIN
  -- ---------------------------------------------------------------- estrutura
  IF to_regclass('public.classificacoes_resultado') IS NULL
     OR to_regclass('public.plano_contas_classificacao_regra') IS NULL
     OR to_regclass('public.eventos_financeiros_classificacao') IS NULL
     OR to_regclass('public.dre_implantacao') IS NULL THEN
    RAISE EXCEPTION 'Estruturas da Fase 1 ausentes.';
  END IF;

  SELECT id INTO v_template FROM public.dre_template
   WHERE codigo = 'PADRAO' AND versao = 1;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'Template PADRAO v1 nao encontrado.';
  END IF;

  -- ------------------------------------------------------------- catalogo
  SELECT count(*) INTO v_total FROM public.classificacoes_resultado;
  IF v_total <> 37 THEN
    RAISE EXCEPTION 'Catalogo deveria ter 37 classificacoes; tem %.', v_total;
  END IF;

  SELECT count(*) INTO v_total
    FROM public.classificacoes_resultado c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.dre_mapeamento m
      WHERE m.origem_tipo = 'CLASSIFICACAO_RESULTADO'
        AND m.classificacao_resultado_id = c.id AND m.ativo);
  IF v_total <> 0 THEN
    RAISE EXCEPTION '% classificacao(oes) sem destino nem exclusao.', v_total;
  END IF;

  -- Destino sempre em linha de DETALHE. Somar num SUBTOTAL ou FORMULA contaria
  -- o valor duas vezes: uma na linha e outra no calculo do pai.
  SELECT count(*) INTO v_total
    FROM public.dre_mapeamento m
    JOIN public.dre_linha l ON l.id = m.linha_id
   WHERE m.origem_tipo = 'CLASSIFICACAO_RESULTADO'
     AND (l.tipo <> 'DETALHE'
          OR EXISTS (SELECT 1 FROM public.dre_linha f WHERE f.parent_id = l.id));
  IF v_total <> 0 THEN
    RAISE EXCEPTION '% destino(s) apontam para linha que nao e de detalhe.', v_total;
  END IF;

  -- ------------------------------------------------------- linhas 11.1 e 11.2
  SELECT count(*) INTO v_total
    FROM public.dre_linha f
    JOIN public.dre_linha p ON p.id = f.parent_id
   WHERE f.template_id = v_template AND p.codigo = '11'
     AND f.codigo IN ('11.1', '11.2');
  IF v_total <> 2 THEN
    RAISE EXCEPTION 'As linhas 11.1 e 11.2 nao estao sob o grupo 11 (achei %).', v_total;
  END IF;

  SELECT sinal INTO v_total FROM public.dre_linha
   WHERE template_id = v_template AND codigo = '11.2';
  IF v_total <> -1 THEN
    RAISE EXCEPTION 'A linha 11.2 deveria subtrair dentro do grupo 11; sinal = %.', v_total;
  END IF;

  -- --------------------------------------------------- coerencia do catalogo
  -- Resultado com motivo de exclusao apagaria a diferenca entre "nao compoe
  -- resultado" e "ainda nao classificado".
  BEGIN
    INSERT INTO public.classificacoes_resultado
      (codigo, nome, descricao, familia, tratamento, naturezas, papel_dre, motivo_exclusao)
    VALUES ('TESTE_INCOERENTE', 'x', 'x', 'DESPESA', 'RESULTADO', ARRAY['DESPESA'], 'DESPESA', 'motivo');
    v_aceitou := true;
  EXCEPTION WHEN check_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Classificacao de resultado com motivo de exclusao foi aceita.';
  END IF;

  BEGIN
    INSERT INTO public.classificacoes_resultado
      (codigo, nome, descricao, familia, tratamento, naturezas, papel_dre, motivo_exclusao)
    VALUES ('TESTE_PATRIMONIAL', 'x', 'x', 'PATRIMONIAL', 'PATRIMONIAL', ARRAY['RECEITA'], NULL, NULL);
    v_aceitou := true;
  EXCEPTION WHEN check_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Classificacao patrimonial sem motivo de exclusao foi aceita.';
  END IF;

  -- Aceitar as duas naturezas fora do patrimonial deixaria uma despesa somar
  -- receita sem violar nada.
  BEGIN
    INSERT INTO public.classificacoes_resultado
      (codigo, nome, descricao, familia, tratamento, naturezas, papel_dre)
    VALUES ('TESTE_DUPLA', 'x', 'x', 'DESPESA', 'RESULTADO', ARRAY['RECEITA', 'DESPESA'], 'DESPESA');
    v_aceitou := true;
  EXCEPTION WHEN check_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Classificacao de resultado com duas naturezas foi aceita.';
  END IF;

  -- -------------------------------------------------- coerencia do mapeamento
  SELECT id INTO v_classificacao FROM public.classificacoes_resultado
   WHERE codigo = 'DESPESA_ADMINISTRATIVA';
  SELECT id INTO v_patrimonial FROM public.classificacoes_resultado
   WHERE codigo = 'TRANSFERENCIA_INTERNA';
  SELECT id INTO v_linha FROM public.dre_linha
   WHERE template_id = v_template AND codigo = '6.2';

  BEGIN
    INSERT INTO public.dre_mapeamento
      (template_id, linha_id, origem_tipo, classificacao_resultado_id, origem_id)
    VALUES (v_template, v_linha, 'CLASSIFICACAO_RESULTADO', v_classificacao, 1);
    v_aceitou := true;
  EXCEPTION WHEN check_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Mapeamento por classificacao aceitou origem_id junto.';
  END IF;

  BEGIN
    INSERT INTO public.dre_mapeamento
      (template_id, linha_id, origem_tipo, origem_id, classificacao_resultado_id)
    VALUES (v_template, v_linha, 'PLANO_GRUPO', 1, v_classificacao);
    v_aceitou := true;
  EXCEPTION WHEN check_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Mapeamento legado aceitou classificacao junto.';
  END IF;

  -- Dois destinos ativos para a mesma classificacao seriam escolha por LIMIT 1.
  BEGIN
    INSERT INTO public.dre_mapeamento
      (template_id, linha_id, origem_tipo, classificacao_resultado_id)
    VALUES (v_template, v_linha, 'CLASSIFICACAO_RESULTADO', v_classificacao);
    v_aceitou := true;
  EXCEPTION WHEN unique_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Segundo destino ativo para a mesma classificacao foi aceito.';
  END IF;

  -- ------------------------------------------------------- regras de vigencia
  INSERT INTO public.planosdecontagrupos (codigo, nome, descricao)
  VALUES ('ZZTESTE', 'Grupo de teste da classificacao', 'temporario')
  RETURNING id INTO v_grupo;

  INSERT INTO public.planosdeconta (codigo, nome, grupo_id)
  VALUES ('ZZTESTE.1', 'Conta de teste da classificacao', v_grupo)
  RETURNING id INTO v_conta;

  INSERT INTO public.plano_contas_classificacao_regra
    (grupo_id, classificacao_id, vigencia_inicio, vigencia_fim, versao_catalogo, origem_regra)
  VALUES (v_grupo, v_classificacao, DATE '2026-01-01', DATE '2026-07-01', 1, 'MIGRACAO')
  RETURNING id INTO v_regra;

  -- Fim exclusivo: uma regra que comeca no dia em que a outra termina nao
  -- sobrepoe, e as duas juntas cobrem o intervalo sem buraco.
  BEGIN
    INSERT INTO public.plano_contas_classificacao_regra
      (grupo_id, classificacao_id, vigencia_inicio, versao_catalogo)
    VALUES (v_grupo, v_patrimonial, DATE '2026-07-01', 1);
    v_aceitou := true;
  EXCEPTION WHEN OTHERS THEN
    v_aceitou := false;
  END;
  IF NOT v_aceitou THEN
    RAISE EXCEPTION 'Regra adjacente (inicio = fim da anterior) foi recusada.';
  END IF;

  BEGIN
    INSERT INTO public.plano_contas_classificacao_regra
      (grupo_id, classificacao_id, vigencia_inicio, vigencia_fim, versao_catalogo)
    VALUES (v_grupo, v_classificacao, DATE '2026-06-01', DATE '2026-08-01', 1);
    v_aceitou := true;
  EXCEPTION WHEN unique_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Regra com vigencia sobreposta foi aceita.';
  END IF;

  -- A regra e de um grupo OU de uma conta. Nunca das duas, nunca de nenhuma.
  BEGIN
    INSERT INTO public.plano_contas_classificacao_regra
      (grupo_id, conta_id, classificacao_id, vigencia_inicio, versao_catalogo)
    VALUES (v_grupo, v_conta, v_classificacao, DATE '2027-01-01', 1);
    v_aceitou := true;
  EXCEPTION WHEN check_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Regra com grupo e conta ao mesmo tempo foi aceita.';
  END IF;

  BEGIN
    INSERT INTO public.plano_contas_classificacao_regra
      (classificacao_id, vigencia_inicio, versao_catalogo)
    VALUES (v_classificacao, DATE '2027-01-01', 1);
    v_aceitou := true;
  EXCEPTION WHEN check_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Regra sem grupo nem conta foi aceita.';
  END IF;

  -- Regra de conta e de grupo sao entidades distintas: mesma vigencia convive.
  BEGIN
    INSERT INTO public.plano_contas_classificacao_regra
      (conta_id, classificacao_id, vigencia_inicio, vigencia_fim, versao_catalogo)
    VALUES (v_conta, v_classificacao, DATE '2026-01-01', DATE '2026-07-01', 1);
    v_aceitou := true;
  EXCEPTION WHEN OTHERS THEN
    v_aceitou := false;
  END;
  IF NOT v_aceitou THEN
    RAISE EXCEPTION 'Regra de conta foi bloqueada por uma regra de grupo.';
  END IF;

  -- ------------------------------------------------- revisoes do evento
  SELECT id INTO v_evento FROM public.eventos_financeiros ORDER BY id LIMIT 1;
  IF v_evento IS NULL THEN
    RAISE NOTICE 'Sem eventos financeiros no banco: guardas de revisao nao exercitadas.';
  ELSE
    INSERT INTO public.eventos_financeiros_classificacao
      (evento_id, classificacao_id, template_id, linha_id, resultado, versao_catalogo)
    VALUES (v_evento, v_classificacao, v_template, v_linha, 'CLASSIFICADO', 1);

    BEGIN
      INSERT INTO public.eventos_financeiros_classificacao
        (evento_id, classificacao_id, template_id, linha_id, resultado, versao_catalogo)
      VALUES (v_evento, v_classificacao, v_template, v_linha, 'CLASSIFICADO', 1);
      v_aceitou := true;
    EXCEPTION WHEN unique_violation THEN
      v_aceitou := false;
    END;
    IF v_aceitou THEN
      RAISE EXCEPTION 'Duas revisoes vigentes para o mesmo evento foram aceitas.';
    END IF;

    -- Revisao anterior permanece consultavel; so uma fica vigente.
    UPDATE public.eventos_financeiros_classificacao
       SET vigente = false WHERE evento_id = v_evento;
    INSERT INTO public.eventos_financeiros_classificacao
      (evento_id, resultado, motivo, versao_catalogo)
    VALUES (v_evento, 'PENDENTE', 'conta sem regra na competencia', 1);

    SELECT count(*) INTO v_total
      FROM public.eventos_financeiros_classificacao WHERE evento_id = v_evento;
    IF v_total <> 2 THEN
      RAISE EXCEPTION 'Esperava 2 revisoes preservadas; achei %.', v_total;
    END IF;

    BEGIN
      INSERT INTO public.eventos_financeiros_classificacao
        (evento_id, resultado, versao_catalogo, vigente)
      VALUES (v_evento, 'PENDENTE', 1, false);
      v_aceitou := true;
    EXCEPTION WHEN check_violation THEN
      v_aceitou := false;
    END;
    IF v_aceitou THEN
      RAISE EXCEPTION 'Revisao PENDENTE sem motivo foi aceita.';
    END IF;

    BEGIN
      INSERT INTO public.eventos_financeiros_classificacao
        (evento_id, classificacao_id, resultado, versao_catalogo, vigente)
      VALUES (v_evento, v_classificacao, 'CLASSIFICADO', 1, false);
      v_aceitou := true;
    EXCEPTION WHEN check_violation THEN
      v_aceitou := false;
    END;
    IF v_aceitou THEN
      RAISE EXCEPTION 'Revisao CLASSIFICADO sem linha foi aceita.';
    END IF;
  END IF;

  -- ------------------------------------------------------------ implantacao
  SELECT count(*) INTO v_total FROM public.dre_implantacao;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'Deveria existir exatamente um registro de implantacao; achei %.', v_total;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.dre_implantacao WHERE estado = 'LEGADO') THEN
    RAISE EXCEPTION 'A instalacao existente deveria comecar em LEGADO.';
  END IF;

  BEGIN
    INSERT INTO public.dre_implantacao (estado) VALUES ('LEGADO');
    v_aceitou := true;
  EXCEPTION WHEN unique_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Segundo registro de implantacao foi aceito.';
  END IF;

  -- Ativar sem vigencia reclassificaria o passado inteiro.
  BEGIN
    UPDATE public.dre_implantacao SET estado = 'ATIVO';
    v_aceitou := true;
  EXCEPTION WHEN check_violation THEN
    v_aceitou := false;
  END;
  IF v_aceitou THEN
    RAISE EXCEPTION 'Ativacao sem vigencia, catalogo e template foi aceita.';
  END IF;

  RAISE NOTICE 'Catalogo de classificacao de resultado: todas as verificacoes passaram.';
END
$test$;

ROLLBACK;
