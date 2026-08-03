-- DRE — Fase 2: despesas e receitas proprias do financeiro.
--
-- O RISCO CENTRAL E CONTAR DUAS VEZES
-- A maior parte das transacoes do sistema nao e fato economico novo: e a
-- liquidacao de algo ja reconhecido. Uma OS entregue ja lancou sua receita no
-- livro; quando o cliente paga, nasce uma `transacao` que representa o mesmo
-- dinheiro. Trata-la como receita duplicaria o faturamento.
--
-- Por isso sao ignoradas as transacoes que:
--   * apontam para um evento financeiro (`evento_financeiro_id`) — sao a baixa dele;
--   * apontam para OS ou venda — recebimento de receita ja reconhecida;
--   * apontam para entrada de estoque ou de uso/consumo — compra nao e despesa:
--     vira estoque e chega a DRE como CMV quando o item sair;
--   * estao excluidas (`is_deleted`).
--
-- CLASSIFICACAO
-- O grupo do plano de contas define a linha, via `dre_mapeamento`. Grupos
-- marcados com `exclui_do_resultado` (aporte, retirada, emprestimo,
-- transferencia, imobilizado) nao geram evento algum.
--
-- Transacao sem plano de contas gera evento **sem linha** (`dre_linha_id` nulo).
-- Ela nao entra em nenhum total da DRE e aparece na tela de pendencias. E
-- deliberado nao chutar uma classificacao: um numero mal classificado e pior que
-- um numero ausente, porque parece certo.
--
-- COMPETENCIA = `transacao.competencia_em`, nao `pago_em`. Conta de energia de
-- julho paga em agosto pertence a julho.
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

  -- Liquidacao de algo ja reconhecido, ou compra que vira estoque: nao e
  -- resultado novo. Se ja existir evento (a transacao foi religada), encerra.
  if v_tx.is_deleted
     or v_tx.evento_financeiro_id is not null
     or v_tx.ordemservicoid is not null
     or v_tx.vendaid is not null
     or v_tx.entrada_id is not null
     or v_tx.usoconsumo_entrada_id is not null then
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

  v_natureza := case when upper(v_tx.tipo::text) = 'RECEITA' then 'RECEITA' else 'DESPESA' end;

  select dl.natureza_dre into v_natureza_dre
    from public.dre_linha dl where dl.id = v_linha_id;

  v_natureza_dre := coalesce(v_natureza_dre,
    case when v_natureza = 'RECEITA' then 'RECEITA' else 'DESPESA' end);

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

CREATE OR REPLACE FUNCTION public.tg_eventos_financeiros_transacao()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  perform public.sincronizar_eventos_financeiros_transacao(new.id);
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_eventos_financeiros_transacao ON public.transacao;
CREATE TRIGGER trg_eventos_financeiros_transacao
AFTER INSERT OR UPDATE OF valor, tipo, competencia_em, data, plano_de_conta_id,
                          centro_custo_id, is_deleted, descricao
ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_transacao();

DO $backfill$
DECLARE v_id bigint;
BEGIN
  FOR v_id IN SELECT id FROM public.transacao ORDER BY id LOOP
    PERFORM public.sincronizar_eventos_financeiros_transacao(v_id);
  END LOOP;
END
$backfill$;

COMMIT;
