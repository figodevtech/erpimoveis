-- Saldo de abertura importado de sistema anterior nao e resultado do ERP.
--
-- Quando um cliente migra para o ERP, ele traz os titulos que ainda estao em
-- aberto no sistema antigo. Esses titulos precisam existir no contas a pagar e
-- receber, para que a cobranca e o pagamento sigam daqui, mas o fato economico
-- que os originou ja foi reconhecido la atras. Lanca-los na DRE criaria
-- resultado do nada, em competencias anteriores a propria existencia do ERP.
--
-- E o mesmo raciocinio que a funcao ja aplica a transacao ligada a OS, venda ou
-- entrada: nao e fato novo, e a contraparte de algo ja reconhecido. Aqui o "ja
-- reconhecido" aconteceu fora do sistema.
--
-- A alternativa seria importar sem plano de contas, porque transacao sem plano
-- nao entra em nenhum total. Isso funcionaria para a DRE, mas jogaria a carga
-- inteira na tela de pendencias de classificacao e apagaria a classificacao nas
-- telas do financeiro. Marcar a origem preserva as duas coisas.
--
-- O carimbo e generico de proposito. Todo cliente que migra para o ERP passa por
-- isto, entao a origem e uma so - ORIGEM_MIGRACAO - e vale para qualquer carga,
-- de qualquer sistema anterior, sem precisar de nova migracao a cada cliente.
-- Qual foi a carga e de onde veio cada titulo fica em transacao.descricao_pagamento.
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

  -- Liquidacao de algo ja reconhecido, compra que vira estoque, ou saldo de
  -- abertura trazido de outro sistema: nao e resultado novo. Se ja existir
  -- evento (a transacao foi religada), encerra.
  if v_tx.is_deleted
     or v_tx.evento_financeiro_id is not null
     or v_tx.ordemservicoid is not null
     or v_tx.vendaid is not null
     or v_tx.entrada_id is not null
     or v_tx.usoconsumo_entrada_id is not null
     or v_tx.origem = 'ORIGEM_MIGRACAO' then
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

-- A funcao passou a olhar transacao.origem, que nao esta na lista de colunas que
-- disparam o gatilho. Sem isto, mudar a origem de uma transacao existente nao
-- reavaliaria o evento dela.
DROP TRIGGER IF EXISTS trg_eventos_financeiros_transacao ON public.transacao;
CREATE TRIGGER trg_eventos_financeiros_transacao
AFTER INSERT OR UPDATE OF valor, tipo, competencia_em, data, plano_de_conta_id,
                          centro_custo_id, is_deleted, descricao, origem
ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_transacao();

-- Cancela o que porventura ja tenha sido gerado para uma origem de migracao.
-- Hoje nao existe nenhuma em nenhum banco; a varredura e para o caso de esta
-- migracao ser aplicada depois de uma carga.
DO $backfill$
DECLARE v_id bigint;
BEGIN
  FOR v_id IN
    SELECT id FROM public.transacao
     WHERE origem = 'ORIGEM_MIGRACAO'
     ORDER BY id
  LOOP
    PERFORM public.sincronizar_eventos_financeiros_transacao(v_id);
  END LOOP;
END
$backfill$;

COMMIT;
