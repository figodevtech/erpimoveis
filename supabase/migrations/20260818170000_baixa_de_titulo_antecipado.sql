-- Baixa de título antecipado: perguntar se o dinheiro entra de novo.
--
-- O QUE JÁ EXISTIA
-- `20260812160000_adiantamento_sem_baixa.sql` criou o modo em que a antecipação
-- traz o dinheiro mas os títulos ficam em aberto, marcados como antecipados,
-- para a cobrança acompanhar até o vencimento. A baixa desses títulos vem
-- depois, e ela não move a conta: o caixa já recebeu pela antecipação. Por isso
-- `baixar_transacao_pendente` zerava o banco sempre que o título era antecipado.
--
-- O QUE FALTAVA
-- Quando o pagador não honra o boleto, o banco debita o valor de volta da conta
-- do proprietário. Ele registra esse débito como despesa no fluxo de caixa. Se o
-- devedor pagar depois, aquela baixa é dinheiro entrando de verdade — o banco já
-- havia tirado. Zerar o banco ali deixa o débito sem contrapartida e o saldo da
-- conta permanentemente menor pelo valor do título.
--
-- A regra antiga não estava errada, estava absoluta. Os dois casos existem e o
-- banco não tem como distinguir um do outro: só quem operou sabe se o boleto foi
-- honrado ou se voltou. Então a baixa passa a perguntar, e `p_lancar_no_caixa`
-- carrega a resposta. O padrão é `false` — o caso comum continua sendo o boleto
-- honrado, e quem chama sem saber do assunto recebe o comportamento de antes.
--
-- ONDE O ESTADO FICA
-- Em `banco_id`, que já é a coluna que responde "isto passou por uma conta?".
-- Num título antecipado e já baixado, banco preenchido só pode significar baixa
-- com lançamento: tanto `baixar_por_adiantamento` quanto a baixa sem lançamento
-- gravam NULL ali. Coluna nova para isso seria uma segunda verdade sobre o mesmo
-- fato, e as duas poderiam divergir.
--
-- O ESTORNO PRECISOU ABRIR
-- `estornar_baixa_transacao` recusava qualquer título com `adiantamento_id`,
-- mandando desfazer a antecipação. Isso foi escrito quando "antecipado" só
-- existia no modo que liquida na hora — e lá a recusa continua certa, porque a
-- baixa é do conjunto e não do título. No modo que mantém em aberto a baixa é do
-- título sozinho, e é justamente a que pode estar errada: a baixa com lançamento
-- move dinheiro. Sem estorno, não havia volta.
--
-- Para separar os dois modos sem adivinhar, a antecipação passa a guardar qual
-- deles foi usado. Inferir pelo histórico daria no mesmo na maioria das vezes e
-- mentiria no resto — títulos migrados, antecipação desfeita e refeita.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A antecipação guarda o modo em que foi feita
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS adiantamento_manteve_pendentes boolean;

COMMENT ON COLUMN public.transacao.adiantamento_manteve_pendentes IS
  'Só na antecipação (eh_adiantamento): true quando os títulos ficaram em aberto para a cobrança acompanhar, false quando foram liquidados no ato. É o que decide se a baixa de um título antecipado é dele sozinho (estornável) ou do conjunto (só desfazendo a antecipação).';

-- As antecipações que já existem foram todas feitas no modo que liquida na hora
-- ou no modo novo; o que as separa é o estado em que os títulos ficaram. Título
-- em aberto com `adiantamento_id` só nasce do modo que mantém pendentes.
UPDATE public.transacao a
   SET adiantamento_manteve_pendentes = EXISTS (
         SELECT 1 FROM public.transacao t
          WHERE t.adiantamento_id = a.id
            AND t.is_deleted = false
            AND t.pendente = true
       )
 WHERE coalesce(a.eh_adiantamento, false)
   AND a.adiantamento_manteve_pendentes IS NULL;

