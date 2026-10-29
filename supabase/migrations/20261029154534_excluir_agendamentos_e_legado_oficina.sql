begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Exclusão física autorizada para esta instalação. Nunca apaga dados de negócio:
-- a migration recusa tabelas do legado com registros e vínculos ainda preenchidos.
do $$
declare nome text; tem_dados boolean;
begin
  foreach nome in array array['agendamento', 'aluguel', 'aluguel_checklist', 'aluguel_checklist_imagem', 'aluguel_checklist_item', 'aluguel_evento', 'aluguel_item', 'checklist', 'checklist_documento', 'checklist_documento_arquivo', 'checklist_documento_assinatura', 'checklist_documento_convite_assinatura', 'checklist_documento_evento', 'checklist_modelo', 'checklist_modelo_item', 'checklist_video', 'cores_veiculos', 'imagemvistoria', 'lote_imagem', 'lote_pecas', 'lotes', 'orcamento', 'orcamento_produto', 'orcamento_produto_avulso', 'orcamento_servico', 'ordemservico', 'os_comissao_criacao', 'os_notificacao_entrega', 'os_notificacao_evento', 'os_saida', 'os_saida_checklist_imagem', 'os_saida_checklist_item', 'os_termo_impressao', 'osanexo', 'osaprovacao', 'ositem_historico', 'osproduto', 'osproduto_avulso', 'osproduto_baixa', 'osservico', 'osservico_realizador', 'peca', 'transferencias_veiculos', 'veiculo', 'veiculo_imagem', 'nfse_os_servico_vinculo'] loop
    if to_regclass('public.' || nome) is not null then
      execute format('lock table public.%I in access exclusive mode', nome);
      execute format('select exists(select 1 from public.%I)', nome) into tem_dados;
      if tem_dados then raise exception 'Tabela % contém dados. Migre os registros antes de excluir.', nome; end if;
    end if;
  end loop;
end $$;

