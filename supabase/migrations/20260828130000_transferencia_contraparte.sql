-- Transferência entre contas: a contraparte que faltava.
--
-- O QUE QUEBRAVA
-- `registrar_transferencia_entre_contas` (20260824120000) monta as duas pernas
-- sem `nomepagador` e sem `cpfcnpjpagador`. As duas colunas são NOT NULL em
-- `transacao` desde a baseline e não têm default, então o primeiro INSERT
-- abortava e a RPC inteira ia junto:
--
--   null value in column "nomepagador" of relation "transacao"
--   violates not-null constraint
--
-- Ou seja: NENHUMA transferência jamais foi gravada. Não há linha antiga para
-- corrigir — o que falhava falhava por inteiro, e é justamente o que a RPC
-- existe para garantir.
--
-- O QUE ENTRA NO LUGAR
-- A contraparte de cada perna é A OUTRA CONTA. Quem olha o extrato da conta de
-- origem vê o dinheiro saindo *para* a conta de destino, e vice-versa — é a
-- leitura que a conciliação precisa, e é a mesma informação que a descrição já
-- carrega. Não inventamos um pagador externo: transferência entre contas
-- próprias não tem um.
--
-- `cpfcnpjpagador` fica em 'NÃO INFORMADO', como no adiantamento e na baixa por
-- antecipação: as duas pontas são da própria empresa, não há documento de
-- terceiro a registrar. E documento não vira vínculo por semelhança de texto —
-- deixar o CNPJ da empresa aqui só criaria um "cliente" fantasma nos relatórios
-- de contraparte.
--
-- O resto do corpo é idêntico ao de 20260824120000.
BEGIN;

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
    RAISE EXCEPTION 'O valor da transferência deve ser maior que zero.'
      USING ERRCODE = '22023';
  END IF;
  v_valor := round(p_valor, 2);

  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Data da transferência obrigatória.' USING ERRCODE = '22023';
  END IF;

  IF p_banco_origem_id IS NULL OR p_banco_destino_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de origem e a de destino.' USING ERRCODE = '22023';
  END IF;

  IF p_banco_origem_id = p_banco_destino_id THEN
    RAISE EXCEPTION
      'A conta de origem e a de destino são a mesma: não há transferência a registrar.'
      USING ERRCODE = '22023';
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

  SELECT titulo INTO v_origem FROM public.bancoconta WHERE id = p_banco_origem_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT titulo INTO v_destino FROM public.bancoconta WHERE id = p_banco_destino_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0002';
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

  /*
   * As duas pernas carregam os MESMOS valor, data, método e vínculo. O que muda
   * é só o sentido, a conta, o texto e a contraparte — e é de propósito que seja
   * tão pouco: o gatilho de imutabilidade de 20260824120000 depende de as duas
   * serem espelho uma da outra para poder recusar qualquer edição que desfaça o
   * par.
   *
   * `pendente = false` nas duas, sem opção de agendar: a transferência é fato
   * consumado quando alguém a registra. Um par pendente ficaria em A Pagar e em
   * A Receber ao mesmo tempo, com a empresa cobrando a si mesma.
   */

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido",
    valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento,
    nomepagador, cpfcnpjpagador,
    categoria_id, plano_de_conta_id, centro_custo_id,
    transferencia_id, created_by, baixado_por
  ) VALUES (
    coalesce(v_descricao, 'Transferência para ' || v_destino),
    v_valor, v_valor, v_valor, 0, 0,
    p_data, p_data, p_data, p_data,
    'DESPESA'::public.tipos_transacao, false, p_banco_origem_id, v_metodo,
    v_destino, 'NÃO INFORMADO',
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
    coalesce(v_descricao, 'Transferência de ' || v_origem),
    v_valor, v_valor, v_valor, 0, 0,
    p_data, p_data, p_data, p_data,
    'RECEITA'::public.tipos_transacao, false, p_banco_destino_id, v_metodo,
    v_origem, 'NÃO INFORMADO',
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
  'Move dinheiro entre duas contas proprias: grava a operacao e as duas pernas numa transacao so. A perna de saida e DESPESA na origem, a de entrada e RECEITA no destino, ambas liquidadas e fora do resultado. A contraparte de cada perna e o titulo da outra conta.';

COMMIT;