-- ---------------------------------------------------------------------------
-- 2) A antecipação passa a registrar o modo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.baixar_por_adiantamento(
  p_ids bigint[],
  p_adiantamento jsonb,
  p_baixado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tipo text;
  v_qtd int;
  v_tipos_distintos int;
  v_soma_liquida numeric(14,2) := 0;
  v_adiantamento_id bigint;
  v_pago_em timestamptz := coalesce(nullif(p_adiantamento->>'pago_em', '')::timestamptz, now());
  v_metodo public.metodo_pagamento;
  v_taxa numeric(14,2);
  v_tipo_taxa integer;
  -- Manter os títulos em aberto, só marcados como antecipados.
  v_manter_pendentes boolean :=
    coalesce((p_adiantamento->>'manter_titulos_pendentes')::boolean, false);
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos uma transacao.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.transacao
   WHERE id = ANY(p_ids) AND is_deleted = false
   FOR UPDATE;

  SELECT count(*), count(DISTINCT upper(tipo::text)),
         coalesce(sum(coalesce(nullif("valorLiquido", 0), valor)), 0)
    INTO v_qtd, v_tipos_distintos, v_soma_liquida
    FROM public.transacao
   WHERE id = ANY(p_ids) AND is_deleted = false;

  IF v_qtd <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'Alguma transacao selecionada nao existe mais.' USING ERRCODE = 'P0002';
  END IF;

  IF v_tipos_distintos > 1 THEN
    RAISE EXCEPTION 'Um adiantamento nao pode misturar receita e despesa.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transacao
     WHERE id = ANY(p_ids) AND (pendente = false OR is_deleted = true)
  ) THEN
    RAISE EXCEPTION 'Ha transacao ja baixada ou excluida na selecao.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transacao WHERE id = ANY(p_ids) AND adiantamento_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Ha transacao ja vinculada a outro adiantamento.' USING ERRCODE = '23505';
  END IF;

  SELECT upper(tipo::text) INTO v_tipo
    FROM public.transacao WHERE id = p_ids[1];

  BEGIN
    v_metodo := nullif(btrim(p_adiantamento->>'metodopagamento'), '')::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido: %.', p_adiantamento->>'metodopagamento'
      USING ERRCODE = '22023';
  END;

  IF v_metodo IS NULL THEN
    RAISE EXCEPTION 'Metodo de pagamento obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF nullif(p_adiantamento->>'banco_id', '') IS NULL THEN
    RAISE EXCEPTION 'Banco obrigatorio no adiantamento.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.transacao (
    descricao, valor, "valorLiquido", valor_base,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, eh_adiantamento, adiantamento_manteve_pendentes,
    banco_id, metodopagamento, categoria_id,
    plano_de_conta_id, centro_custo_id,
    cliente_id, fornecedor_id,
    nomepagador, cpfcnpjpagador,
    descricao_pagamento, created_by, baixado_por
  ) VALUES (
    coalesce(nullif(btrim(p_adiantamento->>'descricao'), ''),
             'Adiantamento de ' || v_qtd || ' titulo(s)'),
    v_soma_liquida, v_soma_liquida, v_soma_liquida,
    v_pago_em, v_pago_em, v_pago_em, v_pago_em,
    v_tipo::public.tipos_transacao, false, true, v_manter_pendentes,
    (p_adiantamento->>'banco_id')::bigint,
    v_metodo,
    nullif(p_adiantamento->>'categoria_id', '')::integer,
    nullif(p_adiantamento->>'plano_de_conta_id', '')::integer,
    nullif(p_adiantamento->>'centro_custo_id', '')::integer,
    nullif(p_adiantamento->>'cliente_id', '')::integer,
    nullif(p_adiantamento->>'fornecedor_id', '')::integer,
    coalesce(nullif(btrim(p_adiantamento->>'nomepagador'), ''), 'Adiantamento'),
    coalesce(nullif(btrim(p_adiantamento->>'cpfcnpjpagador'), ''), 'NÃO INFORMADO'),
    nullif(btrim(p_adiantamento->>'descricao_pagamento'), ''),
    p_baixado_por, p_baixado_por
  ) RETURNING id INTO v_adiantamento_id;

  IF v_manter_pendentes THEN
    -- Só o vínculo. O título continua em aberto para a cobrança acompanhar, e o
    -- banco fica nulo desde já: quando ele for baixado, o dinheiro não é novo —
    -- a menos que o banco tenha debitado de volta, e aí a baixa diz isso.
    UPDATE public.transacao
       SET adiantamento_id = v_adiantamento_id,
           banco_id = NULL,
           updated_at = now()
     WHERE id = ANY(p_ids);
  ELSE
    UPDATE public.transacao
       SET pendente = false,
           pago_em = v_pago_em,
           baixado_por = p_baixado_por,
           vencimento_em = coalesce(vencimento_em, data),
           banco_id = NULL,
           adiantamento_id = v_adiantamento_id,
           updated_at = now()
     WHERE id = ANY(p_ids);

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
    )
    SELECT id, vencimento_em, pago_em, baixado_por, NULL, metodopagamento
      FROM public.transacao WHERE id = ANY(p_ids);
  END IF;

  v_taxa := round(coalesce(nullif(p_adiantamento->>'taxa', '')::numeric, 0), 2);

  IF v_taxa < 0 THEN
    RAISE EXCEPTION 'A taxa de antecipacao nao pode ser negativa.' USING ERRCODE = '22023';
  END IF;
  IF v_taxa >= v_soma_liquida THEN
    RAISE EXCEPTION
      'A taxa de antecipacao (%) nao pode alcancar o valor antecipado (%).', v_taxa, v_soma_liquida
      USING ERRCODE = '22023';
  END IF;

  IF v_taxa > 0 THEN
    SELECT id INTO v_tipo_taxa
      FROM public.tipos_ajuste_transacao WHERE codigo_sistema = 'TAXA_ANTECIPACAO';

    INSERT INTO public.transacao_ajuste (
      transacao_id, tipo_id, natureza, modo, valor_informado, valor_calculado, created_by
    ) VALUES (
      v_adiantamento_id, v_tipo_taxa, 'DESCONTO', 'FIXO', v_taxa, v_taxa, p_baixado_por
    );
  END IF;

  RETURN jsonb_build_object(
    'adiantamento_id', v_adiantamento_id,
    'quantidade', v_qtd,
    'valor_bruto', v_soma_liquida,
    'taxa', v_taxa,
    'valor_liquido', v_soma_liquida - v_taxa,
    'tipo', v_tipo,
    'titulos_mantidos_pendentes', v_manter_pendentes
  );