-- Mantém os nomes, tipos e ordem das colunas consumidas pelos módulos atuais.
create or replace view public.eventos_financeiros_fila with (security_invoker=true) as
select e.id, e.ordemservicoid, e.origem, e.natureza, e.status, e.chave_origem,
 e.descricao, e.detalhe, e.valor, e.data_evento, e.produtoid, e.servicoid,
 e.usuarioid, e.quantidade_snapshot, e.valor_unitario_snapshot, e.percentual_snapshot,
 e.valor_base_snapshot, e.dados_snapshot, e.pode_gerar_transacao, e.transacaoid,
 e.created_at, e.updated_at, e.created_by, e.source_type, e.source_id, e.source_item_id,
 e.competencia_em, e.natureza_dre, e.centro_custo_id, e.estorno_de_id, e.is_manual,
 e.dre_linha_id, e.lancamento_id, e.consumo_saida_id, e.consumo_usoconsumo_saida_id,
 'VENDA'::text as documento_tipo, v.id as documento_id, v.clienteid as cliente_id,
 null::jsonb as ordem,
 jsonb_build_object('id',v.id,'status',v.status,'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) as venda
from public.eventos_financeiros e
join public.venda v on e.source_type='VENDA' and e.source_id=v.id
 and (e.origem='COMISSAO' or e.is_manual and coalesce(e.chave_origem,'') like 'MANUAL:%')
left join public.cliente c on c.id=v.clienteid
where e.ordemservicoid is null;

create or replace view public.transacao_cliente with (security_invoker=true) as
select t.id as transacao_id, coalesce(t.cliente_id,v.clienteid) as cliente_id,
 t.valor,t.valor_acrescimos,t.valor_baixado,t.pendente,t.data,t.vencimento_em,t.pago_em,
 t.ordemservicoid,t.vendaid,t.metodopagamento,t.origem
from public.transacao t
left join public.venda v on v.id=t.vendaid
where t.tipo='RECEITA'::public.tipos_transacao and t.is_deleted=false and t.evento_financeiro_id is null;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.abonar_transacao_pendente(p_transacao_id bigint, p_abonado_por uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_atual public.transacao%ROWTYPE;
  v_transacao public.transacao%ROWTYPE;
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transação inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_atual.pendente, false) THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  IF upper(v_atual.tipo::text) <> 'RECEITA' THEN
    RAISE EXCEPTION 'Só é possível abonar uma cobrança a receber.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.ordemservicoid IS NULL AND v_atual.vendaid IS NULL THEN
    RAISE EXCEPTION 'Este lançamento não está ligado a uma OS ou venda.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.evento_financeiro_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este lançamento é um evento financeiro da OS, não uma cobrança avulsa.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.adiantamento_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Este título está ligado à antecipação #%. Desfaça a antecipação primeiro.',
      v_atual.adiantamento_id USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_atual.eh_adiantamento, false) THEN
    RAISE EXCEPTION 'Isto é uma antecipação, não uma cobrança avulsa.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta cobrança faz parte do pagamento múltiplo #%. Desfaça o grupo primeiro.',
      v_atual.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.transacao
     SET pendente = false,
         banco_id = NULL,
         metodopagamento = NULL,
         baixado_por = NULL,
         pago_em = now(),
         abonado = true,
         abonado_por = p_abonado_por,
         abonado_em = now(),
         abono_motivo = nullif(btrim(coalesce(p_motivo, '')), ''),
         updated_at = now()
   WHERE id = p_transacao_id
     AND pendente = true
     AND is_deleted = false
  RETURNING * INTO v_transacao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id, coalesce(v_transacao.vencimento_em, v_transacao.data), v_transacao.pago_em,
    p_abonado_por, NULL, NULL, 'ABONO'
  );

  IF v_transacao.ordemservicoid IS NOT NULL THEN
    NULL; /* integração de OS removida */
  END IF;
  IF v_transacao.vendaid IS NOT NULL THEN
    PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', false,
    'abonado', true,
    'abonado_em', v_transacao.abonado_em
  );
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.baixar_com_credito_cliente(p_transacao_id bigint, p_pago_em timestamp with time zone, p_plano_de_conta_id integer DEFAULT NULL::integer, p_centro_custo_id integer DEFAULT NULL::integer, p_baixado_por uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_atual public.transacao%ROWTYPE;
  v_transacao public.transacao%ROWTYPE;
  v_tipo text;
  v_cliente_id integer;
  v_sentido text;
  v_valor numeric(14,2);
  v_saldo_anterior numeric(14,2);
  v_saldo_resultante numeric(14,2);
  v_movimento_id bigint;
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_pago_em IS NULL THEN
    RAISE EXCEPTION 'Data do pagamento obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_atual.pendente, false) THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  v_tipo := upper(v_atual.tipo::text);
  IF v_tipo NOT IN ('RECEITA', 'DESPESA') THEN
    RAISE EXCEPTION
      'Crédito do cliente vale para título a receber ou a pagar, não para depósito ou saque.'
      USING ERRCODE = '22023';
  END IF;

  -- As mesmas recusas do abono: são conjuntos que se liquidam juntos, e mexer
  -- numa perna sozinha desmonta a conta do grupo.
  IF v_atual.baixa_de_transacao_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta linha é o dinheiro de uma baixa parcial, não um título.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.adiantamento_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Este título está ligado à antecipação #%. Desfaça a antecipação primeiro.',
      v_atual.adiantamento_id USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_atual.eh_adiantamento, false) THEN
    RAISE EXCEPTION 'Isto é uma antecipação, não uma cobrança avulsa.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta cobrança faz parte do pagamento múltiplo #%. Desfaça o grupo primeiro.',
      v_atual.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;
  IF v_atual.transferencia_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta linha é uma perna de transferência entre contas.' USING ERRCODE = '22023';
  END IF;
  -- O crédito quita o título inteiro, então um título que já recebeu pagamento
  -- em partes não entra: o resto dele mora nas filhas, e fechá-lo por aqui
  -- deixaria o dinheiro contado duas vezes.
  IF coalesce(v_atual.valor_baixado, 0) > 0 THEN
    RAISE EXCEPTION
      'Este título já foi pago em partes. O crédito do cliente só quita título inteiro.'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------- de quem é
  IF v_tipo = 'RECEITA' THEN
    v_cliente_id := coalesce(
      v_atual.cliente_id,
      (SELECT vd.clienteid FROM public.venda vd WHERE vd.id = v_atual.vendaid)
    );
  ELSE
    -- Numa despesa o vínculo com OS/venda é do fornecedor, não do cliente: o
    -- único dono possível é o que foi gravado na própria linha.
    v_cliente_id := v_atual.cliente_id;
  END IF;

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION
      'Este lançamento não tem cliente vinculado. Informe o cliente nele antes de usar o crédito.'
      USING ERRCODE = '22023';
  END IF;

  v_valor := round(coalesce(nullif(v_atual."valorLiquido", 0), v_atual.valor, 0), 2);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'O título não tem valor a baixar.' USING ERRCODE = '22023';
  END IF;

  -- A receber consome a carteira; a pagar abastece.
  v_sentido := CASE WHEN v_tipo = 'RECEITA' THEN 'DEBITO' ELSE 'CREDITO' END;

  SELECT c.saldo_credito INTO v_saldo_anterior
    FROM public.cliente c
   WHERE c.id = v_cliente_id AND c.is_deleted = false
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  v_saldo_anterior := coalesce(v_saldo_anterior, 0);
  v_saldo_resultante := CASE
    WHEN v_sentido = 'CREDITO' THEN v_saldo_anterior + v_valor
    ELSE v_saldo_anterior - v_valor
  END;

  IF v_saldo_resultante < 0 THEN
    RAISE EXCEPTION
      'O cliente tem R$ % de crédito e este título é de R$ %.',
      to_char(v_saldo_anterior, 'FM999999990.00'),
      to_char(v_valor, 'FM999999990.00')
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------- a baixa
  UPDATE public.transacao
     SET vencimento_em = coalesce(vencimento_em, data),
         data = p_pago_em,
         pago_em = p_pago_em,
         pendente = false,
         -- Nunca passa por conta: é isto que mantém a linha fora do Fluxo e do
         -- saldo dos bancos, como já acontece no título quitado por antecipação
         -- e no abonado.
         banco_id = NULL,
         metodopagamento = 'CREDITO CLIENTE'::public.metodo_pagamento,
         baixado_por = p_baixado_por,
         plano_de_conta_id = coalesce(p_plano_de_conta_id, plano_de_conta_id),
         centro_custo_id = coalesce(p_centro_custo_id, centro_custo_id),
         updated_at = now()
   WHERE id = p_transacao_id
     AND pendente = true
     AND is_deleted = false
  RETURNING * INTO v_transacao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.cliente_saldo_movimento (
    cliente_id, sentido, origem, acao, valor,
    saldo_anterior, saldo_resultante, transacao_id, motivo, created_by
  ) VALUES (
    v_cliente_id, v_sentido, 'TRANSACAO', 'REGISTRO', v_valor,
    v_saldo_anterior, round(v_saldo_resultante, 2), v_transacao.id,
    CASE
      WHEN v_sentido = 'DEBITO' THEN 'Baixa do título #' || v_transacao.id
      ELSE 'Crédito gerado pelo título #' || v_transacao.id
    END,
    p_baixado_por
  ) RETURNING id INTO v_movimento_id;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    p_baixado_por, NULL, 'CREDITO CLIENTE', 'BAIXA'
  );

  IF v_tipo = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
    IF v_transacao.ordemservicoid IS NOT NULL THEN
      NULL; /* integração de OS removida */
    END IF;
    IF v_transacao.vendaid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', false,
    'cliente_id', v_cliente_id,
    'sentido', v_sentido,
    'valor', v_valor,
    'movimento_id', v_movimento_id,
    'saldo', round(v_saldo_resultante, 2)
  );
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.baixar_transacao_pendente(p_transacao_id bigint, p_pago_em timestamp with time zone, p_banco_id bigint, p_metodopagamento text, p_plano_de_conta_id integer DEFAULT NULL::integer, p_centro_custo_id integer DEFAULT NULL::integer, p_baixado_por uuid DEFAULT NULL::uuid, p_valor numeric DEFAULT NULL::numeric, p_valor_lancado numeric DEFAULT NULL::numeric, p_ajustes jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_metodo public.metodo_pagamento;
  v_antecipada boolean;
  v_atual public.transacao%ROWTYPE;
  v_liquido numeric(14,2);
  v_saldo numeric(14,2);
  v_filha_id bigint;
  v_lancado numeric(14,2);
  v_valor numeric(14,2);
  v_item jsonb;
  v_tipo_id integer;
  v_modo text;
  v_natureza text;
  v_informado numeric;
  v_calculado numeric(14,2);
  v_base numeric(14,2);
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

  SELECT * INTO v_atual FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_atual.pendente, false) THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  /*
   * Os acrescimos e descontos entram AQUI, e a posicao e a regra.
   *
   * O titulo esta travado pelo FOR UPDATE logo acima e ainda esta pendente —
   * que e exatamente o estado que tg_transacao_ajuste_coerente (20260806140000)
   * exige para aceitar ACRESCIMO, porque acrescimo mexe no bruto e bruto de
   * titulo baixado e imutavel (20260806120000).
   *
   * Era essa ordem — lancar o juros, salvar, so entao baixar — que a tela era
   * obrigada a fazer em dois dialogos e duas idas ao servidor. Agora cabe numa
   * transacao so: recusado o ajuste, a baixa inteira nao aconteceu.
   *
   * Quem faz a conta do percentual e esta funcao, e nao a rota: ela ja detem o
   * FOR UPDATE, e converter no Node abriria uma janela em que a base lida la
   * nao e a base travada aqui.
   */
  IF p_ajustes IS NOT NULL AND jsonb_typeof(p_ajustes) <> 'array' THEN
    RAISE EXCEPTION 'Os ajustes devem vir em uma lista.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_ajustes) > 8 THEN
    RAISE EXCEPTION 'Lance no máximo 8 ajustes por baixa.' USING ERRCODE = '22023';
  END IF;

  IF p_ajustes IS NOT NULL
     AND jsonb_typeof(p_ajustes) = 'array'
     AND jsonb_array_length(p_ajustes) > 0 THEN

    IF v_atual.adiantamento_id IS NOT NULL THEN
      RAISE EXCEPTION 'Titulo antecipado nao aceita acrescimo ou desconto na baixa: a composicao dele responde a antecipacao. Lance o ajuste no titulo antes.'
        USING ERRCODE = '22023';
    END IF;

    -- A base congela antes do laco. Percentual incide sobre valor_base, nunca
    -- sobre o acumulado: duas linhas de 10% somam 20% da base, que e a regra
    -- que recalcular_valores_transacao ja estabeleceu.
    v_base := round(coalesce(v_atual.valor_base, v_atual.valor, 0), 2);

    -- Acréscimos primeiro: a validade do total não depende da ordem da tela.
    FOR v_item IN
      SELECT item.value FROM jsonb_array_elements(p_ajustes) AS item
      LEFT JOIN public.tipos_ajuste_transacao tipo ON tipo.id::text = item.value->>'tipoId'
      ORDER BY CASE WHEN tipo.natureza = 'ACRESCIMO' THEN 0 ELSE 1 END
    LOOP
      v_tipo_id := (v_item->>'tipoId')::integer;
      v_modo := upper(coalesce(v_item->>'modo', 'FIXO'));
      v_informado := (v_item->>'valorInformado')::numeric;

      IF v_informado IS NULL OR v_informado::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_informado <= 0 OR (v_modo = 'PORCENTAGEM' AND v_informado > 100) THEN
        RAISE EXCEPTION 'Valor do ajuste inválido. Informe um valor positivo e percentual de até 100%%.'
          USING ERRCODE = '22023';
      END IF;

      /*
       * A natureza vem do catalogo, nunca do payload.
       *
       * Deixar o cliente informa-la criaria uma segunda verdade sobre o mesmo
       * fato — e tg_transacao_ajuste_coerente existe justamente para recusar
       * divergencia entre a linha e o tipo dela.
       */
      SELECT natureza INTO v_natureza
        FROM public.tipos_ajuste_transacao
       WHERE id = v_tipo_id AND ativo IS TRUE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Tipo de ajuste % inexistente ou inativo.', v_tipo_id
          USING ERRCODE = '22023';
      END IF;

      IF v_modo NOT IN ('FIXO', 'PORCENTAGEM') THEN
        RAISE EXCEPTION 'O modo do ajuste deve ser FIXO ou PORCENTAGEM.'
          USING ERRCODE = '22023';
      END IF;

      v_calculado := CASE
        WHEN v_modo = 'PORCENTAGEM' THEN round(v_base * v_informado / 100, 2)
        ELSE round(v_informado, 2)
      END;

      IF v_calculado <= 0 THEN
        RAISE EXCEPTION 'O ajuste calculado ficou em zero.' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.transacao_ajuste (
        transacao_id, tipo_id, natureza, modo,
        valor_informado, valor_calculado, observacao, created_by
      ) VALUES (
        p_transacao_id, v_tipo_id, v_natureza, v_modo,
        v_informado, v_calculado,
        left(nullif(btrim(coalesce(v_item->>'observacao', '')), ''), 500),
        p_baixado_por
      );
    END LOOP;

    /*
     * Reler e obrigatorio.
     *
     * transacao_ajuste_recalcular_trg ja regravou valor, valor_acrescimos,
     * valor_descontos e "valorLiquido" do titulo, e v_atual e uma foto de antes.
     * Sem isto, v_liquido e v_saldo logo abaixo seriam os de antes do juros — e
     * quitar o titulo inteiro viraria baixa PARCIAL por acidente, com o banco
     * saindo do titulo e uma filha nascendo sem ninguem ter pedido.
     */
    SELECT * INTO v_atual FROM public.transacao WHERE id = p_transacao_id;
    IF round(v_atual.valor - coalesce(v_atual.valor_descontos, 0) - coalesce(v_atual.valor_baixado, 0), 2) <= 0 THEN
      RAISE EXCEPTION 'Os descontos devem deixar um saldo maior que zero para realizar a baixa.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_antecipada := v_atual.adiantamento_id IS NOT NULL;
  v_liquido := round(coalesce(nullif(v_atual."valorLiquido", 0), v_atual.valor, 0), 2);
  v_saldo := round(v_liquido - coalesce(v_atual.valor_baixado, 0), 2);
  v_lancado := round(coalesce(p_valor_lancado, 0), 2);
  v_valor := p_valor;

  /*
   * Quem já foi pago em partes termina em partes.
   *
   * O título com filhas não pode voltar a carregar banco — seria o mesmo dinheiro
   * no título e nas baixas dele. Então quem chama sem dizer o valor (a tela
   * pagando o restante exato, a baixa em lote) está pedindo "termina de receber",
   * e é isso que a função entrega: o saldo, pelo caminho da filha.
   *
   * Antecipado fica de fora: lá a filha é repasse de caixa e não quitação, e o
   * `valor_baixado` dele não é saldo a pagar.
   */
  IF v_valor IS NULL
     AND NOT coalesce(v_antecipada, false)
     AND coalesce(v_atual.valor_baixado, 0) > 0 THEN
    v_valor := v_saldo;
  END IF;

  IF p_valor_lancado IS NOT NULL THEN
    IF NOT coalesce(v_antecipada, false) THEN
      RAISE EXCEPTION
        'Só título antecipado escolhe quanto da baixa entra no caixa: neste o banco já é sempre gravado.'
        USING ERRCODE = '22023';
    END IF;
    IF v_lancado < 0 THEN
      RAISE EXCEPTION 'O valor lançado não pode ser negativo.' USING ERRCODE = '22023';
    END IF;
    IF v_lancado > v_liquido THEN
      RAISE EXCEPTION
        'O valor lançado (%) passa do valor do título (%).', v_lancado, v_liquido
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_valor IS NOT NULL THEN
    IF round(v_valor, 2) <= 0 THEN
      RAISE EXCEPTION 'O valor da baixa deve ser maior que zero.' USING ERRCODE = '22023';
    END IF;
    IF round(v_valor, 2) > v_saldo THEN
      RAISE EXCEPTION
        'A baixa de % passa do saldo em aberto do título, que é de %.',
        round(v_valor, 2), v_saldo USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_antecipada, false) THEN
      RAISE EXCEPTION
        'Título antecipado ainda não aceita baixa parcial.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- --------------------------------------------------------------- parcial
  IF v_valor IS NOT NULL
     AND (round(v_valor, 2) < v_saldo OR coalesce(v_atual.valor_baixado, 0) > 0) THEN

    -- O banco que estava no título era a conta PREVISTA, escolhida no
    -- lançamento. A partir daqui o dinheiro mora nas baixas, e cada uma sabe por
    -- onde entrou de verdade.
    IF v_atual.banco_id IS NOT NULL THEN
      UPDATE public.transacao SET banco_id = NULL, updated_at = now()
       WHERE id = p_transacao_id;
    END IF;

    v_filha_id := public.registrar_baixa_filha(
      v_atual, round(v_valor, 2), p_pago_em, p_banco_id, v_metodo,
      p_plano_de_conta_id, p_centro_custo_id, p_baixado_por, false
    );

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
    ) VALUES (
      v_atual.id, coalesce(v_atual.vencimento_em, v_atual.data), p_pago_em,
      p_baixado_por, p_banco_id, v_metodo
    );

    SELECT * INTO v_transacao FROM public.transacao WHERE id = p_transacao_id;

    IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        NULL; /* integração de OS removida */
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_transacao.id,
      'baixa_id', v_filha_id,
      'valor_baixado', v_transacao.valor_baixado,
      'saldo', round(v_liquido - v_transacao.valor_baixado, 2),
      'pendente', v_transacao.pendente,
      'parcial', true
    );
  END IF;

  -- ------------------------------------------------------------- de uma vez
  UPDATE public.transacao
  SET vencimento_em = coalesce(vencimento_em, data),
      data = p_pago_em,
      pago_em = p_pago_em,
      baixado_por = p_baixado_por,
      banco_id = CASE WHEN coalesce(v_antecipada, false) THEN NULL ELSE p_banco_id END,
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
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  IF coalesce(v_antecipada, false) AND v_lancado > 0 THEN
    v_filha_id := public.registrar_baixa_filha(
      v_atual, v_lancado, p_pago_em, p_banco_id, v_metodo,
      p_plano_de_conta_id, p_centro_custo_id, p_baixado_por, true
    );
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    v_transacao.baixado_por,
    CASE WHEN v_filha_id IS NOT NULL THEN p_banco_id ELSE v_transacao.banco_id END,
    v_transacao.metodopagamento
  );

  IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
    IF v_transacao.ordemservicoid IS NOT NULL THEN
      NULL; /* integração de OS removida */
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
    'parcial', false,
    'baixa_id', v_filha_id,
    'valor_lancado', coalesce(v_lancado, 0)
  );
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.buscar_ultimo_valor_venda_produto(p_produto_id integer)
 RETURNS TABLE(valor_unitario numeric, origem text, realizado_em timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    candidato.valor_unitario,
    candidato.origem,
    candidato.realizado_em
  FROM (
    SELECT
      round(vp.valor_total / nullif(vp.quantidade, 0), 4) AS valor_unitario,
      'VENDA'::text AS origem,
      coalesce(v.datavenda, v.updatedat, v.createdat) AS realizado_em,
      v.id AS documento_id
    FROM public.vendaproduto vp
    JOIN public.venda v ON v.id = vp.venda_id
    WHERE vp.produtoid = p_produto_id
      AND v.status = 'FINALIZADA'
      AND vp.quantidade > 0
  ) candidato
  WHERE candidato.valor_unitario IS NOT NULL
  ORDER BY candidato.realizado_em DESC NULLS LAST, candidato.documento_id DESC
  LIMIT 1;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.desfazer_adiantamento(p_id bigint, p_deleted_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- O repasse mora numa transação própria. Reabrir o título em bloco a deixaria
  -- órfã no extrato, com dinheiro sem origem.
  SELECT array_agg(DISTINCT t.id) INTO v_com_lancamento
    FROM public.transacao t
    JOIN public.transacao f ON f.baixa_de_transacao_id = t.id AND f.is_deleted = false
   WHERE t.adiantamento_id = p_id AND t.is_deleted = false;

  IF v_com_lancamento IS NOT NULL THEN
    RAISE EXCEPTION
      'O título #% teve dinheiro lançado na conta pela baixa dele. Estorne essa baixa antes de desfazer a antecipação.',
      v_com_lancamento[1] USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
           'tipo', CASE WHEN t.ordemservicoid IS NOT NULL THEN 'OS' ELSE 'VENDA' END,
           'id', coalesce(t.ordemservicoid, t.vendaid))), '[]'::jsonb)
    INTO v_documentos
    FROM public.transacao t
   WHERE t.id = ANY (coalesce(v_titulos, ARRAY[]::bigint[]))
     AND coalesce(t.ordemservicoid, t.vendaid) IS NOT NULL;

  IF v_titulos IS NOT NULL THEN
    UPDATE public.transacao
       SET pendente = true,
           pago_em = NULL,
           baixado_por = NULL,
           adiantamento_id = NULL,
           updated_at = now()
     WHERE id = ANY (v_titulos);
  END IF;

  UPDATE public.transacao
     SET is_deleted = true,
         deleted_at = now(),
         deleted_by = p_deleted_by,
         updated_at = now()
   WHERE id = p_id;

  FOR v_titulo IN
    SELECT DISTINCT t.ordemservicoid, t.vendaid
      FROM public.transacao t
     WHERE t.id = ANY (coalesce(v_titulos, ARRAY[]::bigint[]))
  LOOP
    IF v_titulo.ordemservicoid IS NOT NULL THEN
      NULL; /* integração de OS removida */
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
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.dre_pendencias(p_de timestamp with time zone, p_ate timestamp with time zone)
 RETURNS TABLE(motivo text, descricao text, escopo text, quantidade bigint, valor numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template integer;
  v_modo record;
BEGIN
  SELECT * INTO v_modo FROM public.dre_modo_apuracao();
  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1;

  RETURN QUERY
  -- Cadastro: nao depende do periodo. Um grupo sem destino e um problema hoje,
  -- mesmo que ninguem tenha lancado nele ainda.
  SELECT 'GRUPO_SEM_DESTINO'::text,
         'Grupo ativo sem linha da DRE: as contas dele sem excecao nao tem para onde ir.'::text,
         'CADASTRO'::text,
         count(*)::bigint,
         NULL::numeric
    FROM public.planosdecontagrupos g
   WHERE g.ativo
     AND (SELECT d.situacao FROM public.dre_destino_do_cadastro(NULL, g.id, current_date) d) = 'PENDENTE'
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'CONTA_SEM_REGRA'::text,
         'Conta ativa sem linha da DRE: nem a conta nem o grupo definem destino.'::text,
         'CADASTRO'::text,
         count(*)::bigint,
         NULL::numeric
    FROM public.planosdeconta c
    JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
   WHERE c.ativo AND g.ativo
     AND (SELECT d.situacao FROM public.dre_destino_do_cadastro(c.id, g.id, current_date) d) = 'PENDENTE'
  HAVING count(*) > 0;

  RETURN QUERY
  -- Periodo: o que existe e nao entra em total nenhum.
  SELECT 'EVENTO_SEM_LINHA'::text,
         'Lancamento no periodo que nao entra em nenhuma linha da DRE.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em BETWEEN p_de AND p_ate
     AND public.dre_linha_do_evento(e.id, v_template, v_modo.estado, v_modo.vigencia_inicio) IS NULL
  HAVING count(*) > 0;

  RETURN QUERY
  -- Item vendido sem custo. Ja existia como contagem avulsa na rota da DRE, e
  -- por isso era o unico aviso sem lista: a tela dizia "6 itens" e nao sabia
  -- dizer quais. Como motivo da fila, ganha o mesmo drill-down dos outros e
  -- deixa de ser um caminho a parte.
  SELECT 'ITEM_SEM_CUSTO'::text,
         'Item vendido sem custo cadastrado: a margem esta superestimada.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.natureza_dre = 'CUSTO'
     AND e.dados_snapshot @> '{"custo_nao_informado": true}'::jsonb
     AND e.competencia_em BETWEEN p_de AND p_ate
  HAVING count(*) > 0;


  RETURN QUERY
  -- Sem fonte nao ha de onde herdar competencia: nenhuma acao no documento
  -- original conserta, porque nao ha documento original.
  SELECT 'EVENTO_SEM_FONTE'::text,
         'Lancamento sem fonte e sem competencia: nao ha de onde herdar o periodo.'::text,
         'GERAL'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em IS NULL
     AND e.source_id IS NULL
     AND e.ordemservicoid IS NULL
  HAVING count(*) > 0;

  RETURN QUERY
  -- O que sobra: tem fonte, a fonte ja encerrou (ou nao e OS) e mesmo assim o
  -- lancamento ficou sem periodo. Anomalia de verdade.
  SELECT 'EVENTO_SEM_COMPETENCIA'::text,
         'Lancamento sem competencia: nao pertence a nenhum periodo.'::text,
         'GERAL'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em IS NULL
     AND (e.source_id IS NOT NULL OR e.ordemservicoid IS NOT NULL)
  HAVING count(*) > 0;

  RETURN QUERY
  -- Natureza incompativel produz uma DRE que parece valida: uma despesa somando
  -- em receita de servicos nao viola nada, so mente.
  SELECT 'NATUREZA_INCOMPATIVEL'::text,
         'Lancamento numa linha de natureza contraria a dele.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(e.valor), 0), 2)
    FROM public.eventos_financeiros e
    JOIN public.dre_linha l
      ON l.id = public.dre_linha_do_evento(e.id, v_template, v_modo.estado, v_modo.vigencia_inicio)
   WHERE e.status IN ('ATIVO', 'CONVERTIDO')
     AND e.competencia_em BETWEEN p_de AND p_ate
     AND l.natureza_dre IS NOT NULL
     AND ((l.natureza_dre = 'RECEITA' AND e.natureza <> 'RECEITA')
       OR (l.natureza_dre IN ('CUSTO', 'DESPESA') AND e.natureza <> 'DESPESA'))
  HAVING count(*) > 0;

  RETURN QUERY
  -- Ausencia de evento nao dispensa controle: a transacao existe, e nada dela
  -- chega ao resultado. So conta quando a transacao DEVERIA ter gerado evento —
  -- acusar o que o sistema decidiu manter fora do resultado ensina a ignorar a
  -- fila.
  SELECT 'TRANSACAO_SEM_EVENTO'::text,
         'Transacao de resultado no periodo que nao gerou lancamento na DRE.'::text,
         'PERIODO'::text,
         count(*)::bigint,
         round(coalesce(sum(t.valor), 0), 2)
    FROM public.transacao t
   WHERE t.competencia_em BETWEEN p_de AND p_ate
     AND upper(t.tipo::text) IN ('RECEITA', 'DESPESA')
     AND public.transacao_gera_evento_de_resultado(t.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.eventos_financeiros e
        WHERE e.source_type = 'TRANSACAO' AND e.source_id = t.id
          AND e.status IN ('ATIVO', 'CONVERTIDO'))
  HAVING count(*) > 0;

  RETURN QUERY
  -- Exclusao que ninguem revisou: o mapeamento inicial foi sugerido por palavra
  -- no nome do grupo, e nem a conta nem o grupo ganharam classificacao desde
  -- entao. Classificar qualquer um dos dois ja e a revisao.
  SELECT 'EXCLUSAO_NAO_REVISADA'::text,
         'Valor fora da DRE por sugestao automatica de migracao, ainda sem revisao.'::text,
         'PERIODO'::text,
         count(t.id)::bigint,
         round(coalesce(sum(t.valor), 0), 2)
    FROM public.dre_mapeamento m
    JOIN public.planosdecontagrupos g ON g.id = m.origem_id
    JOIN public.planosdeconta c ON c.grupo_id = g.id
    JOIN public.transacao t
      ON t.plano_de_conta_id = c.id
     AND t.competencia_em BETWEEN p_de AND p_ate
   WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO' AND m.exclui_do_resultado
     AND m.observacao ILIKE '%sugestao automatica%'
     AND g.classificacao_padrao_id IS NULL
     AND c.classificacao_especifica_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.plano_contas_classificacao_regra r
                      WHERE r.grupo_id = g.id OR r.conta_id = c.id)
  HAVING count(t.id) > 0;
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.dre_pendencias_itens(p_motivo text, p_de timestamp with time zone, p_ate timestamp with time zone, p_limite integer DEFAULT 100, p_deslocamento integer DEFAULT 0)
 RETURNS TABLE(referencia_tipo text, referencia_id bigint, descricao text, grupo_nome text, conta_nome text, competencia date, valor numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template integer;
  v_modo record;
  v_limite integer := least(greatest(coalesce(p_limite, 100), 1), 500);
BEGIN
  SELECT * INTO v_modo FROM public.dre_modo_apuracao();
  SELECT id INTO v_template FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1;

  IF p_motivo = 'GRUPO_SEM_DESTINO' THEN
    RETURN QUERY
    SELECT 'GRUPO'::text, g.id::bigint, g.nome, g.nome, NULL::text, NULL::date, NULL::numeric
      FROM public.planosdecontagrupos g
     WHERE g.ativo
       AND (SELECT d.situacao FROM public.dre_destino_do_cadastro(NULL, g.id, current_date) d) = 'PENDENTE'
     ORDER BY g.codigo
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo = 'CONTA_SEM_REGRA' THEN
    RETURN QUERY
    SELECT 'CONTA'::text, c.id::bigint, c.nome, g.nome, c.nome, NULL::date,
           (SELECT round(coalesce(sum(t.valor), 0), 2) FROM public.transacao t
             WHERE t.plano_de_conta_id = c.id
               AND t.competencia_em BETWEEN p_de AND p_ate)
      FROM public.planosdeconta c
      JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
     WHERE c.ativo AND g.ativo
       AND (SELECT d.situacao FROM public.dre_destino_do_cadastro(c.id, g.id, current_date) d) = 'PENDENTE'
     ORDER BY g.codigo, c.codigo
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo IN ('EVENTO_SEM_LINHA', 'NATUREZA_INCOMPATIVEL', 'EVENTO_SEM_COMPETENCIA',
                     'EVENTO_OS_EM_ABERTO', 'EVENTO_SEM_FONTE', 'ITEM_SEM_CUSTO') THEN
    RETURN QUERY
    SELECT 'EVENTO'::text, e.id::bigint, e.descricao, g.nome, c.nome,
           e.competencia_em::date, round(e.valor, 2)
      FROM public.eventos_financeiros e
      LEFT JOIN public.transacao t ON t.id = e.source_id AND e.source_type = 'TRANSACAO'
      LEFT JOIN public.planosdeconta c ON c.id = t.plano_de_conta_id
      LEFT JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
      LEFT JOIN public.dre_linha l
        ON l.id = public.dre_linha_do_evento(e.id, v_template, v_modo.estado, v_modo.vigencia_inicio)
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND CASE p_motivo
             WHEN 'EVENTO_OS_EM_ABERTO' THEN false
             WHEN 'EVENTO_SEM_FONTE' THEN
               e.competencia_em IS NULL AND e.source_id IS NULL AND e.ordemservicoid IS NULL
             WHEN 'EVENTO_SEM_COMPETENCIA' THEN
               e.competencia_em IS NULL
               AND (e.source_id IS NOT NULL OR e.ordemservicoid IS NOT NULL)
             WHEN 'ITEM_SEM_CUSTO' THEN
               e.natureza_dre = 'CUSTO'
               AND e.dados_snapshot @> '{"custo_nao_informado": true}'::jsonb
               AND e.competencia_em BETWEEN p_de AND p_ate
             WHEN 'EVENTO_SEM_LINHA' THEN
               e.competencia_em BETWEEN p_de AND p_ate AND l.id IS NULL
             ELSE
               e.competencia_em BETWEEN p_de AND p_ate
               AND l.natureza_dre IS NOT NULL
               AND ((l.natureza_dre = 'RECEITA' AND e.natureza <> 'RECEITA')
                 OR (l.natureza_dre IN ('CUSTO', 'DESPESA') AND e.natureza <> 'DESPESA'))
           END
     ORDER BY e.valor DESC NULLS LAST
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo = 'TRANSACAO_SEM_EVENTO' THEN
    RETURN QUERY
    SELECT 'TRANSACAO'::text, t.id::bigint, t.descricao, g.nome, c.nome,
           t.competencia_em::date, round(t.valor, 2)
      FROM public.transacao t
      LEFT JOIN public.planosdeconta c ON c.id = t.plano_de_conta_id
      LEFT JOIN public.planosdecontagrupos g ON g.id = c.grupo_id
     WHERE t.competencia_em BETWEEN p_de AND p_ate
       AND upper(t.tipo::text) IN ('RECEITA', 'DESPESA')
       AND public.transacao_gera_evento_de_resultado(t.id)
       AND NOT EXISTS (SELECT 1 FROM public.eventos_financeiros e
                        WHERE e.source_type = 'TRANSACAO' AND e.source_id = t.id
                          AND e.status IN ('ATIVO', 'CONVERTIDO'))
     ORDER BY t.valor DESC NULLS LAST
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSIF p_motivo = 'EXCLUSAO_NAO_REVISADA' THEN
    RETURN QUERY
    SELECT 'TRANSACAO'::text, t.id::bigint, t.descricao, g.nome, c.nome,
           t.competencia_em::date, round(t.valor, 2)
      FROM public.dre_mapeamento m
      JOIN public.planosdecontagrupos g ON g.id = m.origem_id
      JOIN public.planosdeconta c ON c.grupo_id = g.id
      JOIN public.transacao t ON t.plano_de_conta_id = c.id
       AND t.competencia_em BETWEEN p_de AND p_ate
     WHERE m.ativo AND m.origem_tipo = 'PLANO_GRUPO' AND m.exclui_do_resultado
       AND m.observacao ILIKE '%sugestao automatica%'
       AND g.classificacao_padrao_id IS NULL
       AND c.classificacao_especifica_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.plano_contas_classificacao_regra r
                        WHERE r.grupo_id = g.id OR r.conta_id = c.id)
     ORDER BY t.valor DESC NULLS LAST
     LIMIT v_limite OFFSET coalesce(p_deslocamento, 0);

  ELSE
    RAISE EXCEPTION 'Motivo de pendencia desconhecido: %.', p_motivo USING ERRCODE = '22023';
  END IF;
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.estornar_baixa_transacao(p_transacao_id bigint, p_estornado_por uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_acrescimos_removidos numeric(14,2) := 0;
  v_valor_reaberto numeric(14,2);
  v_baixa_do_titulo boolean := false;
  v_titulo bigint;
  v_movimento public.cliente_saldo_movimento%ROWTYPE;
  v_sentido_estorno text;
  v_saldo_anterior numeric(14,2);
  v_saldo_resultante numeric(14,2);
BEGIN
  SELECT * INTO v_transacao
    FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_transacao.baixa_de_transacao_id IS NOT NULL THEN
    v_titulo := v_transacao.baixa_de_transacao_id;

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_titulo, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, v_transacao.banco_id, v_transacao.metodopagamento, 'ESTORNO'
    );

    DELETE FROM public.transacao WHERE id = p_transacao_id;

    SELECT * INTO v_transacao FROM public.transacao WHERE id = v_titulo;

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        NULL; /* integração de OS removida */
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_titulo,
      'baixa_estornada', p_transacao_id,
      'valor_baixado', v_transacao.valor_baixado,
      'pendente', v_transacao.pendente,
      'parcial', true
    );
  END IF;

  IF coalesce(v_transacao.pendente, false) THEN
    RAISE EXCEPTION 'Esta transação não está liquidada: não há baixa a estornar.'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_transacao.abonado, false) THEN
    UPDATE public.transacao
       SET pendente = true,
           data = coalesce(vencimento_em, data),
           pago_em = NULL,
           abonado = false,
           abonado_por = NULL,
           abonado_em = NULL,
           abono_motivo = NULL,
           updated_at = now()
     WHERE id = p_transacao_id;

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_transacao.id, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, NULL, NULL, 'ESTORNO'
    );

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        NULL; /* integração de OS removida */
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_transacao.id,
      'pendente', true,
      'abono_desfeito', true
    );
  END IF;

  -- ------------------------------------------------- baixa por crédito
  --
  -- A última linha do razão daquela transação diz se ainda há o que desfazer:
  -- REGISTRO é baixa em pé, ESTORNO é ciclo já fechado.
  SELECT * INTO v_movimento
    FROM public.cliente_saldo_movimento m
   WHERE m.transacao_id = p_transacao_id
     AND m.origem = 'TRANSACAO'
   ORDER BY m.id DESC
   LIMIT 1;

  IF FOUND AND v_movimento.acao = 'REGISTRO' THEN
    v_sentido_estorno := CASE WHEN v_movimento.sentido = 'DEBITO' THEN 'CREDITO' ELSE 'DEBITO' END;

    SELECT c.saldo_credito INTO v_saldo_anterior
      FROM public.cliente c
     WHERE c.id = v_movimento.cliente_id
       FOR UPDATE;

    v_saldo_anterior := coalesce(v_saldo_anterior, 0);
    v_saldo_resultante := CASE
      WHEN v_sentido_estorno = 'CREDITO' THEN v_saldo_anterior + v_movimento.valor
      ELSE v_saldo_anterior - v_movimento.valor
    END;

    -- Só acontece no título a pagar: o crédito que ele gerou já foi gasto em
    -- outra cobrança, e tirá-lo agora deixaria a carteira negativa.
    IF v_saldo_resultante < 0 THEN
      RAISE EXCEPTION
        'O crédito gerado por esta baixa já foi usado: o cliente tem R$ % e o estorno retiraria R$ %.',
        to_char(v_saldo_anterior, 'FM999999990.00'),
        to_char(v_movimento.valor, 'FM999999990.00')
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.transacao
       SET pendente = true,
           data = coalesce(vencimento_em, data),
           pago_em = NULL,
           baixado_por = NULL,
           updated_at = now()
     WHERE id = p_transacao_id;

    INSERT INTO public.cliente_saldo_movimento (
      cliente_id, sentido, origem, acao, valor,
      saldo_anterior, saldo_resultante, transacao_id, motivo, created_by
    ) VALUES (
      v_movimento.cliente_id, v_sentido_estorno, 'TRANSACAO', 'ESTORNO', v_movimento.valor,
      v_saldo_anterior, round(v_saldo_resultante, 2), p_transacao_id,
      'Estorno da baixa do título #' || p_transacao_id, p_estornado_por
    );

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_transacao.id, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, NULL, v_transacao.metodopagamento, 'ESTORNO'
    );

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        NULL; /* integração de OS removida */
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_transacao.id,
      'pendente', true,
      'credito_devolvido', v_movimento.valor,
      'saldo', round(v_saldo_resultante, 2)
    );
  END IF;

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

  /*
   * Título comum pago em partes: cada pagamento tem data, banco e valor próprios
   * e sai do extrato sozinho, então o estorno é de cada um.
   *
   * O antecipado é o contrário: a baixa foi UMA — ela quitou o título e criou o
   * repasse no mesmo ato —, e desfazê-la desfaz as duas coisas.
   */
  IF v_transacao.adiantamento_id IS NULL AND EXISTS (
    SELECT 1 FROM public.transacao f
     WHERE f.baixa_de_transacao_id = p_transacao_id AND f.is_deleted = false
  ) THEN
    RAISE EXCEPTION
      'Este título foi pago em partes. Estorne os pagamentos dele, um a um.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.adiantamento_id IS NOT NULL THEN
    DELETE FROM public.transacao WHERE baixa_de_transacao_id = p_transacao_id;
  END IF;

  UPDATE public.transacao
     SET pendente = true,
         data = coalesce(vencimento_em, data),
         pago_em = NULL,
         baixado_por = NULL,
         banco_id = CASE WHEN v_transacao.adiantamento_id IS NOT NULL THEN NULL ELSE banco_id END,
         updated_at = now()
   WHERE id = p_transacao_id;

  WITH removidos AS (
    DELETE FROM public.transacao_ajuste
     WHERE transacao_id = p_transacao_id
       AND natureza = 'ACRESCIMO'
    RETURNING valor_calculado
  )
  SELECT coalesce(sum(valor_calculado), 0) INTO v_acrescimos_removidos FROM removidos;

  v_valor_reaberto := round(coalesce(v_transacao.valor_base, v_transacao.valor), 2);

  UPDATE public.transacao
     SET valor = v_valor_reaberto,
         valor_acrescimos = 0,
         "valorLiquido" = round(v_valor_reaberto - coalesce(valor_descontos, 0), 2),
         updated_at = now()
   WHERE id = p_transacao_id;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id,
    coalesce(v_transacao.vencimento_em, v_transacao.data),
    coalesce(v_transacao.pago_em, v_transacao.data),
    p_estornado_por,
    v_transacao.banco_id,
    v_transacao.metodopagamento,
    'ESTORNO'
  );

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', true,
    'valor', v_valor_reaberto,
    'acrescimos_removidos', v_acrescimos_removidos,
    'vencimento_em', coalesce(v_transacao.vencimento_em, v_transacao.data)
  );
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.excluir_lancamento_de_eventos(p_id bigint, p_deleted_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo public.lancamento_de_eventos%ROWTYPE;
  v_os_finalizadas text;
  v_os_ids integer[] := ARRAY[]::integer[];
  v_baixadas integer;
  v_parcelas integer;
  v_despesas integer;
BEGIN
  SELECT * INTO v_grupo FROM public.lancamento_de_eventos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lancamento #% nao encontrado.', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Guarda 1: dinheiro que ja saiu. A exclusao apaga o titulo, nao a baixa: o
  -- saldo do banco subiria sozinho, sem que nada tenha acontecido no mundo.
  -- Mesma razao da trava individual do DELETE de transacao, mas valendo para o
  -- grupo — com uma parcela paga, nem as pendentes saem.
  SELECT count(*) INTO v_baixadas
    FROM public.transacao t
   WHERE t.lancamento_id = p_id AND t.is_deleted = false AND t.pendente = false;

  IF v_baixadas > 0 THEN
    RAISE EXCEPTION
      'Este lancamento tem % parcela(s) ja paga(s). Tire a baixa do fluxo de caixa antes de excluir.',
      v_baixadas USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_parcelas
    FROM public.transacao t WHERE t.lancamento_id = p_id;

  -- As despesas voltam a prevista ANTES de o grupo sumir. A FK e ON DELETE SET
  -- NULL, entao o vinculo cairia sozinho — mas o status nao, e uma despesa
  -- CONVERTIDO sem vinculo nenhum seria uma despesa presa para sempre.
  UPDATE public.eventos_financeiros
     SET status = 'ATIVO', lancamento_id = NULL, updated_at = now()
   WHERE lancamento_id = p_id;

  GET DIAGNOSTICS v_despesas = ROW_COUNT;

  -- As parcelas caem por CASCADE.
  DELETE FROM public.lancamento_de_eventos WHERE id = p_id;

  RETURN jsonb_build_object(
    'id', p_id,
    'ordemservicoid', v_grupo.ordemservicoid,
    'ordemservicoids', to_jsonb(coalesce(v_os_ids, ARRAY[]::integer[])),
    'parcelas_removidas', v_parcelas,
    'despesas_revertidas', v_despesas
  );
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.excluir_pagamento_multiplo(p_id bigint, p_deleted_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo public.pagamento_multiplo%ROWTYPE;
  v_baixadas integer;
  v_documentos jsonb;
  v_doc record;
  v_removidas integer;
BEGIN
  SELECT * INTO v_grupo FROM public.pagamento_multiplo WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento múltiplo #% não encontrado.', p_id USING ERRCODE = 'P0002';
  END IF;

  IF v_grupo.modo = 'PARCELADO' THEN
    SELECT count(*) INTO v_baixadas
      FROM public.transacao t
     WHERE t.pagamento_multiplo_id = p_id
       AND t.is_deleted = false
       AND t.pendente = false;

    IF v_baixadas > 0 THEN
      RAISE EXCEPTION
        'Este pagamento tem % parcela(s) já baixada(s). Estorne essas baixas antes de excluir o pagamento.',
        v_baixadas USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Os documentos agora vivem no rateio, e não no `ordemservicoid` das linhas.
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('tipo', tipo_documento, 'id', documento_id)), '[]'::jsonb)
    INTO v_documentos
    FROM public.pagamento_multiplo_rateio
   WHERE pagamento_multiplo_id = p_id;

  UPDATE public.transacao
     SET is_deleted = true,
         deleted_at = now(),
         deleted_by = p_deleted_by,
         updated_at = now()
   WHERE pagamento_multiplo_id = p_id
     AND is_deleted = false;

  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  FOR v_doc IN
    SELECT DISTINCT tipo_documento, documento_id
      FROM public.pagamento_multiplo_rateio
     WHERE pagamento_multiplo_id = p_id
  LOOP
    IF v_doc.tipo_documento = 'OS' THEN
      NULL; /* integração de OS removida */
    ELSE
      PERFORM public.recalcular_status_financeiro_venda(v_doc.documento_id);
    END IF;
  END LOOP;

  -- O grupo NÃO é apagado. A versão anterior tentava, e não podia: as transações
  -- são excluídas por `is_deleted` e continuam referenciando o grupo, cuja FK é
  -- ON DELETE RESTRICT — ou seja, excluir um pagamento múltiplo sempre falhou com
  -- erro de chave estrangeira. Manter a linha também preserva o histórico de que
  -- aquele recebimento existiu e foi desfeito; o rateio segue junto, e some das
  -- contas porque `recebimento_por_documento` só olha transação não excluída.

  RETURN jsonb_build_object(
    'id', p_id,
    'transacoes_removidas', v_removidas,
    'documentos', v_documentos
  );
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.nfe_origem_vinculo_validar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_modelo text;
  v_status text;
  v_excluida boolean;
  v_nfe_cliente integer;
  v_nfe_os integer;
  v_nfe_venda integer;
  v_origem_cliente integer;
  v_origem_existe boolean;
  v_ancora_esperada boolean;
