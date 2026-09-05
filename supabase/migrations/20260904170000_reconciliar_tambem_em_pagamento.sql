-- OS que para em PAGAMENTO nunca publicava comissao.
--
-- O PROBLEMA
-- `tg_reconciliar_eventos_ao_finalizar_os` tratava CANCELADO, SEM_COBRANCA e
-- CONCLUIDO. PAGAMENTO ficava de fora — mas `fn_os_execucao_set_times` carimba
-- `execucao_fim_em` justamente na entrada em PAGAMENTO. O resultado: a OS entra
-- no recorte de todo relatorio por conclusao (Central Pessoal, relatorios de
-- comissao) com a comissao APURADA no snapshot e NENHUM evento publicado.
--
-- Medido no Demir: 3 das 9 OS em PAGAMENTO estavam assim. Para a pessoa que
-- criou ou executou, e comissao que existe na tela e nao existe no financeiro.
--
-- Nao era so a comissao de criacao. A de realizacao tem o mesmo buraco: a
-- transicao para EM_ANDAMENTO chama `sincronizar_eventos_financeiros_os`, que
-- filtra `AND s.gera_comissao` e portanto nao publica a linha zerada que
-- 20260903180000 decidiu que deve constar no historico. Quem publica essa linha
-- e a reconciliacao — que nunca rodava para quem parava em PAGAMENTO.
--
-- A CORRECAO
-- PAGAMENTO passa a reconciliar como CONCLUIDO. Sao os dois estados em que o
-- trabalho terminou; do ponto de vista de quem executou, a OS ja fechou — e e
-- exatamente assim que `STATUS_OS_FINALIZADAS` ja os trata em
-- `src/lib/meu-perfil/regras.ts`. O gatilho estava mais restrito que o recorte
-- que o resto do sistema usa.
--
-- CUIDADO QUE ESTA MIGRATION PRECISA TER
-- 1. A reconciliacao RECUSA (P0001) quando ha evento CONVERTIDO divergente. Isso
--    agora pode bloquear a entrada em PAGAMENTO, como ja bloqueava a em
--    CONCLUIDO. E o comportamento desejado — a mensagem diz o que estornar —,
--    mas e superficie nova.
-- 2. O backfill e limitado ao MES CORRENTE de proposito. Publicar comissao em
--    mes ja fechado reescreve a DRE daquele periodo, e essa nunca foi uma
--    decisao de migration. Na aplicacao os 3 casos existentes sao todos do mes
--    corrente; um caso antigo que apareca depois entra pelo script de apuracao
--    retroativa, com a OS nomeada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) PAGAMENTO reconcilia como CONCLUIDO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_reconciliar_eventos_ao_finalizar_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status::text = 'CANCELADO' then
    -- Cancelar a OS nao remove seus itens, entao reconciliar recriaria os
    -- eventos com valor cheio. O correto e encerra-los.
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where ordemservicoid = new.id
       and status = 'ATIVO';

  elsif new.status::text = 'SEM_COBRANCA' then
    -- Acerta custo pelo caminho normal...
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
    -- ...e retira receita, deducao e comissao, que nao existem numa OS sem
    -- cobranca. Sobra o custo da peca, que foi consumida de verdade.
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where ordemservicoid = new.id
       and status = 'ATIVO'
       and (natureza = 'RECEITA' or origem = 'DESCONTO' or origem = 'COMISSAO');

  -- PAGAMENTO junto de CONCLUIDO: nos dois o trabalho terminou e
  -- `execucao_fim_em` ja foi carimbado. Deixar PAGAMENTO de fora fazia a OS
  -- entrar nos relatorios por conclusao sem nunca ter publicado a comissao.
  elsif new.status::text in ('CONCLUIDO', 'PAGAMENTO') then
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) As OS que ficaram para tras, so no mes corrente
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_os integer;
  v_corrigidas integer := 0;
  v_recusadas integer := 0;
BEGIN
  FOR v_os IN
    SELECT o.id
      FROM public.ordemservico o
     WHERE o.is_deleted = false
       AND o.status::text = 'PAGAMENTO'
       AND o.execucao_fim_em IS NOT NULL
       AND o.execucao_fim_em >= date_trunc('month', now())
       AND EXISTS (SELECT 1 FROM public.osservico s WHERE s.ordemservicoid = o.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.eventos_financeiros e
          WHERE e.ordemservicoid = o.id
            AND e.origem = 'COMISSAO'
            AND e.status <> 'CANCELADO'
       )
     ORDER BY o.id
  LOOP
    BEGIN
      PERFORM public.reconciliar_eventos_financeiros_os(v_os, true);
      v_corrigidas := v_corrigidas + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Evento convertido divergente: a OS fica como esta e o motivo aparece no
      -- log. Estornar a transacao antes e decisao de quem opera.
      v_recusadas := v_recusadas + 1;
      RAISE NOTICE 'OS % nao pode ser reconciliada: %', v_os, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Comissao publicada em % OS; % recusada(s).', v_corrigidas, v_recusadas;
END;
$backfill$;

COMMIT;