END;
$function$;

ALTER FUNCTION public.baixar_por_adiantamento(bigint[], jsonb, uuid) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 3) A trava de "antecipado não tem banco" passa a enxergar o modo
-- ---------------------------------------------------------------------------
--
-- `20260812100000_titulo_antecipado_sem_banco.sql` criou
-- `transacao_antecipado_sem_banco_check` depois de um estrago real: na Demir uma
-- operadora abriu títulos antecipados na edição, escolheu um banco e salvou pelo
-- PATCH, e o mesmo dinheiro passou a aparecer duas vezes no Fluxo — uma pela
-- antecipação, outra por cada título. A trava é boa e o motivo dela continua de pé.
--
-- Mas ela é um CHECK, e CHECK só enxerga a própria linha. A regra que vale agora
-- é entre linhas: um título antecipado pode ter banco **apenas** quando já foi
-- baixado e a antecipação dele manteve os títulos em aberto. Nos outros casos o
-- banco continua proibido, exatamente como antes.
--
-- Por isso a trava vira gatilho. Não é afrouxamento: o caso da Demir cairia nas
-- duas recusas abaixo — os títulos estavam em aberto quando foram editados, e a
-- antecipação era do modo que liquida na hora. O que muda é que agora existe um
-- caso legítimo, e ele é o único que passa.

ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_antecipado_sem_banco_check;