BEGIN
  SELECT modelo::text, status::text, coalesce(is_deleted, false), clienteid, ordemservicoid, vendaid
    INTO v_modelo, v_status, v_excluida, v_nfe_cliente, v_nfe_os, v_nfe_venda
    FROM public.nfe
   WHERE id = NEW.nfe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O vinculo de origem exige uma NF-e existente.' USING ERRCODE = '23514';
  END IF;

  IF NEW.modelo <> v_modelo THEN
    RAISE EXCEPTION 'O modelo do vinculo difere do modelo da NF-e.' USING ERRCODE = '23514';
  END IF;

  -- Só modelo 55. A NFC-e admite um destinatário diferente do cliente da venda
  -- (o consumidor que se identifica no caixa), então a validação de cliente
  -- abaixo recusaria emissões legítimas.
  IF v_modelo <> 'NFE' THEN
    RAISE EXCEPTION 'Somente NF-e modelo 55 usa vinculo de origem.' USING ERRCODE = '23514';
  END IF;

  IF NEW.tipo <> 'VENDA' THEN
    RAISE EXCEPTION 'Somente vendas podem ser vinculadas à NF-e.' USING ERRCODE='23514';
  END IF;
    SELECT clienteid INTO v_origem_cliente
      FROM public.venda WHERE id = NEW.venda_id;
    v_origem_existe := FOUND;
    v_ancora_esperada := v_nfe_venda IS NOT DISTINCT FROM NEW.venda_id;


  IF NOT v_origem_existe THEN
    RAISE EXCEPTION 'A origem informada no vinculo nao existe.' USING ERRCODE = '23514';
  END IF;

  -- A invariante do destinatário único, no banco: uma NF-e só documenta
  -- origens do mesmo cliente que consta na própria nota.
  IF NEW.cliente_id <> v_nfe_cliente THEN
    RAISE EXCEPTION 'O vinculo aponta para um cliente diferente do destinatario da NF-e.'
      USING ERRCODE = '23514';
  END IF;

  IF v_origem_cliente IS DISTINCT FROM v_nfe_cliente THEN
    RAISE EXCEPTION
      'A origem % pertence ao cliente % e a NF-e foi emitida para o cliente %. Uma NF-e tem um unico destinatario.',
      NEW.origem_id, v_origem_cliente, v_nfe_cliente
      USING ERRCODE = '23514';
  END IF;

  -- `ancora` não é escolha de quem grava: é um fato derivado de qual origem
  -- está na coluna escalar da nota.
  NEW.ancora := v_ancora_esperada;
  NEW.ativo := public.nfe_status_ocupa_origem(v_status, v_excluida);
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.recalcular_documentos_da_transacao(p_transacao_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT tipo_documento, documento_id
      FROM public.pagamento_multiplo_rateio
     WHERE transacao_id = p_transacao_id
  LOOP
    IF r.tipo_documento = 'OS' THEN
      NULL; /* integração de OS removida */
    ELSE
      PERFORM public.recalcular_status_financeiro_venda(r.documento_id);
    END IF;
  END LOOP;
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.registrar_pagamento_multiplo(p_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo_documento text := upper(coalesce(p_payload->>'tipo_documento', ''));
  v_modo text := upper(coalesce(p_payload->>'modo', ''));
  v_valor_total numeric(14,2) := round(coalesce((p_payload->>'valor_total')::numeric, 0), 2);
  v_liquido_total numeric(14,2) := round(coalesce((p_payload->>'valor_liquido')::numeric, 0), 2);
  v_data timestamptz := coalesce(nullif(p_payload->>'data', '')::timestamptz, now());
  v_banco_id bigint := nullif(p_payload->>'banco_id', '')::bigint;
  v_metodo public.metodo_pagamento := nullif(p_payload->>'metodopagamento', '')::public.metodo_pagamento;
  v_created_by uuid := nullif(p_payload->>'created_by', '')::uuid;
  v_categoria text := coalesce(nullif(p_payload->>'categoria', ''), 'NÃO RELACIONADO');
  v_categoria_id integer := nullif(p_payload->>'categoria_id', '')::integer;
  v_plano_id integer := nullif(p_payload->>'plano_de_conta_id', '')::integer;
  v_centro_id integer := nullif(p_payload->>'centro_custo_id', '')::integer;
  v_pendente boolean := (v_modo = 'PARCELADO');
  v_grupo_id bigint;
  v_soma numeric(14,2);
  v_doc_id integer;
  v_documentos integer[] := ARRAY[]::integer[];
  v_cliente_id integer := nullif(p_payload->>'cliente_id', '')::integer;
  v_nome text := nullif(btrim(p_payload->>'nomepagador'), '');
  v_cpfcnpj text := nullif(btrim(p_payload->>'cpfcnpjpagador'), '');
  v_clientes integer[];
  v_descricao_grupo text;
  v_descricao text;
  v_parcela record;
  v_transacao_id bigint;
  v_total_parcelas integer;
  v_comprometido numeric(14,2);
  v_devido numeric(14,2);
  v_liquido numeric(14,2);
  v_liquido_acumulado numeric(14,2) := 0;
  v_indice integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  IF v_tipo_documento <> 'VENDA' THEN
    RAISE EXCEPTION 'tipo_documento deve ser VENDA.' USING ERRCODE = 'P0001';
  END IF;
  IF v_modo NOT IN ('AVISTA', 'PARCELADO') THEN
    RAISE EXCEPTION 'modo deve ser AVISTA ou PARCELADO.' USING ERRCODE = 'P0001';
  END IF;
  IF v_valor_total <= 0 THEN
    RAISE EXCEPTION 'O valor do pagamento deve ser maior que zero.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_payload->'linhas') <> 'array'
     OR jsonb_array_length(p_payload->'linhas') = 0 THEN
    RAISE EXCEPTION 'Informe as linhas do rateio.' USING ERRCODE = 'P0001';
  END IF;

  -- Sem líquido informado, líquido é o próprio valor: não houve taxa.
  IF v_liquido_total <= 0 THEN v_liquido_total := v_valor_total; END IF;

  SELECT round(coalesce(sum((item->>'valor')::numeric), 0), 2) INTO v_soma
    FROM jsonb_array_elements(p_payload->'linhas') AS item;

  IF v_soma <> v_valor_total THEN
    RAISE EXCEPTION 'A soma do rateio (%) difere do valor do pagamento (%).',
      v_soma, v_valor_total USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT (item->>'documento_id')::integer ORDER BY (item->>'documento_id')::integer)
    INTO v_documentos
    FROM jsonb_array_elements(p_payload->'linhas') AS item;

  FOREACH v_doc_id IN ARRAY v_documentos LOOP
    PERFORM pg_advisory_xact_lock(87001, v_doc_id);
    IF v_tipo_documento = 'OS' THEN NULL; /* integração de OS removida */ END IF;
  END LOOP;

  IF v_cliente_id IS NULL THEN
      SELECT array_agg(DISTINCT v.clienteid) INTO v_clientes
        FROM public.venda v WHERE v.id = ANY (v_documentos);


    IF array_length(v_clientes, 1) = 1 THEN
      v_cliente_id := v_clientes[1];
    END IF;
  END IF;

  IF v_cliente_id IS NOT NULL AND (v_nome IS NULL OR v_cpfcnpj IS NULL) THEN
    SELECT coalesce(v_nome, c.nomerazaosocial), coalesce(v_cpfcnpj, c.cpfcnpj)
      INTO v_nome, v_cpfcnpj
      FROM public.cliente c WHERE c.id = v_cliente_id;
  END IF;

  v_descricao_grupo := coalesce(
    nullif(btrim(p_payload->>'descricao'), ''),
    'Pagamento múltiplo de ' || array_length(v_documentos, 1) || ' documento(s)');

  INSERT INTO public.pagamento_multiplo (
    descricao, modo, tipo_documento, valor_total, data, banco_id, metodopagamento, created_by
  ) VALUES (
    v_descricao_grupo, v_modo, v_tipo_documento, v_valor_total, v_data,
    v_banco_id, v_metodo, v_created_by
  ) RETURNING id INTO v_grupo_id;

  SELECT max((item->>'total_parcelas')::integer) INTO v_total_parcelas
    FROM jsonb_array_elements(p_payload->'linhas') AS item;
  v_total_parcelas := greatest(coalesce(v_total_parcelas, 1), 1);

  FOR v_parcela IN
    SELECT (item->>'parcela')::integer AS numero,
           round(sum((item->>'valor')::numeric), 2) AS valor,
           min(nullif(item->>'vencimento_em', '')) AS vencimento
      FROM jsonb_array_elements(p_payload->'linhas') AS item
     GROUP BY (item->>'parcela')::integer
     ORDER BY 1
  LOOP
    v_indice := v_indice + 1;

    -- O líquido acompanha a proporção do valor. A última parcela leva a sobra
    -- para a soma dos líquidos fechar exatamente com o informado.
    IF v_indice = v_total_parcelas THEN
      v_liquido := round(v_liquido_total - v_liquido_acumulado, 2);
    ELSE
      v_liquido := round(v_parcela.valor * v_liquido_total / v_valor_total, 2);
      v_liquido_acumulado := v_liquido_acumulado + v_liquido;
    END IF;

    v_descricao := v_descricao_grupo;
    IF v_total_parcelas > 1 THEN
      v_descricao := v_descricao || ' - Parcela ' || v_parcela.numero || '/' || v_total_parcelas;
    END IF;

    INSERT INTO public.transacao (
      descricao, valor, "valorLiquido", data, metodopagamento, categoria, categoria_id,
      plano_de_conta_id, centro_custo_id, tipo, cliente_id, banco_id,
      nomepagador, cpfcnpjpagador, pendente, pago_em,
      ordemservicoid, vendaid, pagamento_multiplo_id, created_by
    ) VALUES (
      v_descricao,
      v_parcela.valor,
      greatest(v_liquido, 0),
      coalesce(v_parcela.vencimento::timestamptz, v_data),
      v_metodo, v_categoria, v_categoria_id, v_plano_id, v_centro_id,
      'RECEITA'::public.tipos_transacao, v_cliente_id,
      CASE WHEN v_pendente THEN NULL ELSE v_banco_id END,
      coalesce(v_nome, 'Diversos'),
      coalesce(v_cpfcnpj, 'NÃO INFORMADO'),
      v_pendente,
      CASE WHEN v_pendente THEN NULL ELSE v_data END,
      NULL, NULL,
      v_grupo_id, v_created_by
    ) RETURNING id INTO v_transacao_id;

    INSERT INTO public.pagamento_multiplo_rateio (
      pagamento_multiplo_id, transacao_id, tipo_documento, documento_id, valor
    )
    SELECT v_grupo_id, v_transacao_id, v_tipo_documento,
           (item->>'documento_id')::integer,
           round((item->>'valor')::numeric, 2)
      FROM jsonb_array_elements(p_payload->'linhas') AS item
     WHERE (item->>'parcela')::integer = v_parcela.numero
       AND round((item->>'valor')::numeric, 2) > 0;
  END LOOP;

  FOREACH v_doc_id IN ARRAY v_documentos LOOP
      SELECT round(
               greatest(coalesce(v.valortotal, 0), 0) +
               CASE
                 WHEN v.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
                   greatest(coalesce(v.valortotal, 0), 0) *
                   least(greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0), 100) / 100
                 WHEN v.acrescimo_financeiro_tipo = 'FIXO' THEN
                   greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0)
                 ELSE 0
               END, 2)
        INTO v_devido
        FROM public.venda v WHERE v.id = v_doc_id;

      SELECT coalesce(round(sum(r.valor), 2), 0) INTO v_comprometido
        FROM public.recebimento_por_documento r
       WHERE r.tipo_documento = 'VENDA' AND r.documento_id = v_doc_id;


    IF coalesce(v_devido, 0) <= 0 THEN
      RAISE EXCEPTION 'O documento #% não possui valor financeiro disponível para pagamento.',
        v_doc_id USING ERRCODE = '23514';
    END IF;
    IF round(coalesce(v_comprometido, 0), 2) > v_devido THEN
      RAISE EXCEPTION 'O rateio ultrapassa o saldo do documento #%: comprometido % de %.',
        v_doc_id, v_comprometido, v_devido USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN v_grupo_id;
