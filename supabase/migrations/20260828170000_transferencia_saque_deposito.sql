-- Transferencias entre contas sao movimentos de tesouraria.
--
-- A operacao sempre teve um vinculo proprio (`transferencia_id`) e duas pernas,
-- mas a RPC as gravava como DESPESA na origem e RECEITA no destino. Embora o
-- saldo bancario fechasse, a classificacao dizia que a empresa gastou e faturou
-- o proprio dinheiro. A forma canonica e SAQUE na origem e DEPOSITO no destino.
--
-- Esta migration tambem recompõe a guarda acumulada da DRE. A versao criada por
-- 20260825140000 preservou lancamentos de despesas de OS, mas perdeu as guardas
-- adicionadas depois para baixa parcial e transferencia. O tipo novo ja bastaria
-- para retirar a transferencia do resultado; manter a flag na guarda evita que
-- uma classificacao antiga ou inconsistente volte a produzir resultado.

BEGIN;

-- Antes de tocar o historico, prove que cada operacao ainda tem exatamente uma
-- perna em cada conta. Abortar e melhor que escolher um sentido por heuristica.
DO $validar_transferencias$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.transacao_transferencia tr
      LEFT JOIN LATERAL (
        SELECT count(*) AS total,
               count(*) FILTER (WHERE t.banco_id = tr.banco_origem_id) AS origens,
               count(*) FILTER (WHERE t.banco_id = tr.banco_destino_id) AS destinos
          FROM public.transacao t
         WHERE t.transferencia_id = tr.id
      ) pernas ON true
     WHERE pernas.total <> 2
        OR pernas.origens <> 1
        OR pernas.destinos <> 1
  ) THEN
    RAISE EXCEPTION
      'Existem transferencias sem exatamente uma perna na origem e uma no destino.';
  END IF;
END
$validar_transferencias$;

-- ---------------------------------------------------------------------------
-- Registrar novas transferencias
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_transferencia_entre_contas(
  p_valor numeric,
  p_data timestamp with time zone,
  p_banco_origem_id bigint,
  p_banco_destino_id bigint,
  p_metodopagamento text,
  p_descricao text DEFAULT NULL,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_criado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_metodo public.metodo_pagamento;
  v_valor numeric(14,2);
  v_origem text;
  v_destino text;
  v_categoria_id integer;
  v_transferencia_id bigint;
  v_saida_id bigint;
  v_entrada_id bigint;
  v_descricao text;
BEGIN
  IF p_valor IS NULL OR round(p_valor, 2) <= 0 THEN
    RAISE EXCEPTION 'O valor da transferencia deve ser maior que zero.'
      USING ERRCODE = '22023';
  END IF;
  v_valor := round(p_valor, 2);

  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Data da transferencia obrigatoria.' USING ERRCODE = '22023';
  END IF;

  IF p_banco_origem_id IS NULL OR p_banco_destino_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de origem e a de destino.' USING ERRCODE = '22023';
  END IF;

  IF p_banco_origem_id = p_banco_destino_id THEN
    RAISE EXCEPTION
      'A conta de origem e a de destino sao a mesma: nao ha transferencia a registrar.'
      USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(p_metodopagamento), '') IS NULL THEN
    RAISE EXCEPTION 'Metodo de pagamento obrigatorio.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_metodo := btrim(p_metodopagamento)::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido: %.', btrim(p_metodopagamento)
      USING ERRCODE = '22023';
  END;

  SELECT titulo INTO v_origem FROM public.bancoconta WHERE id = p_banco_origem_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de origem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT titulo INTO v_destino FROM public.bancoconta WHERE id = p_banco_destino_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de destino nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  v_origem := coalesce(nullif(btrim(v_origem), ''), 'conta #' || p_banco_origem_id);
  v_destino := coalesce(nullif(btrim(v_destino), ''), 'conta #' || p_banco_destino_id);
  v_descricao := nullif(btrim(coalesce(p_descricao, '')), '');

  SELECT id INTO v_categoria_id
    FROM public.categoriatransacao WHERE codigo_sistema = 'TRANSFERENCIA' LIMIT 1;

  INSERT INTO public.transacao_transferencia
    (valor, data, banco_origem_id, banco_destino_id, metodopagamento,
     descricao, criado_por)
  VALUES
    (v_valor, p_data, p_banco_origem_id, p_banco_destino_id, v_metodo,
     v_descricao, p_criado_por)
  RETURNING id INTO v_transferencia_id;

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido",
    valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento,
    nomepagador, cpfcnpjpagador,
    categoria_id, plano_de_conta_id, centro_custo_id,
    transferencia_id, created_by, baixado_por
  ) VALUES (
    coalesce(v_descricao, 'Transferencia para ' || v_destino),
    v_valor, v_valor, v_valor, 0, 0,
    p_data, p_data, p_data, p_data,
    'SAQUE'::public.tipos_transacao, false, p_banco_origem_id, v_metodo,
    v_destino, 'NAO INFORMADO',
    v_categoria_id, p_plano_de_conta_id, p_centro_custo_id,
    v_transferencia_id, p_criado_por, p_criado_por
  ) RETURNING id INTO v_saida_id;

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido",
    valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento,
    nomepagador, cpfcnpjpagador,
    categoria_id, plano_de_conta_id, centro_custo_id,
    transferencia_id, created_by, baixado_por
  ) VALUES (
    coalesce(v_descricao, 'Transferencia de ' || v_origem),
    v_valor, v_valor, v_valor, 0, 0,
    p_data, p_data, p_data, p_data,
    'DEPOSITO'::public.tipos_transacao, false, p_banco_destino_id, v_metodo,
    v_origem, 'NAO INFORMADO',
    v_categoria_id, p_plano_de_conta_id, p_centro_custo_id,
    v_transferencia_id, p_criado_por, p_criado_por
  ) RETURNING id INTO v_entrada_id;

  RETURN jsonb_build_object(
    'transferencia_id', v_transferencia_id,
    'saida_id', v_saida_id,
    'entrada_id', v_entrada_id,
    'valor', v_valor,
    'banco_origem', v_origem,
    'banco_destino', v_destino
  );
