-- Voltar uma venda em PAGAMENTO para ORCAMENTO.
--
-- PROBLEMA
-- Aprovar um orcamento e um caminho so: fn_aprovar_orcamento_venda baixa o
-- estoque e joga a venda para PAGAMENTO. Quando a aprovacao foi engano (cliente
-- desistiu, o vendedor clicou na venda errada), a unica saida era cancelar ou
-- excluir a venda -- as duas perdem o orcamento que ja estava montado.
--
-- Um PATCH direto de status para ORCAMENTO tambem nao resolve: ele grava o
-- status e pronto, deixando o estoque baixado por uma venda que voltou a ser
-- proposta e os titulos parciais em aberto no financeiro.
--
-- SOLUCAO
-- Uma funcao que desfaz exatamente o que a aprovacao fez, na mesma transacao:
-- devolve o estoque pela baixa registrada e apaga (exclusao logica, como em
-- cancelar_venda) as transacoes vinculadas. Os itens e os valores da venda
-- continuam intactos -- e disso que se trata: preservar o orcamento.
--
-- So aceita venda em PAGAMENTO. Venda PAGA ou FINALIZADA ja virou receita
-- baixada, e voltar dali seria estorno de caixa, outro fluxo.
BEGIN;

CREATE OR REPLACE FUNCTION public.reverter_venda_para_orcamento(
  p_venda_id bigint,
  p_usuario_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda public.venda%ROWTYPE;
  v_produtos_devolvidos integer := 0;
  v_transacoes_excluidas integer := 0;
  v_valor_concluido numeric := 0;
BEGIN
  SELECT * INTO v_venda FROM public.venda WHERE id = p_venda_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF upper(v_venda.status::text) <> 'PAGAMENTO' THEN
    RAISE EXCEPTION 'Somente vendas em PAGAMENTO podem voltar para orçamento (esta está %).', v_venda.status
      USING ERRCODE = '22023';
  END IF;

  -- Mesma trava do cancelamento: nota emitida amarra a venda ao numero fiscal.
  IF EXISTS (
    SELECT 1 FROM public.nfe
    WHERE vendaid = p_venda_id AND status::text NOT IN ('RASCUNHO', 'CANCELADA', 'REJEITADA')
  ) THEN
    RAISE EXCEPTION 'Cancele a NF-e autorizada ou em processamento antes de voltar a venda para orçamento.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO v_produtos_devolvidos
  FROM public.vendaproduto_baixa WHERE venda_id = p_venda_id;
  PERFORM public.fn_estornar_estoque_venda(p_venda_id::integer);

  SELECT count(*)::integer, coalesce(sum(valor) FILTER (WHERE NOT pendente), 0)
    INTO v_transacoes_excluidas, v_valor_concluido
  FROM public.transacao
  WHERE vendaid = p_venda_id AND NOT is_deleted;

  UPDATE public.transacao
  SET pendente = false, is_deleted = true, deleted_at = now(), deleted_by = p_usuario_id,
      updated_at = now(), updated_by = p_usuario_id
  WHERE vendaid = p_venda_id AND NOT is_deleted;

  -- forma_pagamento volta a ser nula porque ela e escolhida na aprovacao: manter
  -- a antiga faria o orcamento exibir um pagamento que ninguem combinou ainda.
  UPDATE public.venda
  SET status = 'ORCAMENTO', forma_pagamento = NULL,
      updated_by = coalesce(p_usuario_id, updated_by), updatedat = now()
  WHERE id = p_venda_id;

  RETURN jsonb_build_object(
    'vendaId', p_venda_id,
    'status', 'ORCAMENTO',
    'produtosDevolvidos', v_produtos_devolvidos,
    'transacoesExcluidas', v_transacoes_excluidas,
    'valorConcluidoRemovido', v_valor_concluido
  );
END;
$$;

ALTER FUNCTION public.reverter_venda_para_orcamento(bigint, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverter_venda_para_orcamento(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverter_venda_para_orcamento(bigint, uuid) TO service_role;

-- Marcos de status: a volta para orçamento apaga `pagamento_em`.
--
-- O `coalesce` do trigger (20260811203000) existe para o vai-e-volta entre
-- FINALIZADA e PAGAMENTO, onde o primeiro marco e o que vale para a comissao.
-- Aqui e o contrario: a venda deixou de estar em cobranca e voltou a ser
-- proposta, e a Central Pessoal filtra por `pagamento_em` justamente para manter
-- orcamento nao aprovado fora da aba. Sem limpar, a venda revertida continuaria
-- contando como venda do periodo.
CREATE OR REPLACE FUNCTION public.tg_venda_carimbar_marcos()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
declare
  v_status text := upper(new.status::text);
  v_anterior text := case when tg_op = 'UPDATE' then upper(old.status::text) else null end;
  -- Venda importada ou lançada com data retroativa: o marco acompanha a data
  -- informada, senão o histórico do vendedor migra todo para o dia da carga.
  v_referencia timestamptz := coalesce(new.datavenda, now());
begin
  if tg_op = 'INSERT' then
    if v_status = 'ABERTA' then
      new.orcamento_em := coalesce(new.orcamento_em, v_referencia);
    elsif v_status = 'PAGAMENTO' then
      new.pagamento_em := coalesce(new.pagamento_em, v_referencia);
    elsif v_status = 'FINALIZADA' then
      new.pagamento_em := coalesce(new.pagamento_em, v_referencia);
      new.baixada_em := coalesce(new.baixada_em, v_referencia);
    end if;
    return new;
  end if;

  if v_status is not distinct from v_anterior then
    return new;
  end if;

  -- `coalesce` em vez de atribuição direta: se a venda voltar de FINALIZADA por
  -- estorno e for para pagamento de novo, o marco que vale é o primeiro — é ele
  -- que define o período de comissão do vendedor.
  if v_status = 'PAGAMENTO' then
    new.pagamento_em := coalesce(new.pagamento_em, now());
  end if;

  if v_status = 'FINALIZADA' then
    -- Venda que pula direto para FINALIZADA (quitada no ato) nunca passou por um
    -- UPDATE para PAGAMENTO: sem isto ela ficaria fora do filtro da aba.
    new.pagamento_em := coalesce(new.pagamento_em, now());
    new.baixada_em := coalesce(new.baixada_em, now());
  elsif v_anterior = 'FINALIZADA' and v_status = 'PAGAMENTO' then
    -- Estorno da baixa: sem limpar, a venda ficaria em PAGAMENTO exibindo data
    -- de baixa. Cancelamento não passa por aqui — lá o histórico é preservado.
    new.baixada_em := null;
  elsif v_status = 'ORCAMENTO' then
    -- Voltou a ser proposta: não há pagamento nem baixa a exibir.
    new.pagamento_em := null;
    new.baixada_em := null;
    new.orcamento_em := coalesce(new.orcamento_em, now());
  end if;

  return new;
end;
$function$;

ALTER FUNCTION public.tg_venda_carimbar_marcos() OWNER TO postgres;

COMMIT;