END;
$function$
;

-- Rotina compartilhada: remove somente a integração com a oficina.
CREATE OR REPLACE FUNCTION public.tg_recalcular_documento_do_rateio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo text := CASE WHEN TG_OP = 'DELETE' THEN OLD.tipo_documento ELSE NEW.tipo_documento END;
  v_doc integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.documento_id ELSE NEW.documento_id END;
BEGIN
  IF v_tipo = 'OS' THEN
    NULL; /* integração de OS removida */
  ELSE
    PERFORM public.recalcular_status_financeiro_venda(v_doc);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$
;

-- Gatilhos exclusivos do legado, inclusive os instalados em tabelas compartilhadas.

do $$ begin if to_regclass('public.checklist_documento') is not null then
  drop trigger if exists "invalidar_convites_checklist_por_nova_versao" on public."checklist_documento";
end if; end $$;

do $$ begin if to_regclass('public.checklist_documento') is not null then
  drop trigger if exists "proteger_checklist_documento" on public."checklist_documento";
end if; end $$;

do $$ begin if to_regclass('public.checklist_documento_assinatura') is not null then
  drop trigger if exists "invalidar_convites_checklist_por_assinatura_presencial" on public."checklist_documento_assinatura";
end if; end $$;

do $$ begin if to_regclass('public.checklist_documento_assinatura') is not null then
  drop trigger if exists "validar_assinatura_ultima_versao_checklist" on public."checklist_documento_assinatura";