CREATE OR REPLACE FUNCTION public.tg_transacao_antecipado_sem_banco()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_manteve_pendentes boolean;
BEGIN
  IF NEW.adiantamento_id IS NULL OR NEW.banco_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Banco que já estava lá e não mudou não é o que esta trava persegue: editar a
  -- descrição de um título baixado com lançamento não pode esbarrar nela.
  IF TG_OP = 'UPDATE'
     AND OLD.banco_id IS NOT DISTINCT FROM NEW.banco_id
     AND OLD.adiantamento_id IS NOT DISTINCT FROM NEW.adiantamento_id THEN
    RETURN NEW;
  END IF;

  -- O banco só entra num título antecipado no exato movimento da baixa. É o que
  -- separa o caso legítimo — a baixa com lançamento, feita porque o banco havia
  -- debitado o valor de volta — de uma edição posterior que apenas escreve um
  -- banco por cima e soma o mesmo dinheiro duas vezes. Foi essa edição que
  -- estragou os títulos das OS #157 e #133 na Demir.
  IF NOT (TG_OP = 'UPDATE'
          AND coalesce(OLD.pendente, false) = true
          AND coalesce(NEW.pendente, false) = false) THEN
    RAISE EXCEPTION
      'O título #% é antecipado: o banco só pode ser gravado na baixa dele, e não por edição. Fora disso o dinheiro entrou pela antecipação, e repetir o banco somaria o mesmo valor duas vezes no fluxo de caixa.',
      NEW.id USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(a.adiantamento_manteve_pendentes, false) INTO v_manteve_pendentes
    FROM public.transacao a WHERE a.id = NEW.adiantamento_id;

  -- Antecipação que liquidou os títulos no ato: a baixa foi dela, não deles, e
  -- nenhum deles carrega banco. Regra igual à de antes.
  IF NOT coalesce(v_manteve_pendentes, false) THEN
    RAISE EXCEPTION
      'O título #% foi liquidado pela antecipação #%: o dinheiro entrou por ela, e dar banco a ele somaria o mesmo valor duas vezes.',
      NEW.id, NEW.adiantamento_id USING ERRCODE = '23514';
  END IF;

  -- Sobra o caso legítimo: o banco debitou o valor de volta, o pagador quitou
  -- depois e a baixa registrou a entrada. Esse título move a conta mesmo.
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.tg_transacao_antecipado_sem_banco() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_antecipado_sem_banco_trg ON public.transacao;
CREATE TRIGGER transacao_antecipado_sem_banco_trg
  BEFORE INSERT OR UPDATE OF banco_id, adiantamento_id, pendente ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_antecipado_sem_banco();

COMMENT ON FUNCTION public.tg_transacao_antecipado_sem_banco() IS
  'Substitui transacao_antecipado_sem_banco_check: título antecipado só carrega banco depois de baixado, e só quando a antecipação manteve os títulos em aberto — o caso em que o banco debitou o valor de volta e o pagador quitou depois.';

-- ---------------------------------------------------------------------------
-- 4) A baixa do título antecipado passa a perguntar
-- ---------------------------------------------------------------------------
--
-- A assinatura ganha um argumento, então `CREATE OR REPLACE` criaria uma
-- sobrecarga em vez de substituir — e a chamada por nome ficaria ambígua entre
-- as duas. O DROP da assinatura antiga vem primeiro.

DROP FUNCTION IF EXISTS public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid
);

CREATE OR REPLACE FUNCTION public.baixar_transacao_pendente(
  p_transacao_id bigint,
  p_pago_em timestamp with time zone,
  p_banco_id bigint,
  p_metodopagamento text,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_baixado_por uuid DEFAULT NULL,
  p_lancar_no_caixa boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_metodo public.metodo_pagamento;
  v_antecipada boolean;
  v_lancar boolean := coalesce(p_lancar_no_caixa, false);
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_pago_em IS NULL THEN
    RAISE EXCEPTION 'Data do pagamento obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF p_banco_id IS NULL OR p_banco_id <= 0 THEN
    RAISE EXCEPTION 'Banco obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_metodopagamento), '') IS NULL THEN
    RAISE EXCEPTION 'Método de pagamento obrigatório.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_metodo := btrim(p_metodopagamento)::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Método de pagamento inválido: %.', btrim(p_metodopagamento)
      USING ERRCODE = '22023';
  END;

  SELECT adiantamento_id IS NOT NULL INTO v_antecipada
    FROM public.transacao WHERE id = p_transacao_id;

  -- Em título comum o banco sempre foi gravado, e a bandeira não tem o que
  -- dizer. Aceitá-la calada esconderia erro de quem chamou.
  IF v_lancar AND NOT coalesce(v_antecipada, false) THEN
    RAISE EXCEPTION
      'Só título antecipado escolhe se a baixa entra no caixa: neste o banco já é sempre gravado.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.transacao
  SET vencimento_em = coalesce(vencimento_em, data),
      data = p_pago_em,
      pago_em = p_pago_em,
      baixado_por = p_baixado_por,
      -- Título antecipado e honrado não traz dinheiro novo: o caixa já recebeu
      -- pela antecipação, e gravar o banco aqui contaria a mesma entrada duas
      -- vezes. Quando o banco debitou de volta é o contrário — o dinheiro entra
      -- agora, por este título, e `p_lancar_no_caixa` é quem sabe disso.
      banco_id = CASE
        WHEN coalesce(v_antecipada, false) AND NOT v_lancar THEN NULL
        ELSE p_banco_id
      END,
      metodopagamento = v_metodo,
      plano_de_conta_id = p_plano_de_conta_id,
      centro_custo_id = p_centro_custo_id,
      pendente = false,
      updated_at = now()
  WHERE id = p_transacao_id
    AND pendente = true
    AND is_deleted = false
  RETURNING * INTO v_transacao;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.transacao
      WHERE id = p_transacao_id AND is_deleted = false
    ) THEN
      RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    v_transacao.baixado_por, v_transacao.banco_id, v_transacao.metodopagamento
  );

  IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
    IF v_transacao.ordemservicoid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
    END IF;

    IF v_transacao.vendaid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
    END IF;

    IF v_transacao.pagamento_multiplo_id IS NOT NULL THEN
      PERFORM public.recalcular_documentos_da_transacao(v_transacao.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pago_em', v_transacao.pago_em,
    'vencimento_em', v_transacao.vencimento_em,
    'pendente', false,
    'lancado_no_caixa', v_transacao.banco_id IS NOT NULL
  );
