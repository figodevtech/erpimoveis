-- DRE — corrige a competencia dos eventos de OS e o cancelamento.
--
-- PROBLEMA 1: competencia atribuida a servico nao entregue.
-- A migration 160000 preencheu `competencia_em` com
-- coalesce(execucao_fim_em, dataentrada). Para OS que ainda nao terminaram a
-- execucao, `execucao_fim_em` e nulo e o backfill caiu na data de entrada — ou
-- seja, deu competencia a receita que a empresa ainda nao entregou. No Demir
-- isso atingiu 70 dos 152 eventos e inflou a receita de R$ 71.100 para
-- R$ 180.640.
--
-- Regra correta: enquanto a execucao nao encerra, o evento existe no livro (a
-- OS precisa dele para projetar rentabilidade) mas **nao tem competencia** e
-- portanto nao entra em periodo nenhum da DRE. O fato economico ainda nao
-- ocorreu. A competencia e carimbada quando `execucao_fim_em` e preenchido.
--
-- PROBLEMA 2: OS cancelada mantinha eventos ATIVO.
-- `tg_reconciliar_eventos_ao_finalizar_os` chamava `reconciliar` tambem no
-- CANCELADO. Mas reconciliar **reconstroi** o conjunto desejado a partir de
-- `osproduto`/`osservico`, e cancelar a OS nao remove os itens — os eventos
-- eram recriados com valor cheio. No Demir, 3 OS canceladas somavam R$ 9.240 de
-- receita ativa.
--
-- Cancelar a OS agora cancela os eventos. Eventos ja CONVERTIDO sao preservados:
-- viraram transacao real e devem ser estornados pelo financeiro, nao apagados.
BEGIN;

-- ------------------------------------------------------------ problema 1
-- Retira a competencia de tudo que ainda nao foi entregue.
UPDATE public.eventos_financeiros e
   SET competencia_em = NULL,
       updated_at = now()
  FROM public.ordemservico o
 WHERE o.id = e.ordemservicoid
   AND o.execucao_fim_em IS NULL
   AND e.competencia_em IS NOT NULL;

-- Alinha o restante com o fim da execucao, sem fallback.
UPDATE public.eventos_financeiros e
   SET competencia_em = o.execucao_fim_em,
       updated_at = now()
  FROM public.ordemservico o
 WHERE o.id = e.ordemservicoid
   AND o.execucao_fim_em IS NOT NULL
   AND e.competencia_em IS DISTINCT FROM o.execucao_fim_em;

COMMENT ON COLUMN public.eventos_financeiros.competencia_em IS
  'Data que determina o periodo na DRE. Em eventos de ordem de servico e o fim da execucao; fica NULL enquanto o servico nao foi entregue, pois o fato economico ainda nao ocorreu.';

-- Carimba a competencia quando a execucao encerra (ou a retira, se voltar atras).
CREATE OR REPLACE FUNCTION public.tg_carimbar_competencia_eventos_os()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if new.execucao_fim_em is distinct from old.execucao_fim_em then
    update public.eventos_financeiros
       set competencia_em = new.execucao_fim_em,
           updated_at = now()
     where ordemservicoid = new.id
       and status <> 'CANCELADO'
       and competencia_em is distinct from new.execucao_fim_em;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_carimbar_competencia_eventos_os ON public.ordemservico;
CREATE TRIGGER trg_carimbar_competencia_eventos_os
AFTER UPDATE OF execucao_fim_em ON public.ordemservico
FOR EACH ROW EXECUTE FUNCTION public.tg_carimbar_competencia_eventos_os();

-- ------------------------------------------------------------ problema 2
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

  elsif new.status::text in ('CONCLUIDO', 'SEM_COBRANCA') then
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
  end if;

  return new;
end;
$function$;

-- Corrige as OS ja canceladas que ficaram com eventos ativos.
UPDATE public.eventos_financeiros e
   SET status = 'CANCELADO', updated_at = now()
  FROM public.ordemservico o
 WHERE o.id = e.ordemservicoid
   AND o.status::text = 'CANCELADO'
   AND e.status = 'ATIVO';

COMMIT;