end if; end $$;

do $$ begin if to_regclass('public.checklist_documento_convite_assinatura') is not null then
  drop trigger if exists "proteger_credenciais_convite_checklist" on public."checklist_documento_convite_assinatura";
end if; end $$;

do $$ begin if to_regclass('public.checklist_documento_evento') is not null then
  drop trigger if exists "proteger_checklist_documento_evento" on public."checklist_documento_evento";
end if; end $$;

do $$ begin if to_regclass('public.checklist_modelo') is not null then
  drop trigger if exists "trg_checklist_modelo_updated" on public."checklist_modelo";
end if; end $$;

do $$ begin if to_regclass('public.config_geral') is not null then
  drop trigger if exists "aa_travar_fluxo_faturamento" on public."config_geral";
end if; end $$;

do $$ begin if to_regclass('public.config_geral') is not null then
  drop trigger if exists "devolver_os_ao_desativar_faturamento" on public."config_geral";
end if; end $$;

do $$ begin if to_regclass('public.config_geral') is not null then
  drop trigger if exists "zz_conciliar_stone_ao_desativar_fluxo" on public."config_geral";
end if; end $$;

do $$ begin if to_regclass('public.eventos_financeiros') is not null then
  drop trigger if exists "trg_carimbar_competencia_evento_novo" on public."eventos_financeiros";