END;
$function$;

ALTER FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, boolean
) OWNER TO postgres;

COMMENT ON FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, boolean
) IS
  'Dá baixa num título em aberto. Em título antecipado, p_lancar_no_caixa decide se a baixa move a conta: false (padrão) confirma que o boleto foi honrado e o dinheiro já entrou pela antecipação; true registra a entrada porque o banco havia debitado o valor de volta.';

-- ---------------------------------------------------------------------------
-- 5) O estorno alcança a baixa que é do título sozinho
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.estornar_baixa_transacao(
  p_transacao_id bigint,
  p_estornado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_acrescimos_removidos numeric(14,2) := 0;
  v_valor_reaberto numeric(14,2);
  v_baixa_do_titulo boolean := false;
BEGIN
  SELECT * INTO v_transacao
    FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_transacao.pendente, false) THEN
    RAISE EXCEPTION 'Esta transação não está liquidada: não há baixa a estornar.'
      USING ERRCODE = '22023';
  END IF;

  -- Título antecipado tem dois casos, e eles se comportam ao contrário um do
  -- outro. Quando a antecipação liquidou na hora, a baixa é do conjunto: a
  -- recusa abaixo continua, porque desfazê-la aqui deixaria a antecipação
  -- cobrindo valor que ninguém deve. Quando ela manteve os títulos em aberto, a
  -- baixa é deste título sozinho — veio depois, por quem acompanhou o
  -- vencimento — e é justamente a que pode estar errada.
  IF v_transacao.adiantamento_id IS NOT NULL THEN
    SELECT coalesce(a.adiantamento_manteve_pendentes, false) INTO v_baixa_do_titulo
      FROM public.transacao a WHERE a.id = v_transacao.adiantamento_id;

    IF NOT coalesce(v_baixa_do_titulo, false) THEN
      RAISE EXCEPTION
        'Este título foi liquidado pela antecipação #%. Desfaça a antecipação: ela devolve este título e os irmãos para em aberto de uma vez.',
        v_transacao.adiantamento_id USING ERRCODE = '22023';
    END IF;
  END IF;

  IF coalesce(v_transacao.eh_adiantamento, false) THEN
    RAISE EXCEPTION
      'Esta é uma antecipação, não a baixa de um título. Excluí-la é que devolve os títulos para em aberto.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta baixa é uma perna do pagamento múltiplo #%. Desfaça o pagamento inteiro.',
      v_transacao.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;

  -- Reabrir vem antes de mexer no valor, e não por estilo: a trava
  -- `transacao_valor_apos_baixa_trg` (20260806120000) recusa alterar o bruto
  -- enquanto `pendente = false`.
  --
  -- `data` volta a ser o vencimento. A baixa a havia trocado pela data do
  -- pagamento, e sem desfazer isso o título reabriria vencendo no dia em que
  -- foi pago.
  --
  -- O banco sai junto quando o título é antecipado: ele voltou a ser um título
  -- em aberto marcado como antecipado, o estado em que a antecipação o deixou, e
  -- lá o banco é nulo. Deixá-lo preenchido manteria no extrato uma entrada de
  -- título que não está mais pago. O vínculo `adiantamento_id` fica — a
  -- antecipação continua de pé; o que se desfez foi a baixa.
  UPDATE public.transacao
     SET pendente = true,
         data = coalesce(vencimento_em, data),
         pago_em = NULL,
         baixado_por = NULL,
         banco_id = CASE WHEN v_transacao.adiantamento_id IS NOT NULL THEN NULL ELSE banco_id END,
         updated_at = now()
   WHERE id = p_transacao_id;

  -- O acréscimo era do pagamento: juros e multa nasceram do atraso até aquela
  -- data, e a data deixou de existir. O título volta a valer o que devia.
  -- Desconto não entra aqui — ele mexe só no líquido, e a taxa da maquineta ou
  -- o abatimento concedido são negociação à parte, não consequência da data.
  WITH removidos AS (
    DELETE FROM public.transacao_ajuste
     WHERE transacao_id = p_transacao_id
       AND natureza = 'ACRESCIMO'
    RETURNING valor_calculado
  )
  SELECT coalesce(sum(valor_calculado), 0) INTO v_acrescimos_removidos FROM removidos;

  -- O DELETE acima já dispara o recálculo — mas só quando havia linha de ajuste.
  -- Transação antiga, ou restaurada de auditoria, carrega `valor_acrescimos` sem
  -- linha nenhuma por trás; sem isto ela reabriria ainda valendo o valor com
  -- juros, e nada mais o corrigiria.
  v_valor_reaberto := round(coalesce(v_transacao.valor_base, v_transacao.valor), 2);

  UPDATE public.transacao
     SET valor = v_valor_reaberto,
         valor_acrescimos = 0,
         "valorLiquido" = round(v_valor_reaberto - coalesce(valor_descontos, 0), 2),
         updated_at = now()
   WHERE id = p_transacao_id;

  -- O estorno é um evento do livro, ao lado da baixa que ele desfaz. Guarda o
  -- banco e o método de onde o dinheiro saiu, porque é isso que some do fluxo.
  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id,
    coalesce(v_transacao.vencimento_em, v_transacao.data),
    -- Lançamento registrado já pago não passou pela RPC de baixa e pode não ter
    -- `pago_em`; a data do lançamento é o que se sabe sobre quando o dinheiro andou.
    coalesce(v_transacao.pago_em, v_transacao.data),
    p_estornado_por,
    v_transacao.banco_id,
    v_transacao.metodopagamento,
    'ESTORNO'
  );

  -- O status da OS ou da venda se acerta sozinho: `trg_recalcular_status_financeiro_os`
  -- dispara no UPDATE de `pendente` e refaz a conta do documento.

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', true,
    'valor', v_valor_reaberto,
    'acrescimos_removidos', v_acrescimos_removidos,
    'vencimento_em', coalesce(v_transacao.vencimento_em, v_transacao.data)
  );
