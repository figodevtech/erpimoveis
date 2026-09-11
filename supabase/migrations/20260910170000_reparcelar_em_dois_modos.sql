-- Reparcelar passa a ter dois modos.
--
-- O QUE ESTAVA ERRADO, DOS DOIS LADOS
-- "Grupo" e "trava da soma" estavam colados numa coisa so, e as duas perguntas
-- tem respostas diferentes:
--
--   grupo — quais linhas eu edito?
--   modo  — a soma pode mudar?
--
-- No LANCAMENTO AVULSO a trava nao protegia nada: o grupo e o proprio total, nao
-- ha documento a quem prestar contas. Ela so impedia o que se queria fazer —
-- diminuir uma parcela, ou renegociar a divida para outro valor. O botao nunca
-- destravava, porque a soma tinha que fechar exatamente no numero de antes.
--
-- Em OS e VENDA era o oposto: a funcao recusava o grupo inteiro com "esta
-- vinculado a um documento e nao pode ser reparcelado por aqui". O argumento era
-- que quem redistribui ali e o rateio (`ajustar_valores_transacao`) — mas o
-- rateio so redivide valor entre os pagamentos que JA existem. Ele nao muda em
-- quantas vezes nem para quando, que e justamente o que se pede ao renegociar.
-- Nao havia caminho nenhum: "3x virar 6x" numa OS era excluir tudo e lancar de
-- novo.
--
-- O DESENHO
-- AVULSO      total livre. O grupo e `parcelamento_id`.
-- VINCULADO   total travado, quantidade e vencimentos livres. O grupo e o
--             DOCUMENTO — as RECEITA nao deletadas da OS ou da venda —, a mesma
--             definicao que `ajustar_valores_transacao` ja usa. Com isso todo
--             parcelamento antigo de OS e venda vira reparcelavel na hora, sem
--             backfill e sem heuristica de descricao: eles nunca ganharam grupo
--             formal porque o cadastro so cria um para o avulso.
--             A nota de compra continua aqui, como em 20260903260000: grupo
--             formal, total travado.
--
-- A funcao nova e chaveada pela TRANSACAO, nao pelo grupo. E a unica forma de o
-- modo ser derivado e nunca recebido: um cliente adulterado nao escolhe o
-- proprio modo. `reparcelar_transacao_avulsa` vira casca e delega, para nenhum
-- chamador antigo quebrar.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Redividir o que ja esta lancado nao e recebimento novo
-- ---------------------------------------------------------------------------
--
-- `validar_novo_recebimento_os` recusa titulo novo numa OS que nao esteja em
-- ORCAMENTO_APROVADO, EM_ANDAMENTO ou PAGAMENTO/FATURAMENTO. A regra esta certa
-- para um pagamento: depois de encerrada, a OS nao recebe dinheiro novo.
--
-- Mas o caso mais comum de reparcelamento e exatamente a OS ja entregue — o
-- servico acabou, o cliente esta pagando em 3x e pede para virar 6x. Ali nao
-- entra dinheiro nenhum: o total e o mesmo antes e depois (o modo vinculado
-- exige isso), so muda em quantas linhas ele esta dividido. Tratar essas linhas
-- como recebimento novo e o que travava a operacao.
--
-- A dispensa vale SO para o gate de status, e so dentro da transacao que a RPC
-- abre — mesmo mecanismo de `app.usoconsumo_movimento` (20260729100000) e
-- `app.entrada_mista_cancelamento` (20260731120000). O TETO DE VALOR continua
-- valendo integralmente: `validar_limite_pagamento_os` segue somando
-- `recebimento_por_documento` e recusando o que passar do total da OS.
CREATE OR REPLACE FUNCTION public.validar_novo_recebimento_os(p_os_id integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF coalesce(current_setting('app.reparcelamento_em_curso', true), '') = 'permitido' THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  PERFORM pg_advisory_xact_lock(87001, p_os_id);
  SELECT status::text INTO v_status FROM public.ordemservico
    WHERE id = p_os_id AND NOT coalesce(is_deleted, false) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_status NOT IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO')
     AND v_status <> (CASE WHEN public.faturamento_os_habilitado() THEN 'FATURAMENTO' ELSE 'PAGAMENTO' END) THEN
    RAISE EXCEPTION 'A OS não está disponível para novos registros financeiros. Verifique o status e a configuração de faturamento.' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) A funcao nova
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reparcelar_transacao(
  p_transacao_id bigint,
  p_parcelas jsonb,
  p_alterado_por uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_total_anterior numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- Espera limitada vira erro tratavel em vez de tela travada. Mesmo de
-- `ajustar_valores_transacao`.
SET lock_timeout = '5s'
AS $$
DECLARE
  v_tx public.transacao%ROWTYPE;
  v_modo text;
  v_grupo_tipo text;
  v_grupo_id bigint;
  v_grupo_ids bigint[];
  v_base text;
  v_novas int;
  v_pendentes int;
  v_alvo bigint;
  v_soma bigint;
  v_template public.transacao%ROWTYPE;
  v_anterior public.transacao%ROWTYPE;
  v_ids_pendentes bigint[];
  v_familia bigint[];
  v_item record;
  v_id bigint;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_total int;
  v_resultado jsonb := '[]'::jsonb;
BEGIN
  -------------------------------------------------------------------------
  -- 1) Formato do payload
  -------------------------------------------------------------------------
  IF p_parcelas IS NULL
     OR jsonb_typeof(p_parcelas) <> 'array'
     OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma parcela.' USING ERRCODE = '22023';
  END IF;

  v_novas := jsonb_array_length(p_parcelas);

  -- Teto de sanidade: o formulario nao oferece nada perto disso, e sem limite um
  -- payload torto viraria centenas de linhas gravadas.
  IF v_novas > 60 THEN
    RAISE EXCEPTION 'Um parcelamento pode ter no maximo 60 parcelas.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT indice AS posicao,
           round((parcela->>'valor')::numeric, 2) AS valor,
           (parcela->>'data')::timestamptz AS data
      FROM jsonb_array_elements(p_parcelas) WITH ORDINALITY AS t(parcela, indice)
  LOOP
    IF v_item.valor IS NULL OR v_item.valor <= 0 THEN
      RAISE EXCEPTION 'O valor da parcela % deve ser maior que zero.', v_item.posicao
        USING ERRCODE = '22023';
    END IF;

    -- A data pode ser passada: renegociar um titulo vencido e justamente quando
    -- se reparcela. O que nao pode e nao ter data.
    IF v_item.data IS NULL THEN
      RAISE EXCEPTION 'Informe o vencimento da parcela %.', v_item.posicao
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -------------------------------------------------------------------------
  -- 2) O MODO — derivado da linha gravada, nunca recebido
  -------------------------------------------------------------------------
  SELECT * INTO v_tx FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transacao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  /*
   * A ordem da cascata e a regra: os bloqueios primeiro.
   *
   * Uma linha pode ter dois vinculos ao mesmo tempo — um pagamento multiplo
   * aponta para a OS e para o rateio. Perguntar primeiro pela OS classificaria
   * como reparcelavel algo que so o rateio sabe dividir.
   *
   * `modoDeReparcelamento`, no cliente, repete esta mesma cascata. A de la
   * decide qual botao a tela mostra; esta decide o que pode ser escrito.
   */
  IF v_tx.transferencia_id IS NOT NULL THEN
    RAISE EXCEPTION 'Transferencia entre contas nao e parcelamento: as duas pernas sao o mesmo dinheiro e mudam juntas.'
      USING ERRCODE = '22023';
  ELSIF v_tx.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este lancamento cobre varios documentos. Quem divide o valor dele e o rateio do pagamento multiplo.'
      USING ERRCODE = '22023';
  ELSIF v_tx.evento_financeiro_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lancamento de evento financeiro e um por evento e nao se divide em parcelas.'
      USING ERRCODE = '22023';
  ELSIF v_tx.adiantamento_id IS NOT NULL OR coalesce(v_tx.eh_adiantamento, false) THEN
    RAISE EXCEPTION 'Titulo antecipado responde ao contrato com o banco e nao pode ser reparcelado aqui.'
      USING ERRCODE = '22023';
  ELSIF v_tx.ordemservicoid IS NOT NULL THEN
    v_modo := 'VINCULADO'; v_grupo_tipo := 'OS';    v_grupo_id := v_tx.ordemservicoid;
  ELSIF v_tx.vendaid IS NOT NULL THEN
    v_modo := 'VINCULADO'; v_grupo_tipo := 'VENDA'; v_grupo_id := v_tx.vendaid;
  ELSIF v_tx.parcelamento_id IS NOT NULL THEN
    v_grupo_tipo := 'PARCELAMENTO'; v_grupo_id := v_tx.parcelamento_id;
    -- Nota de compra: grupo formal, total travado. O total e da nota, dado dela;
    -- a divisao em parcelas e que e livre. Preserva 20260903260000.
    v_modo := CASE WHEN v_tx.entrada_id IS NOT NULL
                     OR v_tx.usoconsumo_entrada_id IS NOT NULL
                   THEN 'VINCULADO' ELSE 'AVULSO' END;
  ELSE
    RAISE EXCEPTION 'Esta transacao nao faz parte de um parcelamento, ou o grupo dela e anterior ao registro de parcelamentos.'
      USING ERRCODE = '22023';
  END IF;

  -------------------------------------------------------------------------
  -- 3) O LOCK, antes de qualquer soma
  -------------------------------------------------------------------------
  /*
   * Sem isto duas telas reparcelam ao mesmo tempo e cada uma fecha a conta
   * contra um estado velho.
   *
   * `ORDER BY id` e a ordem que impede duas chamadas de travarem uma a outra —
   * o deadlock fechado em 20260817120000. E de proposito NAO pego
   * `pg_advisory_xact_lock(87001, os)` aqui: quem o pega e
   * `validar_limite_pagamento_os`, DEPOIS dos locks de linha. Adquiri-lo antes
   * inverteria a ordem em relacao ao resto do sistema.
   */
  BEGIN
    PERFORM 1
       FROM public.transacao
      WHERE is_deleted = false
        AND ((v_grupo_tipo = 'PARCELAMENTO' AND parcelamento_id = v_grupo_id)
          OR (v_grupo_tipo = 'OS' AND ordemservicoid = v_grupo_id
              AND upper(tipo::text) = 'RECEITA' AND evento_financeiro_id IS NULL)
          OR (v_grupo_tipo = 'VENDA' AND vendaid = v_grupo_id
              AND upper(tipo::text) = 'RECEITA' AND evento_financeiro_id IS NULL))
      ORDER BY id
        FOR UPDATE;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Outra pessoa esta salvando este parcelamento neste momento. Espere alguns segundos e tente de novo.'
      USING ERRCODE = '55P03';
  END;

  -- Sob a trava o conjunto e estavel: materializa uma vez e o resto da funcao
  -- trabalha por id, em vez de repetir o predicado do grupo em toda consulta.
  SELECT array_agg(id ORDER BY id) INTO v_grupo_ids
    FROM public.transacao
   WHERE is_deleted = false
     AND ((v_grupo_tipo = 'PARCELAMENTO' AND parcelamento_id = v_grupo_id)
       OR (v_grupo_tipo = 'OS' AND ordemservicoid = v_grupo_id
           AND upper(tipo::text) = 'RECEITA' AND evento_financeiro_id IS NULL)
       OR (v_grupo_tipo = 'VENDA' AND vendaid = v_grupo_id
           AND upper(tipo::text) = 'RECEITA' AND evento_financeiro_id IS NULL));

  /*
   * Grupo formal que mistura origens nao se conserta escrevendo nele.
   *
   * Um `parcelamento_id` com uma parcela ligada a documento e outra nao e grupo
   * torto: a renumeracao e a soma passariam a valer para linhas que respondem a
   * donos diferentes.
   */
  IF v_grupo_tipo = 'PARCELAMENTO' AND EXISTS (
    SELECT 1 FROM public.transacao
     WHERE id = ANY(v_grupo_ids)
       AND (ordemservicoid IS NOT NULL
         OR vendaid IS NOT NULL
         OR pagamento_multiplo_id IS NOT NULL
         OR evento_financeiro_id IS NOT NULL
         OR adiantamento_id IS NOT NULL
         OR coalesce(eh_adiantamento, false)
         OR transferencia_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Este parcelamento mistura lancamentos de origens diferentes e nao pode ser reparcelado por aqui.'
      USING ERRCODE = '22023';
  END IF;

  -------------------------------------------------------------------------
  -- 4) As pendentes: alvo e ordem de reaproveitamento
  -------------------------------------------------------------------------
  SELECT count(*), coalesce(sum(round(valor * 100)), 0),
         array_agg(id ORDER BY data, id)
    INTO v_pendentes, v_alvo, v_ids_pendentes
    FROM public.transacao
   WHERE id = ANY(v_grupo_ids) AND pendente = true;

  IF v_pendentes = 0 THEN
    RAISE EXCEPTION 'Todas as parcelas deste parcelamento ja foram baixadas. Para corrigir, exclua e lance de novo.'
      USING ERRCODE = '22023';
  END IF;

  /*
   * Titulo com baixa PARCIAL fica pendente, mas nao e folha em branco.
   *
   * Ele tem transacoes filhas apontando para ele por `baixa_de_transacao_id`, e
   * `transacao_baixa_parcial_coerente_trg` guarda a coerencia entre elas.
   * Reparcelar podia baixar o valor dele para menos do que ja entrou, ou
   * soft-deleta-lo deixando as baixas orfas. Com o total livre no modo avulso
   * isso deixou de ser hipotese remota.
   */
  IF EXISTS (
    SELECT 1 FROM public.transacao
     WHERE id = ANY(v_grupo_ids) AND pendente = true
       AND coalesce(valor_baixado, 0) > 0
  ) THEN
    RAISE EXCEPTION 'Ha parcela com baixa parcial neste grupo. Estorne a baixa antes de reparcelar.'
      USING ERRCODE = '22023';
  END IF;

  -------------------------------------------------------------------------
  -- 5) A SOMA — o unico ponto onde os dois modos divergem
  -------------------------------------------------------------------------
  SELECT coalesce(sum(round((parcela->>'valor')::numeric * 100)), 0)
    INTO v_soma
    FROM jsonb_array_elements(p_parcelas) AS parcela;

  IF v_modo = 'VINCULADO' AND v_soma <> v_alvo THEN
    RAISE EXCEPTION
      'A soma das parcelas deve continuar em R$ %; foi informado R$ %.',
      replace(to_char(v_alvo / 100.0, 'FM999999990.00'), '.', ','),
      replace(to_char(v_soma / 100.0, 'FM999999990.00'), '.', ',')
      USING ERRCODE = '22023';
  END IF;

  /*
   * No modo avulso a soma e livre — e com ela some a defesa contra duas telas
   * salvando em cima uma da outra: antes, a segunda errava porque o alvo ja nao
   * era o mesmo. `p_total_anterior` e o total pendente que a tela viu ao abrir.
   * Mesmo desenho do `valorAnterior` de `ajustar_valores_transacao`.
   */
  IF p_total_anterior IS NOT NULL AND round(p_total_anterior * 100) <> v_alvo THEN
    RAISE EXCEPTION 'As parcelas mudaram depois que esta tela foi aberta. Recarregue e refaca o reparcelamento.'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_template FROM public.transacao WHERE id = v_ids_pendentes[1];

  -- A base da descricao, sem o sufixo de parcela. No grupo formal ela e dado
  -- guardado; no documento e derivada da linha aberta, e e ela que define quais
  -- irmas entram na renumeracao la embaixo.
  IF v_grupo_tipo = 'PARCELAMENTO' THEN
    SELECT descricao INTO v_base FROM public.transacao_parcelamento WHERE id = v_grupo_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parcelamento nao encontrado.' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_base := regexp_replace(v_tx.descricao, ' - Parcela [0-9]+/[0-9]+$', '');
  END IF;

  -------------------------------------------------------------------------
  -- 6) AS ESCRITAS, e a ordem delas
  -------------------------------------------------------------------------
  /*
   * A ordem aqui e obrigatoria, nao estetica.
   *
   * `validar_limite_pagamento_os` roda a cada UPDATE de `valor` e soma as OUTRAS
   * linhas da OS como elas estao NAQUELE INSTANTE — nunca ve o resultado final
   * do lote. Foi exatamente isso que 20260828150000 corrigiu no rateio: uma
   * parcela subindo antes de outra descer estourava o total por R$ 0,33 e a
   * chamada morria num estado que ninguem pediu.
   *
   * Aqui ha um agravante que o rateio nao tem: parcela nova e so aumento. Entao:
   *
   *   a) exclusao logica das excedentes   (descida)
   *   b) UPDATE das reaproveitadas, ORDER BY delta  (descidas, depois subidas)
   *   c) INSERT das novas                 (subida pura, por ultimo)
   *
   * Como no modo vinculado a soma e invariante, nenhuma soma parcial passa do
   * total final. No modo avulso nao ha OS para o gatilho olhar, e a ordem e
   * inofensiva — vale para os dois por simetria.
   *
   * Nao reabre deadlock: as linhas ja estao travadas por id no passo 3.
   * Reordenar UPDATEs nao adquire lock novo.
   */

  -- (a) Sobrou parcela pendente: some por exclusao logica, o mesmo estado de uma
  -- transacao excluida pela tela. Hard delete apagaria a trilha de quem tirou.
  IF v_novas < v_pendentes THEN
    UPDATE public.transacao
       SET is_deleted = true,
           deleted_at = now(),
           deleted_by = p_alterado_por,
           updated_at = now()
     WHERE id = ANY(v_ids_pendentes[(v_novas + 1):v_pendentes]);
  END IF;

  -- (b) As reaproveitadas, da que mais desce para a que mais sobe.
  FOR v_item IN
    SELECT t.indice AS posicao,
           round((t.parcela->>'valor')::numeric, 2) AS valor,
           (t.parcela->>'data')::timestamptz AS data,
           round((t.parcela->>'valor')::numeric, 2)
             - (SELECT valor FROM public.transacao WHERE id = v_ids_pendentes[t.indice])
             AS delta
      FROM jsonb_array_elements(p_parcelas) WITH ORDINALITY AS t(parcela, indice)
     WHERE t.indice <= v_pendentes
     ORDER BY delta, t.indice
  LOOP
    v_id := v_ids_pendentes[v_item.posicao];

    SELECT * INTO v_anterior FROM public.transacao WHERE id = v_id;

    UPDATE public.transacao
       SET valor = v_item.valor,
           -- Havendo desconto lancado, `tg_transacao_valor_coerente` regrava
           -- este campo como `valor - descontos` logo em seguida. E o certo: o
           -- liquido e resultado das linhas de ajuste, nao entrada.
           "valorLiquido" = v_item.valor,
           data = v_item.data,
           -- So acompanha quando ja existia: em parcela pendente o vencimento
           -- mora em `data`, e `vencimento_em` e o retrato tirado na baixa.
           -- Preenche-lo agora criaria um retrato de algo que nao aconteceu.
           vencimento_em = CASE WHEN vencimento_em IS NULL THEN NULL ELSE v_item.data END,
           updated_at = now(),
           updated_by = coalesce(p_alterado_por, updated_by)
     WHERE id = v_id;

    IF round(coalesce(v_anterior.valor, 0) * 100) <> round(v_item.valor * 100) THEN
      INSERT INTO public.transacao_valor_historico (
        transacao_id, valor_anterior, valor_novo,
        valor_liquido_anterior, valor_liquido_novo, alterado_por, motivo
      ) VALUES (
        v_id, v_anterior.valor, v_item.valor,
        v_anterior."valorLiquido", v_item.valor, p_alterado_por,
        coalesce(v_motivo, 'Reparcelamento')
      );
    END IF;

    v_resultado := v_resultado || jsonb_build_object(
      'id', v_id, 'valor', v_item.valor, 'data', v_item.data);
  END LOOP;

  -- (c) As que nascem agora.
  IF v_novas > v_pendentes THEN
    -- Dispensa so o gate de STATUS, e so aqui dentro: ver o bloco 1 no topo
    -- desta migration. O teto de valor da OS continua sendo cobrado a cada
    -- INSERT, por `validar_limite_pagamento_os`.
    PERFORM set_config('app.reparcelamento_em_curso', 'permitido', true);

    FOR v_item IN
      SELECT t.indice AS posicao,
             round((t.parcela->>'valor')::numeric, 2) AS valor,
             (t.parcela->>'data')::timestamptz AS data
        FROM jsonb_array_elements(p_parcelas) WITH ORDINALITY AS t(parcela, indice)
       WHERE t.indice > v_pendentes
       ORDER BY t.indice
    LOOP
      /*
       * Herda o vinculo com o documento, e SO ele.
       *
       * Sem `ordemservicoid`/`vendaid`/`entrada_id` a parcela sai orfa: o
       * documento passaria a ter menos titulos do que vale, a conferencia nao
       * fecharia e a linha viraria receita avulsa na DRE.
       *
       * O que ela nunca herda, e por que:
       *   evento_financeiro_id  indice unico evento<->transacao; um evento nao
       *                         vira dois
       *   banco_id              titulo que nasce pendente nao tem onde o dinheiro
       *                         caiu — quem diz isso e a baixa. A versao anterior
       *                         desta funcao herdava, e com isso arriscava 23514
       *                         em `transacao_baixa_parcial_coerente_trg`
       *   pagamento_multiplo_id nao existiria fatia em `pagamento_multiplo_rateio`
       *   adiantamento_id       grupo ja recusado; explicitar impede vazamento
       *   baixa_de_transacao_id a linha nova nao e baixa de nada
       *   valor_acrescimos      ajuste e da parcela especifica, e mora em tabela
       *   valor_descontos       propria; os gatilhos deixam valor_base = valor
       */
      INSERT INTO public.transacao (
        descricao, descricao_pagamento, valor, "valorLiquido", data,
        metodopagamento, categoria, categoria_id, plano_de_conta, plano_de_conta_id,
        centro_custo, centro_custo_id, tipo, cliente_id, fornecedor_id,
        nomepagador, cpfcnpjpagador, competencia_em, pendente, parcelamento_id,
        ordemservicoid, vendaid, entrada_id, usoconsumo_entrada_id, origem,
        created_by
      ) VALUES (
        v_template.descricao, v_template.descricao_pagamento, v_item.valor, v_item.valor,
        v_item.data, v_template.metodopagamento, v_template.categoria,
        v_template.categoria_id, v_template.plano_de_conta, v_template.plano_de_conta_id,
        v_template.centro_custo, v_template.centro_custo_id, v_template.tipo,
        v_template.cliente_id, v_template.fornecedor_id,
        v_template.nomepagador, v_template.cpfcnpjpagador, v_template.competencia_em,
        true, v_template.parcelamento_id,
        v_template.ordemservicoid, v_template.vendaid,
        v_template.entrada_id, v_template.usoconsumo_entrada_id, v_template.origem,
        coalesce(p_alterado_por, v_template.created_by)
      )
      RETURNING id INTO v_id;

      v_resultado := v_resultado || jsonb_build_object(
        'id', v_id, 'valor', v_item.valor, 'data', v_item.data);
    END LOOP;

    -- Devolve a dispensa. Ela morreria com a transacao de qualquer forma, mas
    -- qualquer escrita posterior no mesmo commit nao tem por que herda-la.
    PERFORM set_config('app.reparcelamento_em_curso', '', true);
  END IF;

  -------------------------------------------------------------------------
  -- 7) Renumeracao: o denominador da descricao
  -------------------------------------------------------------------------
  /*
   * O numero faz parte da descricao, e ir de 3x para 5x muda o denominador de
   * todas: deixar "1/3" ao lado de "4/5" seria mentira na tela e no extrato. As
   * baixadas entram tambem — o gatilho de valor nao se opoe, porque nada aqui
   * toca o valor de linha baixada.
   *
   * No grupo formal a familia e o grupo inteiro. No DOCUMENTO nao e: uma OS pode
   * ter uma entrada a vista mais um parcelamento, e renumerar as duas coisas
   * juntas inventaria uma parcela que a entrada nunca foi. Ali a familia sao as
   * linhas do documento que compartilham a mesma base de descricao.
   */
  IF v_grupo_tipo = 'PARCELAMENTO' THEN
    SELECT array_agg(id) INTO v_familia
      FROM public.transacao
     WHERE parcelamento_id = v_grupo_id AND is_deleted = false;
  ELSE
    SELECT array_agg(id) INTO v_familia
      FROM public.transacao
     WHERE is_deleted = false
       AND ((v_grupo_tipo = 'OS' AND ordemservicoid = v_grupo_id)
         OR (v_grupo_tipo = 'VENDA' AND vendaid = v_grupo_id))
       AND upper(tipo::text) = 'RECEITA'
       AND evento_financeiro_id IS NULL
       AND regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '') = v_base;
  END IF;

  v_total := coalesce(array_length(v_familia, 1), 0);

  UPDATE public.transacao t
     SET descricao = v_base || ' - Parcela ' || ordenadas.posicao || '/' || v_total,
         updated_at = now()
    FROM (
      SELECT id, row_number() OVER (ORDER BY data, id) AS posicao
        FROM public.transacao
       WHERE id = ANY(v_familia)
    ) AS ordenadas
   WHERE t.id = ordenadas.id
     AND t.descricao IS DISTINCT FROM
         (v_base || ' - Parcela ' || ordenadas.posicao || '/' || v_total);

  -------------------------------------------------------------------------
  -- 8) Status do documento
  -------------------------------------------------------------------------
  /*
   * OS nao precisa: `trg_recalcular_status_financeiro_os` e AFTER INSERT OR
   * UPDATE OF (..., is_deleted, pendente, valor, ...) OR DELETE e ja disparou em
   * cada linha tocada acima.
   *
   * Venda nao tem gatilho equivalente — `recalcular_status_financeiro_venda` so
   * e chamada a mao, pelas funcoes de pagamento multiplo e de exclusao. Sem esta
   * linha, tirar ou acrescentar parcela deixaria o status da venda congelado no
   * que era antes.
   */
  IF v_grupo_tipo = 'VENDA' THEN
    PERFORM public.recalcular_status_financeiro_venda(v_grupo_id::int);
  END IF;

  RETURN jsonb_build_object(
    'modo', v_modo,
    'grupoTipo', v_grupo_tipo,
    'grupoId', v_grupo_id,
    'total', v_total,
    'parcelas', v_resultado
  );