end if; end $$;

do $$ begin if to_regclass('public.eventos_financeiros') is not null then
  drop trigger if exists "trg_espelhar_comissao_ajustada" on public."eventos_financeiros";
end if; end $$;

do $$ begin if to_regclass('public.eventos_financeiros') is not null then
  drop trigger if exists "trg_impedir_evento_financeiro_os_historica" on public."eventos_financeiros";
end if; end $$;

do $$ begin if to_regclass('public.nfse') is not null then
  drop trigger if exists "trg_nfse_os_servico_vinculo_sincronizar_status" on public."nfse";
end if; end $$;

do $$ begin if to_regclass('public.nfse_os_servico_vinculo') is not null then
  drop trigger if exists "trg_nfse_os_servico_vinculo_validar" on public."nfse_os_servico_vinculo";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "aa_travar_fluxo_faturamento" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "aa_validar_status_faturamento" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "ordemservico_status_estorno" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_ajustar_eventos_frete_os" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_carimbar_competencia_eventos_os" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_comissao_criacao_os_total" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_congelar_comissao_ao_encerrar_execucao" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_congelar_comissao_criacao" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_eventos_financeiros_os_delete" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_eventos_financeiros_os_exclusao_logica" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_excluir_transacoes_financeiras_os_por_status" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_gerar_eventos_financeiros_os" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_os_execucao_set_times" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_proteger_os_historica_migrada" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_recalc_comissao_os_total" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_reconciliar_eventos_ao_finalizar_os" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_registrar_evento_notificacao_os" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_registrar_finalizacao_os" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "trg_separar_conclusao_financeira_saida" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.ordemservico') is not null then
  drop trigger if exists "zz_conciliar_stone_ao_liberar_os" on public."ordemservico";