END;
$$;

ALTER FUNCTION public.estornar_baixa_transacao(bigint, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) IS
  'Tira a transação do fluxo de caixa: desfaz a baixa, remove os acréscimos do pagamento e devolve o título para a pagar ou a receber. Em título antecipado só alcança a baixa feita pelo próprio título, no modo que manteve os títulos em aberto.';

REVOKE ALL ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Desfazer a antecipação não pode apagar dinheiro que entrou por fora dela
-- ---------------------------------------------------------------------------
--
-- `desfazer_adiantamento` reabre os títulos em bloco. Isso era seguro enquanto
-- título antecipado nunca carregava banco: reabrir não apagava movimento nenhum.
--
-- A baixa com lançamento muda isso. Aquele título tem uma entrada real no
-- extrato — o banco havia debitado o valor de volta e o pagador quitou depois.
-- Reabri-lo em bloco apagaria essa entrada de lado, sem registro e sem que
-- ninguém pedisse, e o saldo da conta cairia sem explicação.
--
-- Então a operação recusa e aponta o caminho, que agora existe: estornar aquela
-- baixa primeiro. Depois disso o título volta a ser um antecipado em aberto e a
-- antecipação pode ser desfeita inteira.
CREATE OR REPLACE FUNCTION public.desfazer_adiantamento(
  p_id bigint,
  p_deleted_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_adiantamento public.transacao%ROWTYPE;
  v_titulos bigint[];
  v_documentos jsonb;
  v_titulo record;
  v_com_lancamento bigint[];
BEGIN
  SELECT * INTO v_adiantamento
    FROM public.transacao
   WHERE id = p_id AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento #% não encontrado.', p_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_adiantamento.eh_adiantamento, false) THEN
    RAISE EXCEPTION 'O lançamento #% não é uma antecipação.', p_id USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(id) INTO v_titulos
    FROM public.transacao
   WHERE adiantamento_id = p_id AND is_deleted = false;

  -- Título antecipado com banco só existe de um jeito: baixa com lançamento,
  -- feita porque o banco havia debitado o valor de volta.
  SELECT array_agg(id) INTO v_com_lancamento
    FROM public.transacao
   WHERE adiantamento_id = p_id AND is_deleted = false
     AND pendente = false AND banco_id IS NOT NULL;

  IF v_com_lancamento IS NOT NULL THEN
    RAISE EXCEPTION
      'O título #% foi baixado com lançamento: o dinheiro dele entrou na conta por fora desta antecipação. Estorne essa baixa antes de desfazer a antecipação.',
      v_com_lancamento[1] USING ERRCODE = '22023';
  END IF;

  -- Quais documentos serão afetados, capturado antes de soltar o vínculo.
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
           'tipo', CASE WHEN t.ordemservicoid IS NOT NULL THEN 'OS' ELSE 'VENDA' END,
           'id', coalesce(t.ordemservicoid, t.vendaid))), '[]'::jsonb)
    INTO v_documentos
    FROM public.transacao t
   WHERE t.id = ANY (coalesce(v_titulos, ARRAY[]::bigint[]))
     AND coalesce(t.ordemservicoid, t.vendaid) IS NOT NULL;

  IF v_titulos IS NOT NULL THEN
    -- O título volta ao estado anterior à antecipação: em aberto, sem data de
    -- pagamento e sem quem baixou. O banco já era nulo — o dinheiro tinha
    -- entrado pela antecipação, não por ele, e o guarda acima garante que
    -- nenhum deles trouxe dinheiro por conta própria.
    UPDATE public.transacao
       SET pendente = true,
           pago_em = NULL,
           baixado_por = NULL,
           adiantamento_id = NULL,
           updated_at = now()
     WHERE id = ANY (v_titulos);

    -- O histórico de baixa NÃO é tocado: o sistema o trata como imutável, e com
    -- razão — ele registra que aquela baixa aconteceu, e ela aconteceu mesmo. O
    -- desfazimento é um fato novo, não uma correção do passado. Quem abrir o
    -- título vai ver que foi baixado por antecipação e depois reaberto.
  END IF;

  UPDATE public.transacao
     SET is_deleted = true,
         deleted_at = now(),
         deleted_by = p_deleted_by,
         updated_at = now()
   WHERE id = p_id;

  -- Título reaberto muda o que a OS ou a venda tem de recebido.
  FOR v_titulo IN
    SELECT DISTINCT t.ordemservicoid, t.vendaid
      FROM public.transacao t
     WHERE t.id = ANY (coalesce(v_titulos, ARRAY[]::bigint[]))
  LOOP
    IF v_titulo.ordemservicoid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_os(v_titulo.ordemservicoid);
    ELSIF v_titulo.vendaid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_venda(v_titulo.vendaid);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'id', p_id,
    'titulos_revertidos', coalesce(array_length(v_titulos, 1), 0),
    'titulos', coalesce(to_jsonb(v_titulos), '[]'::jsonb),
    'documentos', v_documentos,
    'tipo', v_adiantamento.tipo::text
  );
END;
$function$;

ALTER FUNCTION public.desfazer_adiantamento(bigint, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.desfazer_adiantamento(bigint, uuid) IS
  'Exclui a transação de antecipação e devolve os títulos que ela liquidou para em aberto, numa operação só. Recusa quando algum título já foi baixado com lançamento próprio.';

REVOKE ALL ON FUNCTION public.desfazer_adiantamento(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desfazer_adiantamento(bigint, uuid) TO service_role;

COMMIT;
