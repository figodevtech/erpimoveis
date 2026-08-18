-- Saque e deposito nao sao receita nem despesa: nao entram na DRE.
--
-- Sao movimentacao de tesouraria — dinheiro mudando de lugar entre o caixa e a
-- conta. Nao ha fato economico novo: a empresa nao ficou mais rica por depositar
-- nem mais pobre por sacar. Vale para os dois, independentemente da conta do
-- plano em que estiverem classificados.
--
-- CORRIGE UMA DECISAO ERRADA MINHA, DA 20260817110000
-- Naquela migration eu tratei DEPOSITO como entrada de resultado, com este
-- raciocinio: "deposito e dinheiro entrando, saque e dinheiro saindo, entao a
-- regra `RECEITA e entrada, todo o resto e saida` estava errada". O raciocinio
-- descreve o caixa, nao o resultado — e a DRE e por competencia. Deposito de
-- verdade nunca deveria ter chegado ao livro, em natureza nenhuma.
--
-- Ate aqui isso passou despercebido porque todo SAQUE/DEPOSITO dos bancos cai em
-- "Movimentacoes nao operacionais", que ja e excluida do resultado pelo grupo do
-- plano de contas. A regra do grupo escondia a falta da regra do tipo.
--
-- O QUE ISSO RESOLVE, COM NOME E SOBRENOME
-- No Demir ha exatamente duas transacoes desse tipo com evento no livro, e sao
-- um par:
--
--   #1291  SAQUE     R$ 73,49  "ENVIO P/ ANNA KAROLINE..."     o frete pago
--   #1555  DEPOSITO  R$ 73,49  "REEMBOLSO DE FRETE, ENVIO..."  o cliente devolveu
--
-- As duas na conta "Correios, entregas e transportes", que aponta para
-- 6.6 Outras despesas operacionais. Como `dre_somar_por_linha` soma sem olhar a
-- natureza, a linha mostrava R$ 146,98 de despesa onde o gasto liquido foi zero
-- — o pagamento somando e o reembolso somando junto, em vez de se anularem.
--
-- Com as duas fora do resultado, a linha volta para zero, que e a resposta certa
-- para um par de movimentacoes de tesouraria.
--
-- Nenhum outro banco tem transacao SAQUE ou DEPOSITO (verificado nos quatro).

BEGIN;

CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_transacao(p_transacaoid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tx public.transacao%ROWTYPE;
  v_linha_id integer;
  v_exclui boolean := false;
  v_natureza text;
  v_natureza_dre text;
begin
  select * into v_tx from public.transacao where id = p_transacaoid;
  if not found then return; end if;

  -- Liquidacao de algo ja reconhecido, compra que vira estoque, saldo de
  -- abertura migrado, antecipacao de recebiveis ou movimentacao de tesouraria:
  -- nao e resultado novo. Se ja existir evento, encerra.
  --
  -- SAQUE e DEPOSITO entram nesta lista pelo que sao: dinheiro mudando de lugar
  -- entre o caixa e a conta. Nao dependem da conta do plano — um saque numa
  -- conta de despesa continua sendo saque. Quando um gasto de verdade for
  -- lancado como saque, o conserto e trocar o tipo do lancamento, nao fazer a
  -- DRE adivinhar.
  if v_tx.is_deleted
     or v_tx.evento_financeiro_id is not null
     or v_tx.ordemservicoid is not null
     or v_tx.vendaid is not null
     or v_tx.entrada_id is not null
     or v_tx.usoconsumo_entrada_id is not null
     or v_tx.origem = 'ORIGEM_MIGRACAO'
     or coalesce(v_tx.eh_adiantamento, false)
     or v_tx.adiantamento_id is not null
     or upper(v_tx.tipo::text) in ('SAQUE', 'DEPOSITO') then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  select mp.linha_id, mp.exclui_do_resultado
    into v_linha_id, v_exclui
    from public.planosdeconta pc
    join public.dre_mapeamento mp
      on mp.origem_tipo = 'PLANO_GRUPO' and mp.origem_id = pc.grupo_id and mp.ativo
   where pc.id = v_tx.plano_de_conta_id
   limit 1;

  if coalesce(v_exclui, false) then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  -- Chegando aqui, so restam RECEITA e DESPESA: os outros dois tipos foram
  -- devolvidos la em cima. A regra volta a ser a original, e agora ela e
  -- completa em vez de ser um "todo o resto" que engolia saque e deposito.
  v_natureza := case when upper(v_tx.tipo::text) = 'RECEITA' then 'RECEITA' else 'DESPESA' end;

  select dl.natureza_dre into v_natureza_dre
    from public.dre_linha dl where dl.id = v_linha_id;

  v_natureza_dre := coalesce(v_natureza_dre,
    case when v_natureza = 'RECEITA' then 'RECEITA' else 'DESPESA' end);

  -- `natureza` faz parte da chave do `on conflict`, e `idx_eventos_financeiros_
  -- transacao` garante no maximo um evento por transacao. Se a natureza mudou,
  -- o upsert nao reconheceria a linha existente e tentaria inserir uma segunda,
  -- batendo naquele indice. Realinhar antes deixa o upsert seguir normalmente.
  update public.eventos_financeiros
     set natureza = v_natureza, updated_at = now()
   where source_type = 'TRANSACAO'
     and source_id = p_transacaoid
     and status <> 'CONVERTIDO'
     and natureza is distinct from v_natureza;

  insert into public.eventos_financeiros
    (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, competencia_em, dre_linha_id,
     centro_custo_id, transacaoid, dados_snapshot, pode_gerar_transacao, status)
  values
    (null, 'TRANSACAO', p_transacaoid, 'AVULSO', v_natureza, v_natureza_dre,
     'TRANSACAO', coalesce(nullif(v_tx.descricao, ''), 'Lancamento #' || p_transacaoid),
     nullif(v_tx.plano_de_conta, ''), round(coalesce(v_tx.valor, 0), 2),
     coalesce(v_tx.competencia_em, v_tx.data), v_linha_id,
     v_tx.centro_custo_id, p_transacaoid,
     jsonb_build_object('categoria', v_tx.categoria, 'sem_classificacao', v_linha_id is null),
     false, 'ATIVO')
  on conflict (source_type, source_id, origem, chave_origem, natureza)
    where ordemservicoid is null
  do update set valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                competencia_em = excluded.competencia_em,
                dre_linha_id = excluded.dre_linha_id,
                natureza_dre = excluded.natureza_dre,
                centro_custo_id = excluded.centro_custo_id,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  where public.eventos_financeiros.status <> 'CONVERTIDO';
end;
$function$;

COMMENT ON FUNCTION public.sincronizar_eventos_financeiros_transacao(bigint) IS
  'Evento de resultado de uma transacao avulsa. Ignora o que e liquidacao de algo ja reconhecido (OS, venda, evento), compra que vira estoque, saldo de abertura migrado, antecipacao de recebiveis e movimentacao de tesouraria (saque e deposito).';

-- Encerra os eventos que os SAQUE/DEPOSITO ja produziram.
DO $tesouraria$
DECLARE
  v_id bigint;
  v_n int := 0;
BEGIN
  FOR v_id IN
    SELECT DISTINCT t.id
      FROM public.transacao t
      JOIN public.eventos_financeiros e
        ON e.source_type = 'TRANSACAO' AND e.source_id = t.id AND e.status = 'ATIVO'
     WHERE upper(t.tipo::text) IN ('SAQUE', 'DEPOSITO')
  LOOP
    PERFORM public.sincronizar_eventos_financeiros_transacao(v_id);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'Saque/deposito retirados do resultado: % transacao(oes).', v_n;
END $tesouraria$;

COMMIT;