end if; end $$;

do $$ begin if to_regclass('public.os_notificacao_evento') is not null then
  drop trigger if exists "trg_disparar_processamento_notificacao_os" on public."os_notificacao_evento";
end if; end $$;

do $$ begin if to_regclass('public.ositem_historico') is not null then
  drop trigger if exists "trg_validar_ositem_historico" on public."ositem_historico";
end if; end $$;

do $$ begin if to_regclass('public.osproduto') is not null then
  drop trigger if exists "trg_comissao_criacao_osproduto" on public."osproduto";
end if; end $$;

do $$ begin if to_regclass('public.osproduto') is not null then
  drop trigger if exists "trg_osproduto_snapshot_ultimo_custo" on public."osproduto";
end if; end $$;

do $$ begin if to_regclass('public.osproduto_avulso') is not null then
  drop trigger if exists "trg_comissao_criacao_osproduto_avulso" on public."osproduto_avulso";
end if; end $$;

do $$ begin if to_regclass('public.osservico') is not null then
  drop trigger if exists "trg_comissao_criacao_osservico" on public."osservico";
end if; end $$;

do $$ begin if to_regclass('public.osservico') is not null then
  drop trigger if exists "trg_recalc_osservico_subtotal" on public."osservico";
end if; end $$;

do $$ begin if to_regclass('public.osservico_realizador') is not null then
  drop trigger if exists "trg_recalc_comissao_realizadores" on public."osservico_realizador";
end if; end $$;

do $$ begin if to_regclass('public.osservico_realizador') is not null then
  drop trigger if exists "trg_recalc_or_del" on public."osservico_realizador";
end if; end $$;

do $$ begin if to_regclass('public.osservico_realizador') is not null then
  drop trigger if exists "trg_recalc_or_ins" on public."osservico_realizador";
end if; end $$;

do $$ begin if to_regclass('public.pagamento') is not null then
  drop trigger if exists "trg_impedir_pagamento_os_historica" on public."pagamento";
end if; end $$;

do $$ begin if to_regclass('public.pagamento_multiplo_rateio') is not null then
  drop trigger if exists "aa_travar_fluxo_faturamento" on public."pagamento_multiplo_rateio";
end if; end $$;

do $$ begin if to_regclass('public.pagamento_multiplo_rateio') is not null then
  drop trigger if exists "validar_rateio_faturamento_os" on public."pagamento_multiplo_rateio";
end if; end $$;

do $$ begin if to_regclass('public.transacao') is not null then
  drop trigger if exists "aa_travar_fluxo_faturamento" on public."transacao";
end if; end $$;

do $$ begin if to_regclass('public.transacao') is not null then
  drop trigger if exists "trg_impedir_transacao_os_historica" on public."transacao";
end if; end $$;

do $$ begin if to_regclass('public.transacao') is not null then
  drop trigger if exists "trg_recalcular_status_financeiro_os" on public."transacao";
end if; end $$;

do $$ begin if to_regclass('public.transacao') is not null then
  drop trigger if exists "trg_validar_limite_pagamento_os" on public."transacao";
end if; end $$;

-- Sem CASCADE: qualquer dependência não inventariada interrompe a transação.