END;
$function$;

ALTER FUNCTION public.registrar_transferencia_entre_contas(
  numeric, timestamp with time zone, bigint, bigint, text, text, integer, integer, uuid
) OWNER TO postgres;

COMMENT ON FUNCTION public.registrar_transferencia_entre_contas(
  numeric, timestamp with time zone, bigint, bigint, text, text, integer, integer, uuid
) IS
  'Move dinheiro entre duas contas proprias: SAQUE na origem e DEPOSITO no destino, ambos liquidados, ligados e fora do resultado. A contraparte de cada perna e o titulo da outra conta.';

COMMENT ON COLUMN public.transacao_transferencia.banco_origem_id IS
  'Conta de onde o dinheiro saiu. Recebe a perna de SAQUE.';
COMMENT ON COLUMN public.transacao_transferencia.banco_destino_id IS
  'Conta para onde o dinheiro foi. Recebe a perna de DEPOSITO.';

-- ---------------------------------------------------------------------------
-- Guarda cumulativa da DRE
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_transacao(p_transacaoid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx public.transacao%ROWTYPE;
  v_linha_id integer;
  v_exclui boolean := false;
  v_natureza text;
  v_natureza_dre text;
BEGIN
  SELECT * INTO v_tx FROM public.transacao WHERE id = p_transacaoid;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_tx.is_deleted
     OR v_tx.evento_financeiro_id IS NOT NULL
     OR v_tx.lancamento_id IS NOT NULL
     OR v_tx.ordemservicoid IS NOT NULL
     OR v_tx.vendaid IS NOT NULL
     OR v_tx.entrada_id IS NOT NULL
     OR v_tx.usoconsumo_entrada_id IS NOT NULL
     OR v_tx.origem = 'ORIGEM_MIGRACAO'
     OR v_tx.pagamento_multiplo_id IS NOT NULL
     OR coalesce(v_tx.eh_adiantamento, false)
     OR v_tx.adiantamento_id IS NOT NULL
     OR v_tx.baixa_de_transacao_id IS NOT NULL
     OR v_tx.transferencia_id IS NOT NULL
     OR upper(v_tx.tipo::text) IN ('SAQUE', 'DEPOSITO') THEN
    UPDATE public.eventos_financeiros
       SET status = 'CANCELADO', updated_at = now()
     WHERE source_type = 'TRANSACAO'
       AND source_id = p_transacaoid
       AND status = 'ATIVO';
    RETURN;
  END IF;

  SELECT mp.linha_id, mp.exclui_do_resultado
    INTO v_linha_id, v_exclui
    FROM public.planosdeconta pc
    JOIN public.dre_mapeamento mp
      ON mp.origem_tipo = 'PLANO_GRUPO'
     AND mp.origem_id = pc.grupo_id
     AND mp.ativo
   WHERE pc.id = v_tx.plano_de_conta_id
   LIMIT 1;

  IF coalesce(v_exclui, false) THEN
    UPDATE public.eventos_financeiros
       SET status = 'CANCELADO', updated_at = now()
     WHERE source_type = 'TRANSACAO'
       AND source_id = p_transacaoid
       AND status = 'ATIVO';
    RETURN;
  END IF;

  v_natureza := CASE
    WHEN upper(v_tx.tipo::text) = 'RECEITA' THEN 'RECEITA'
    ELSE 'DESPESA'
  END;

  SELECT dl.natureza_dre INTO v_natureza_dre
    FROM public.dre_linha dl WHERE dl.id = v_linha_id;

  v_natureza_dre := coalesce(
    v_natureza_dre,
    CASE WHEN v_natureza = 'RECEITA' THEN 'RECEITA' ELSE 'DESPESA' END
  );

  UPDATE public.eventos_financeiros
     SET natureza = v_natureza, updated_at = now()
   WHERE source_type = 'TRANSACAO'
     AND source_id = p_transacaoid
     AND status <> 'CONVERTIDO'
     AND natureza IS DISTINCT FROM v_natureza;

  INSERT INTO public.eventos_financeiros
    (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, competencia_em, dre_linha_id,
     centro_custo_id, transacaoid, dados_snapshot, pode_gerar_transacao, status)
  VALUES
    (null, 'TRANSACAO', p_transacaoid, 'AVULSO', v_natureza, v_natureza_dre,
     'TRANSACAO', coalesce(nullif(v_tx.descricao, ''), 'Lancamento #' || p_transacaoid),
     nullif(v_tx.plano_de_conta, ''), round(coalesce(v_tx.valor, 0), 2),
     coalesce(v_tx.competencia_em, v_tx.data), v_linha_id,
     v_tx.centro_custo_id, p_transacaoid,
     jsonb_build_object('categoria', v_tx.categoria, 'sem_classificacao', v_linha_id IS NULL),
     false, 'ATIVO')
  ON CONFLICT (source_type, source_id, origem, chave_origem, natureza)
    WHERE ordemservicoid IS NULL
  DO UPDATE SET valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                competencia_em = excluded.competencia_em,
                dre_linha_id = excluded.dre_linha_id,
                natureza_dre = excluded.natureza_dre,
                centro_custo_id = excluded.centro_custo_id,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  WHERE public.eventos_financeiros.status <> 'CONVERTIDO';
END;
$function$;

ALTER FUNCTION public.sincronizar_eventos_financeiros_transacao(bigint) OWNER TO postgres;

COMMENT ON FUNCTION public.sincronizar_eventos_financeiros_transacao(bigint) IS
  'Evento de resultado de uma transacao avulsa. Ignora liquidacoes e movimentos que nao sao resultado novo: documentos, estoque, migracao, antecipacao, baixa parcial, boleto de despesas, transferencia entre contas, saque e deposito.';

DROP TRIGGER IF EXISTS trg_eventos_financeiros_transacao ON public.transacao;
CREATE TRIGGER trg_eventos_financeiros_transacao
AFTER INSERT OR UPDATE OF
  valor, tipo, competencia_em, data, plano_de_conta_id, centro_custo_id,
  is_deleted, descricao, origem, pagamento_multiplo_id, lancamento_id,
  eh_adiantamento, adiantamento_id, baixa_de_transacao_id, transferencia_id
ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_transacao();

-- ---------------------------------------------------------------------------
-- Historico: DESPESA/RECEITA -> SAQUE/DEPOSITO
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao
  DISABLE TRIGGER transacao_transferencia_imutavel_trg;

UPDATE public.transacao t
   SET tipo = CASE
       WHEN t.banco_id = tr.banco_origem_id
         THEN 'SAQUE'::public.tipos_transacao
       ELSE 'DEPOSITO'::public.tipos_transacao
     END,
       updated_at = now()
  FROM public.transacao_transferencia tr
 WHERE t.transferencia_id = tr.id
   AND t.tipo IS DISTINCT FROM CASE
       WHEN t.banco_id = tr.banco_origem_id
         THEN 'SAQUE'::public.tipos_transacao
       ELSE 'DEPOSITO'::public.tipos_transacao
     END;

ALTER TABLE public.transacao
  ENABLE TRIGGER transacao_transferencia_imutavel_trg;

-- A atualizacao de tipo ja dispara o trigger. A chamada explicita tambem limpa
-- eventos de pernas que ja estivessem canonicas e repara as demais guardas que
-- versoes posteriores da funcao haviam perdido.
DO $ressincronizar_exclusoes$
DECLARE
  v_id bigint;
BEGIN
  FOR v_id IN
    SELECT id
      FROM public.transacao
     WHERE pagamento_multiplo_id IS NOT NULL
        OR lancamento_id IS NOT NULL
        OR baixa_de_transacao_id IS NOT NULL
        OR transferencia_id IS NOT NULL
     ORDER BY id
  LOOP
    PERFORM public.sincronizar_eventos_financeiros_transacao(v_id);
  END LOOP;
END
$ressincronizar_exclusoes$;

DO $validar_resultado$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.transacao t
      JOIN public.transacao_transferencia tr ON tr.id = t.transferencia_id
     WHERE (t.banco_id = tr.banco_origem_id AND upper(t.tipo::text) <> 'SAQUE')
        OR (t.banco_id = tr.banco_destino_id AND upper(t.tipo::text) <> 'DEPOSITO')
  ) THEN
    RAISE EXCEPTION 'A reclassificacao das transferencias nao ficou canonica.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.eventos_financeiros e
      JOIN public.transacao t
        ON e.source_type = 'TRANSACAO' AND e.source_id = t.id
     WHERE t.transferencia_id IS NOT NULL
       AND e.status = 'ATIVO'
  ) THEN
    RAISE EXCEPTION 'Ainda existem eventos ativos de DRE para transferencias.';
  END IF;
END
$validar_resultado$;

COMMIT;