END;
$$;

ALTER FUNCTION public.reparcelar_transacao(bigint, jsonb, uuid, text, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reparcelar_transacao(bigint, jsonb, uuid, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reparcelar_transacao(bigint, jsonb, uuid, text, numeric)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3) O nome antigo vira casca
-- ---------------------------------------------------------------------------
--
-- A rota passa a usar o nome novo, mas o teste SQL de 20260813010000 chama por
-- aqui, e ele e o unico teste da regra. Manter a casca deixa a suite inteira
-- verde e permite entregar esta migration sozinha, antes de a rota mudar.
CREATE OR REPLACE FUNCTION public.reparcelar_transacao_avulsa(
  p_parcelamento_id bigint,
  p_parcelas jsonb,
  p_alterado_por uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  -- A mensagem aqui e a de GRUPO, nao a de transacao: e o que a tela antiga e o
  -- teste SQL esperam quando o id nao existe.
  PERFORM 1 FROM public.transacao_parcelamento WHERE id = p_parcelamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parcelamento nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_id
    FROM public.transacao
   WHERE parcelamento_id = p_parcelamento_id
     AND is_deleted = false
     AND pendente = true
   ORDER BY data, id
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Todas as parcelas deste parcelamento ja foram baixadas. Para corrigir, exclua e lance de novo.'
      USING ERRCODE = '22023';
  END IF;

  RETURN public.reparcelar_transacao(v_id, p_parcelas, p_alterado_por, p_motivo, NULL);
END;
$$;

ALTER FUNCTION public.reparcelar_transacao_avulsa(bigint, jsonb, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reparcelar_transacao_avulsa(bigint, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reparcelar_transacao_avulsa(bigint, jsonb, uuid, text)
  TO service_role;

COMMIT;