drop function if exists
  public.ajustar_eventos_frete_os(p_ordemservicoid integer),
  public.aluguel_baixar_item(p_item_id bigint, p_usuario uuid),
  public.aluguel_devolver_item(p_item_id bigint, p_motivo text, p_usuario uuid),
  public.aluguel_encerrar(p_id bigint, p_encerrado_em timestamp with time zone, p_observacao text, p_usuario uuid),
  public.aluguel_encerrar(p_id bigint, p_encerrado_em timestamp with time zone, p_observacao text, p_itens jsonb, p_usuario uuid),
  public.aluguel_excluir(p_id bigint, p_motivo text, p_usuario uuid),
  public.aluguel_hoje(),
  public.aluguel_pausar(p_id bigint, p_usuario uuid),
  public.aluguel_reiniciar(p_id bigint, p_usuario uuid),
  public.aluguel_reter_falta(p_item_id bigint, p_falta integer, p_usuario uuid),
  public.aluguel_salvar(p_payload jsonb, p_usuario uuid),
  public.aluguel_salvar_checklist(p_aluguel_id bigint, p_tipo text, p_payload jsonb, p_usuario uuid),
  public.assinar_checklist_remotamente(p_convite_public_id uuid, p_snapshot_hash text, p_signatario_nome text, p_signatario_documento text, p_signatario_qualidade text, p_qualidade_outro text, p_declaracao text, p_declaracao_hash text, p_assinatura_path text, p_assinatura_hash text, p_assinatura_vinculo_hash text, p_request_ip text, p_user_agent text),
  public.cancelar_consumo_produto_os(p_evento_id bigint, p_motivo text, p_usuario uuid),
  public.conciliar_financeiro_stone_os(p_pagamento_id bigint),
  public.conciliar_stone_ao_desativar_fluxo(),
  public.conciliar_stone_ao_liberar_os(),
  public.confirmar_pagamento_stone_os(p_pagamento_id bigint, p_status text, p_evento text, p_payload jsonb, p_registrar_receita boolean),
  public.consumir_estoque_os(p_os_id integer),
  public.consumir_estoque_os_interna(p_os_id integer),
  public.criar_convite_assinatura_checklist(p_documento_public_id uuid, p_convite_public_id uuid, p_cpf_hmac text, p_cpf_cifrado text, p_senha_hash text, p_senha_salt text, p_senha_parametros jsonb, p_expira_em timestamp with time zone, p_criado_por uuid, p_request_ip text, p_user_agent text),
  public.criar_nfe_de_os(p_ordemservicoid integer),
  public.devolver_os_ao_desativar_faturamento(),
  public.estornar_baixa_estoque_os(p_os_id integer),
  public.estornar_baixa_estoque_os_interna(p_os_id integer),
  public.estornar_consumos_os(p_os_id integer),
  public.excluir_checklist_documento(p_public_id uuid, p_permitir_assinado boolean),
  public.excluir_evento_financeiro_manual_os(p_ordemservico_id integer, p_evento_id bigint, p_motivo text, p_usuario uuid),
  public.faturamento_os_habilitado(),
  public.fn_disparar_processamento_notificacao_os(),
  public.fn_os_execucao_set_times(),
  public.fn_osproduto_snapshot_ultimo_custo(),
  public.fn_registrar_evento_notificacao_os(),
  public.fn_reservar_entregas_notificacao_os(p_limit integer),
  public.fn_reservar_eventos_notificacao_os(p_limit integer),
  public.impedir_financeiro_em_os_historica_migrada(),
  public.invalidar_convites_checklist_por_assinatura_presencial(),
  public.invalidar_convites_checklist_por_nova_versao(),
  public.nfse_os_servico_vinculo_sincronizar_status(),
  public.nfse_os_servico_vinculo_validar(),
  public.ordens_contagem_por_status(),
  public.os_do_evento(p_ordemservicoid integer, p_source_type text, p_source_id bigint),
  public.preencher_itens_nfe_de_os(p_nfe_id bigint),
  public.proteger_checklist_documento(),
  public.proteger_checklist_documento_evento(),
  public.proteger_credenciais_convite_checklist(),
  public.proteger_os_historica_migrada(),
  public.reaplicar_baixa_estoque_os(p_os_id integer),
  public.reaplicar_baixa_estoque_os_interna(p_os_id integer),
  public.recalcular_comissao_criacao_os(p_ordemservicoid integer, p_forcar boolean),
  public.recalcular_comissao_osservico(p_ordemservicoid integer, p_servicoid integer),
  public.recalcular_status_financeiro_os(p_ordemservicoid integer),
  public.recarimbar_comissao_criacao_os(p_ordemservicoid integer),
  public.recarimbar_comissao_osservico(p_ordemservicoid integer, p_servicoid integer),
  public.reconciliar_eventos_financeiros_os(p_ordemservicoid integer, p_incluir_comissoes boolean),
  public.registrar_consumo_produto_os(p_payload jsonb),
  public.registrar_finalizacao_os(),
  public.responder_aprovacao_os(p_token uuid, p_documento text, p_acao text),
  public.resumo_financeiro_os(p_ordemservicoid integer),
  public.revogar_convite_assinatura_checklist(p_documento_public_id uuid, p_revogado_por uuid, p_request_ip text, p_user_agent text),
  public.salvar_os_termos_impressao(p_termos jsonb),
  public.separar_conclusao_financeira_da_saida_os(),
  public.set_checklist_modelo_updated_at(),
  public.sincronizar_baixa_estoque_os_produto(p_os_id integer, p_produto_id integer, p_quantidade_alvo integer),
  public.sincronizar_eventos_financeiros_os(p_ordemservicoid integer, p_incluir_comissoes boolean),
  public.tg_ajustar_eventos_frete_os(),
  public.tg_carimbar_competencia_evento_novo(),
  public.tg_carimbar_competencia_eventos_os(),
  public.tg_congelar_comissao_ao_encerrar_execucao(),
  public.tg_congelar_comissao_criacao(),
  public.tg_espelhar_comissao_ajustada(),
  public.tg_eventos_financeiros_os_delete(),
  public.tg_excluir_transacoes_financeiras_os_por_status(),
  public.tg_gerar_eventos_financeiros_os(),
  public.tg_recalc_comissao_criacao_os_total(),
  public.tg_recalc_comissao_criacao_por_item(),
  public.tg_recalc_comissao_os_total(),
  public.tg_recalc_comissao_osservico_on_subtotal(),
  public.tg_recalc_comissao_osservico_realizador(),
  public.tg_recalc_comissao_realizadores(),
  public.tg_recalcular_status_financeiro_os(),
  public.tg_reconciliar_eventos_ao_finalizar_os(),
  public.titulo_servico_os(p_descricao_cadastro text, p_descricao_item text, p_servicoid integer),
  public.transicionar_faturamento_os(p_os_id integer, p_status text),
  public.transicionar_faturamento_os(p_os_id integer, p_status text, p_condicoes jsonb),
  public.travar_fluxo_faturamento_os(),
  public.trg_os_status_estornar(),
  public.trocar_criador_os(p_ordemservicoid integer, p_usuarioid uuid),
  public.validar_assinatura_ultima_versao_checklist(),
  public.validar_limite_pagamento_os(),
  public.validar_novo_recebimento_os(p_os_id integer),
  public.validar_ositem_historico(),
  public.validar_rateio_faturamento_os(),
  public.validar_status_faturamento_os(),
  public.vincular_nfse_os(p_nfse_id bigint, p_itens jsonb),
  public.vincular_produto_avulso_os(p_ordem_id integer, p_avulso_id bigint, p_produto_id integer),
  public.vincular_produto_avulso_os_interna(p_ordem_id integer, p_avulso_id bigint, p_produto_id integer);

-- Mantém campos escalares nulos temporariamente para os contratos de resposta
-- existentes. As FKs deixam de existir e novos vínculos legados são recusados.

alter table public.entity_video drop constraint if exists "entity_video_ordemservico_id_fkey";
alter table public.entity_video drop constraint if exists "entity_video_ordemservico_id_fkey_removido";
alter table public.entity_video add constraint "entity_video_ordemservico_id_fkey_removido" check (ordemservico_id is null);

alter table public.estoque_saida drop constraint if exists "estoque_saida_aluguel_id_fkey";
alter table public.estoque_saida drop constraint if exists "estoque_saida_aluguel_id_fkey_removido";
alter table public.estoque_saida add constraint "estoque_saida_aluguel_id_fkey_removido" check (aluguel_id is null);

alter table public.estoque_saida drop constraint if exists "estoque_saida_ordemservicoid_fkey";
alter table public.estoque_saida drop constraint if exists "estoque_saida_ordemservicoid_fkey_removido";
alter table public.estoque_saida add constraint "estoque_saida_ordemservicoid_fkey_removido" check (ordemservicoid is null);

alter table public.eventos_financeiros drop constraint if exists "eventos_financeiros_ordemservicoid_fkey";
alter table public.eventos_financeiros drop constraint if exists "eventos_financeiros_ordemservicoid_fkey_removido";
alter table public.eventos_financeiros add constraint "eventos_financeiros_ordemservicoid_fkey_removido" check (ordemservicoid is null);

alter table public.lancamento_de_eventos drop constraint if exists "lancamento_de_eventos_ordemservicoid_fkey";
alter table public.lancamento_de_eventos drop constraint if exists "lancamento_de_eventos_ordemservicoid_fkey_removido";
alter table public.lancamento_de_eventos add constraint "lancamento_de_eventos_ordemservicoid_fkey_removido" check (ordemservicoid is null);

alter table public.nfe drop constraint if exists "nfe_ordemservicoid_fkey";
alter table public.nfe drop constraint if exists "nfe_ordemservicoid_fkey_removido";
alter table public.nfe add constraint "nfe_ordemservicoid_fkey_removido" check (ordemservicoid is null);

alter table public.nfe_origem_vinculo drop constraint if exists "nfe_origem_vinculo_ordemservico_id_fkey";
alter table public.nfe_origem_vinculo drop constraint if exists "nfe_origem_vinculo_ordemservico_id_fkey_removido";
alter table public.nfe_origem_vinculo add constraint "nfe_origem_vinculo_ordemservico_id_fkey_removido" check (ordemservico_id is null);

alter table public.nfse drop constraint if exists "nfse_ordemservicoid_fkey";
alter table public.nfse drop constraint if exists "nfse_ordemservicoid_fkey_removido";
alter table public.nfse add constraint "nfse_ordemservicoid_fkey_removido" check (ordemservicoid is null);

alter table public.notafiscal drop constraint if exists "fk_nota_fiscal_ordem_servico";
alter table public.notafiscal drop constraint if exists "fk_nota_fiscal_ordem_servico_removido";
alter table public.notafiscal add constraint "fk_nota_fiscal_ordem_servico_removido" check (ordemservicoid is null);

alter table public.pagamento drop constraint if exists "pagamento_ordemservicoid_fkey";
alter table public.pagamento drop constraint if exists "pagamento_ordemservicoid_fkey_removido";
alter table public.pagamento add constraint "pagamento_ordemservicoid_fkey_removido" check (ordemservicoid is null);

alter table public.transacao drop constraint if exists "transacao_ordemservicoid_fkey";
alter table public.transacao drop constraint if exists "transacao_ordemservicoid_fkey_removido";
alter table public.transacao add constraint "transacao_ordemservicoid_fkey_removido" check (ordemservicoid is null);

alter table public.usoconsumo_saida drop constraint if exists "usoconsumo_saida_aluguel_id_fkey";
alter table public.usoconsumo_saida drop constraint if exists "usoconsumo_saida_aluguel_id_fkey_removido";
alter table public.usoconsumo_saida add constraint "usoconsumo_saida_aluguel_id_fkey_removido" check (aluguel_id is null);

alter table public.usoconsumo_saida drop constraint if exists "usoconsumo_saida_ordemservicoid_fkey";
alter table public.usoconsumo_saida drop constraint if exists "usoconsumo_saida_ordemservicoid_fkey_removido";
alter table public.usoconsumo_saida add constraint "usoconsumo_saida_ordemservicoid_fkey_removido" check (ordemservicoid is null);

drop table if exists
  public.agendamento,
  public.aluguel,
  public.aluguel_checklist,
  public.aluguel_checklist_imagem,
  public.aluguel_checklist_item,
  public.aluguel_evento,
  public.aluguel_item,
  public.checklist,
  public.checklist_documento,
  public.checklist_documento_arquivo,
  public.checklist_documento_assinatura,
  public.checklist_documento_convite_assinatura,
  public.checklist_documento_evento,
  public.checklist_modelo,
  public.checklist_modelo_item,
  public.checklist_video,
  public.cores_veiculos,
  public.imagemvistoria,
  public.lote_imagem,
  public.lote_pecas,
  public.lotes,
  public.orcamento,
  public.orcamento_produto,
  public.orcamento_produto_avulso,
  public.orcamento_servico,
  public.ordemservico,
  public.os_comissao_criacao,
  public.os_notificacao_entrega,
  public.os_notificacao_evento,
  public.os_saida,
  public.os_saida_checklist_imagem,
  public.os_saida_checklist_item,
  public.os_termo_impressao,
  public.osanexo,
  public.osaprovacao,
  public.ositem_historico,
  public.osproduto,
  public.osproduto_avulso,
  public.osproduto_baixa,
  public.osservico,
  public.osservico_realizador,
  public.peca,
  public.transferencias_veiculos,
  public.veiculo,
  public.veiculo_imagem,
  public.nfse_os_servico_vinculo;

alter table public.config_geral
  drop column if exists agendamento_intervalo_minutos,
  drop column if exists agendamento_hora_inicio,
  drop column if exists agendamento_hora_fim,
  drop column if exists agendamento_dias_trabalho;
alter table public.servico drop column if exists permite_agendamento;

delete from public.perfilpermissao pp using public.permissao p
where pp.permissaoid=p.id and p.nome in ('agendamentos:visualizar','agendamentos:criar','agendamentos:editar','agendamentos:excluir');
delete from public.permissao where nome in ('agendamentos:visualizar','agendamentos:criar','agendamentos:editar','agendamentos:excluir');

notify pgrst, 'reload schema';
commit;
