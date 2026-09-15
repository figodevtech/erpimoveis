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
  v_soma         bigint;
  v_antes        numeric;
  v_depois       numeric;
  v_aceitou      boolean;
  v_template     integer;
  v_usuario      uuid;
  v_os           integer;
  v_tx2          bigint;
  v_grupo_fora   integer;
  v_conta_fora   integer;
  v_tx_tesouraria bigint;
  v_tx_antecip   bigint;
  v_tx_titulo    bigint;
  v_tx_natureza  bigint;
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

  -- ------------------------------------ a fila respeita a regra de evento
  -- O que o sistema decidiu manter fora do resultado nao e pendencia. Enquanto
  -- TRANSACAO_SEM_EVENTO so perguntava "existe evento?", ele acusava parcela de
  -- OS, compra com entrada fiscal, carga de migracao e conta em grupo excluido
  -- — no Demir, 1.005 dos 1.024 itens da fila eram o comportamento correto.
  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1;
  SELECT id INTO v_usuario FROM public.usuario ORDER BY id LIMIT 1;

  -- Avulsa pura: o gatilho gera o evento dela. Sem o evento, ENTRA na fila.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 500, now(), TIMESTAMPTZ '2026-08-12', v_banco, v_conta, v_categoria,
          'ZZF4 avulsa pura', 'FIXTURE F4', '00000000000')
  RETURNING id INTO v_tx2;

  DELETE FROM public.eventos_financeiros
   WHERE source_type = 'TRANSACAO' AND source_id = v_tx2;

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'TRANSACAO_SEM_EVENTO';
  IF coalesce(v_linha.quantidade, 0) < 1 THEN
    RAISE EXCEPTION 'Transacao avulsa sem evento deveria entrar na fila.';
  END IF;
  v_total := v_linha.quantidade;

  -- Saldo de abertura de outro sistema: nao gera evento de proposito.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador, origem)
  VALUES ('DESPESA', 9999, now(), TIMESTAMPTZ '2026-08-12', v_banco, v_conta, v_categoria,
          'ZZF4 carga de migracao', 'FIXTURE F4', '00000000000', 'ORIGEM_MIGRACAO');

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'TRANSACAO_SEM_EVENTO';
  IF coalesce(v_linha.quantidade, 0) <> v_total THEN
    RAISE EXCEPTION 'Carga de migracao nao deveria entrar na fila; a contagem foi de % para %.',
      v_total, v_linha.quantidade;
  END IF;

  -- Conta em grupo excluido do resultado: idem.
  INSERT INTO public.planosdecontagrupos (codigo, nome)
  VALUES ('ZZF4X', 'Grupo fora do resultado da Fase 4') RETURNING id INTO v_grupo_fora;
  INSERT INTO public.planosdeconta (codigo, nome, grupo_id)
  VALUES ('ZZF4X.1', 'Conta fora do resultado', v_grupo_fora) RETURNING id INTO v_conta_fora;
  INSERT INTO public.dre_mapeamento
    (template_id, origem_tipo, origem_id, exclui_do_resultado, ativo, observacao)
  VALUES (v_template, 'PLANO_GRUPO', v_grupo_fora, true, true, 'Fixture: fora do resultado.');

  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('DESPESA', 8888, now(), TIMESTAMPTZ '2026-08-12', v_banco, v_conta_fora, v_categoria,
          'ZZF4X fora do resultado', 'FIXTURE F4', '00000000000');

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'TRANSACAO_SEM_EVENTO';
  IF coalesce(v_linha.quantidade, 0) <> v_total THEN
    RAISE EXCEPTION 'Conta em grupo excluido nao deveria entrar na fila; veio %.',
      v_linha.quantidade;
  END IF;

  -- Fila e sincronizacao tem de responder a MESMA pergunta. Se as duas leituras
  -- divergirem, volta o problema que esta correcao veio resolver.
  IF NOT public.transacao_gera_evento_de_resultado(v_tx2) THEN
    RAISE EXCEPTION 'A avulsa pura deveria gerar evento pela regra.';
  END IF;

  IF public.transacao_gera_evento_de_resultado(
       (SELECT id FROM public.transacao
         WHERE descricao = 'ZZF4 carga de migracao' ORDER BY id DESC LIMIT 1)) THEN
    RAISE EXCEPTION 'Carga de migracao nao deveria gerar evento pela regra.';
  END IF;

  IF public.transacao_gera_evento_de_resultado(
       (SELECT id FROM public.transacao
         WHERE descricao = 'ZZF4X fora do resultado' ORDER BY id DESC LIMIT 1)) THEN
    RAISE EXCEPTION 'Conta em grupo excluido nao deveria gerar evento pela regra.';
  END IF;

  -- Transacao inexistente nao gera evento nenhum: `false`, nao erro.
  IF public.transacao_gera_evento_de_resultado(-1) THEN
    RAISE EXCEPTION 'Transacao inexistente nao deveria gerar evento.';
  END IF;

  -- ------------------------------------ tesouraria e antecipacao continuam fora
  -- A regra ja foi reescrita duas vezes por engano, e nas duas o conjunto perdeu
  -- condicoes em silencio (20260909125000, `lancamento_id`; 20260910160000, as
  -- outras seis). O que faltava era teste do conjunto, e nao leitura mais atenta.
  --
  -- As demais condicoes tem cobertura nos testes dos seus proprios recursos:
  -- transferencia em `transferencia_entre_contas` (0b e 6), baixa parcial em
  -- `baixa_parcial_de_titulo` (13) e `lancamento_id` em `comissao_de_vendas`.
  -- Aqui ficam as que nao tinham dono.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('SAQUE', 700, now(), TIMESTAMPTZ '2026-08-13', v_banco, v_categoria,
          'ZZF4 saque de tesouraria', 'FIXTURE F4', '00000000000')
  RETURNING id INTO v_tx_tesouraria;

  IF public.transacao_gera_evento_de_resultado(v_tx_tesouraria) THEN
    RAISE EXCEPTION 'Saque e tesouraria: nao deveria gerar evento de resultado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.eventos_financeiros
              WHERE source_type = 'TRANSACAO' AND source_id = v_tx_tesouraria
                AND status = 'ATIVO') THEN
    RAISE EXCEPTION 'O saque criou evento ativo na DRE.';
  END IF;

  UPDATE public.transacao SET tipo = 'DEPOSITO' WHERE id = v_tx_tesouraria;
  IF public.transacao_gera_evento_de_resultado(v_tx_tesouraria) THEN
    RAISE EXCEPTION 'Deposito e tesouraria: nao deveria gerar evento de resultado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.eventos_financeiros
              WHERE source_type = 'TRANSACAO' AND source_id = v_tx_tesouraria
                AND status = 'ATIVO') THEN
    RAISE EXCEPTION 'O deposito criou evento ativo na DRE.';
  END IF;

  -- Antecipacao de recebiveis: o dinheiro chega antes, a receita e do titulo.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, categoria_id, pendente,
     eh_adiantamento, descricao, nomepagador, cpfcnpjpagador)
  VALUES ('RECEITA', 5000, now(), TIMESTAMPTZ '2026-08-14', v_banco, v_categoria, false,
          true, 'ZZF4 antecipacao', 'FIXTURE F4', '00000000000')
  RETURNING id INTO v_tx_antecip;

  IF public.transacao_gera_evento_de_resultado(v_tx_antecip) THEN
    RAISE EXCEPTION 'Antecipacao nao deveria gerar evento de resultado.';
  END IF;

  -- E o titulo antecipado, do outro lado do vinculo.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, categoria_id, pendente, adiantamento_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('RECEITA', 5000, now(), TIMESTAMPTZ '2026-08-14', v_categoria, true, v_tx_antecip,
          'ZZF4 titulo antecipado', 'FIXTURE F4', '00000000000')
  RETURNING id INTO v_tx_titulo;

  IF public.transacao_gera_evento_de_resultado(v_tx_titulo) THEN
    RAISE EXCEPTION 'Titulo ligado a antecipacao nao deveria gerar evento proprio.';
  END IF;

  -- --------------------------- trocar o tipo nao pode virar erro de unicidade
  -- `natureza` faz parte da chave do `on conflict` e o indice unico so admite um
  -- evento por transacao: sem o realinhamento antes do upsert, a troca de tipo
  -- tenta inserir uma segunda linha e devolve 23505 — que na tela aparecia como
  -- "Violacao de unicidade (ja cadastrado)" ao salvar o dialogo de edicao.
  INSERT INTO public.transacao
    (tipo, valor, data, competencia_em, banco_id, plano_de_conta_id, categoria_id,
     descricao, nomepagador, cpfcnpjpagador)
  VALUES ('RECEITA', 640, now(), TIMESTAMPTZ '2026-08-15', v_banco, v_conta, v_categoria,
          'ZZF4 troca de natureza', 'FIXTURE F4', '00000000000')
  RETURNING id INTO v_tx_natureza;

  UPDATE public.transacao SET tipo = 'DESPESA' WHERE id = v_tx_natureza;

  SELECT count(*) INTO v_total
    FROM public.eventos_financeiros
   WHERE source_type = 'TRANSACAO' AND source_id = v_tx_natureza;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'A troca de tipo deveria manter um unico evento; ficaram %.', v_total;
  END IF;

  IF (SELECT natureza FROM public.eventos_financeiros
       WHERE source_type = 'TRANSACAO' AND source_id = v_tx_natureza) <> 'DESPESA' THEN
    RAISE EXCEPTION 'O evento ficou com a natureza antiga depois da troca de tipo.';
  END IF;

  INSERT INTO public.ordemservico (usuariocriadorid) VALUES (v_usuario) RETURNING id INTO v_os;

  -- ------------------------------- competencia ausente deixa de ser um so
  -- OS em execucao ainda nao tem competencia porque o carimbo vem do
  -- encerramento: estado legitimo, motivo proprio.
  INSERT INTO public.eventos_financeiros
    (origem, natureza, valor, chave_origem, status, source_type, source_id,
     natureza_dre, is_manual, descricao)
  VALUES ('SERVICO', 'RECEITA', 321, 'zzf4-os', 'ATIVO', 'ORDEM_SERVICO', v_os,
          'RECEITA', true, 'ZZF4 OS em execucao');

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'EVENTO_OS_EM_ABERTO';
  IF coalesce(v_linha.valor, 0) < 321 THEN
    RAISE EXCEPTION 'Evento de OS em execucao deveria ter motivo proprio; veio %.', v_linha.valor;
  END IF;

  -- A MESMA situacao pela via antiga: `ordemservicoid` preenchido e o par
  -- source_type/source_id vazio, que e como `sincronizar_eventos_financeiros_os`
  -- grava ate hoje. Ler so `source_id` classificava esses eventos como orfaos —
  -- no Demir, 132 servicos em andamento apareceram como buraco de R$ 121 mil.
  INSERT INTO public.eventos_financeiros
    (ordemservicoid, origem, natureza, valor, chave_origem, status,
     natureza_dre, is_manual, descricao)
  VALUES (v_os, 'SERVICO', 'RECEITA', 123, 'zzf4-os-legado', 'ATIVO',
          'RECEITA', true, 'ZZF4 OS em execucao pela via antiga');

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'EVENTO_OS_EM_ABERTO';
  IF coalesce(v_linha.valor, 0) < 444 THEN
    RAISE EXCEPTION
      'A via antiga (ordemservicoid) deveria contar como OS em execucao; veio %.', v_linha.valor;
  END IF;

  -- Sem fonte nao ha de onde herdar periodo: isso e buraco, nao espera.
  INSERT INTO public.eventos_financeiros
    (origem, natureza, valor, chave_origem, status, natureza_dre, is_manual, descricao)
  VALUES ('PRODUTO', 'RECEITA', 654, 'zzf4-orfao', 'ATIVO', 'RECEITA', true, 'ZZF4 orfao');

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'EVENTO_SEM_FONTE';
  IF coalesce(v_linha.valor, 0) < 654 THEN
    RAISE EXCEPTION 'Evento sem fonte deveria ter motivo proprio; veio %.', v_linha.valor;
  END IF;

  -- Os tres motivos particionam o conjunto: nenhum evento sem competencia pode
  -- ficar de fora nem ser contado duas vezes.
  SELECT count(*) INTO v_total
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO') AND e.competencia_em IS NULL;

  SELECT coalesce(sum(p.quantidade), 0) INTO v_soma
    FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo IN ('EVENTO_OS_EM_ABERTO', 'EVENTO_SEM_FONTE', 'EVENTO_SEM_COMPETENCIA');

  IF v_soma <> v_total THEN
    RAISE EXCEPTION
      'Os tres motivos de competencia ausente deveriam somar os % evento(s); somaram %.',
      v_total, v_soma;
  END IF;

  -- --------------------------------------------- item vendido sem custo
  -- Antes era contagem avulsa na rota da DRE: a tarja dizia "6 itens" e nao
  -- sabia dizer quais. Na fila, ganha lista — e a lista e o que torna o aviso
  -- acionavel.
  INSERT INTO public.eventos_financeiros
    (origem, natureza, natureza_dre, valor, chave_origem, status, competencia_em,
     is_manual, descricao, quantidade_snapshot, dados_snapshot)
  VALUES ('PRODUTO', 'DESPESA', 'CUSTO', 0, 'zzf4-sem-custo', 'ATIVO',
          TIMESTAMPTZ '2026-08-14', true, 'ZZF4 item vendido sem custo', 2,
          '{"custo_nao_informado": true}'::jsonb);

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'ITEM_SEM_CUSTO';
  IF coalesce(v_linha.quantidade, 0) < 1 THEN
    RAISE EXCEPTION 'A fila deveria acusar item vendido sem custo.';
  END IF;
  v_total := v_linha.quantidade;

  SELECT count(*) INTO v_soma
    FROM public.dre_pendencias_itens('ITEM_SEM_CUSTO', v_de, v_ate, 100, 0);
  IF v_soma <> v_total THEN
    RAISE EXCEPTION
      'A lista de ITEM_SEM_CUSTO deveria ter os mesmos % item(ns) da contagem; veio %.',
      v_total, v_soma;
  END IF;

  -- Informar o custo tira da fila. E o que a tela promete ao usuario.
  UPDATE public.eventos_financeiros
     SET valor = 50,
         dados_snapshot = dados_snapshot || '{"custo_nao_informado": false}'::jsonb
   WHERE chave_origem = 'zzf4-sem-custo';

  SELECT * INTO v_linha FROM public.dre_pendencias(v_de, v_ate) p
   WHERE p.motivo = 'ITEM_SEM_CUSTO';
  IF coalesce(v_linha.quantidade, 0) <> v_total - 1 THEN
    RAISE EXCEPTION 'Informar o custo deveria tirar o item da fila; ficaram %.',
      v_linha.quantidade;
  END IF;

  -- A tela precisa conseguir abrir os motivos novos.
  SELECT count(*) INTO v_total
    FROM public.dre_pendencias_itens('EVENTO_SEM_FONTE', v_de, v_ate, 100, 0);
  IF v_total < 1 THEN
    RAISE EXCEPTION 'O detalhe de EVENTO_SEM_FONTE veio vazio.';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.dre_pendencias_itens('EVENTO_OS_EM_ABERTO', v_de, v_ate, 100, 0);
  IF v_total < 1 THEN
    RAISE EXCEPTION 'O detalhe de EVENTO_OS_EM_ABERTO veio vazio.';
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

  -- Uma unidade que falha nao derruba as outras. A falha provocada e a conta do
  -- sistema pedindo outra classificacao, que a RPC recusa. Ate a 20260915140000
  -- o erro vinha da trava de familia, que deixou de existir.
  UPDATE public.planosdeconta SET origem_cadastro = 'SISTEMA' WHERE id = v_conta;
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
