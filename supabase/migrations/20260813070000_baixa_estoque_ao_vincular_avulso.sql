-- Vincular produto avulso com a OS ja em execucao tem que baixar o estoque.
--
-- `vincular_produto_avulso_os_interna` so conhece o caminho do modo ORCAMENTO:
-- ali a baixa acontece quando o item entra no orcamento, entao ela baixa junto.
-- No modo EXECUCAO a baixa e feita uma unica vez, na virada para EM_ANDAMENTO
-- (`consumir_estoque_os`). Um avulso vinculado depois disso entrava em
-- `osproduto` sem linha em `osproduto_baixa`: a peca saia da prateleira e o
-- saldo do sistema continuava cheio ate alguem reabrir e salvar o orcamento,
-- que e o unico ponto que hoje sincroniza (PUT /api/ordens/[id]/orcamento).
--
-- `sincronizar_baixa_estoque_os_produto` e a mesma rotina que aquele PUT usa:
-- trava a linha do produto, calcula o delta contra a baixa vigente, recusa se
-- faltar saldo e carimba o movimento no razao. Como o delta e calculado contra
-- o que ja foi baixado, chama-la no modo ORCAMENTO seria inofensivo (delta 0),
-- mas o IF deixa explicito de que caso estamos falando.
--
-- Tudo roda na mesma transacao da RPC: estoque insuficiente derruba junto a
-- insercao em `osproduto` e a remocao do avulso, e nada fica pela metade.
CREATE OR REPLACE FUNCTION public.vincular_produto_avulso_os(
  p_ordem_id integer,
  p_avulso_id bigint,
  p_produto_id integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_modo text := 'ORCAMENTO';
  v_quantidade integer;
BEGIN
  PERFORM public.estoque_definir_contexto('ORDEM_SERVICO', p_ordem_id::bigint, 'OS #' || p_ordem_id);
  PERFORM public.vincular_produto_avulso_os_interna(p_ordem_id, p_avulso_id, p_produto_id);

  SELECT status::text
    INTO v_status
  FROM public.ordemservico
  WHERE id = p_ordem_id;

  SELECT COALESCE(modo_baixa_estoque_os::text, 'ORCAMENTO')
    INTO v_modo
  FROM public.config_geral
  ORDER BY id DESC
  LIMIT 1;

  -- PAGAMENTO acompanha EM_ANDAMENTO pela mesma razao que no PUT do orcamento:
  -- a OS ja consumiu material, entao mexer nos itens tem que mexer no saldo.
  IF v_modo = 'EXECUCAO' AND v_status IN ('EM_ANDAMENTO', 'PAGAMENTO') THEN
    SELECT quantidade::integer
      INTO v_quantidade
    FROM public.osproduto
    WHERE ordemservicoid = p_ordem_id AND produtoid = p_produto_id;

    IF v_quantidade IS NOT NULL AND v_quantidade > 0 THEN
      PERFORM public.sincronizar_baixa_estoque_os_produto(p_ordem_id, p_produto_id, v_quantidade);
    END IF;
  END IF;

  IF v_status IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO') THEN
    PERFORM public.reconciliar_eventos_financeiros_os(
      p_ordem_id,
      v_status IN ('EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO')
    );
  END IF;
END;
$function$;

ALTER FUNCTION public.vincular_produto_avulso_os(integer, bigint, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.vincular_produto_avulso_os(integer, bigint, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_produto_avulso_os(integer, bigint, integer)
  TO service_role;
