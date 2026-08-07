-- OS finalizada sem cobranca publicava receita que nunca existiu.
--
-- PROBLEMA
-- `tg_reconciliar_eventos_ao_finalizar_os` tratava SEM_COBRANCA igual a
-- CONCLUIDO: chamava `reconciliar_eventos_financeiros_os`. Como a reconciliacao
-- calcula receita bruta pelo preco de tabela e deduz apenas ate o
-- `orcamentototal`, uma OS finalizada sem cobranca com orcamento de R$ 500
-- preenchido entrava na DRE com R$ 500 de receita liquida.
--
-- A migration 20260802150000 ja decidiu que "se a OS nao cobra, a receita e
-- zero", mas resolvia pelo valor (orcamentototal = 0, cortesia com 100% de
-- desconto). Quem finaliza pelo botao "sem cobranca" nao passava por ali:
-- SEM_COBRANCA nao aparecia em nenhuma das funcoes financeiras.
--
-- AGORA
-- A rota de status zera o orcamento antes de mudar o status, e este trigger
-- retira do livro o que nao e gasto. Sobram as despesas — o custo da peca, que
-- foi consumida de verdade, e a comissao, que ja chega recalculada sobre a base
-- zerada pelo `trg_recalc_comissao_os_total`.
--
-- Cancelamos tambem o evento de DESCONTO: ele e a deducao de uma receita que
-- deixou de existir, e sozinho viraria despesa fantasma.
--
-- O filtro `status = 'ATIVO'` preserva os eventos ja CONVERTIDO. Uma receita
-- avulsa que virou transacao real e dinheiro que de fato entrou; quem quiser
-- desfazer precisa estornar pelo financeiro, nao pela mudanca de status.
BEGIN;

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
    -- Acerta custo e comissao pelo caminho normal...
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
    -- ...e retira receita e deducao, que nao existem numa OS sem cobranca.
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where ordemservicoid = new.id
       and status = 'ATIVO'
       and (natureza = 'RECEITA' or origem = 'DESCONTO');

  elsif new.status::text = 'CONCLUIDO' then
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
  end if;

  return new;
end;
$function$;

COMMIT;
