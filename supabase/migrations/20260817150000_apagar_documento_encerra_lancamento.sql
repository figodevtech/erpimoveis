-- Apagar uma venda ou uma OS deixava os lancamentos vivos na DRE.
--
-- CASO REAL — venda #67 do Demir
-- A venda foi apagada e os dois eventos dela continuam ATIVO, com competencia,
-- somando na DRE:
--
--   venda #67  PRODUTO/RECEITA  R$ 12.000,00  competencia 03/08
--   venda #67  PRODUTO/DESPESA  R$  2.500,00  competencia 03/08
--
-- R$ 12 mil de faturamento e R$ 2,5 mil de custo de uma venda que nao existe
-- mais. O drill-down da linha aponta para um registro que nao da para abrir.
--
-- Foi assim que ela apareceu na conferencia: como "custo na DRE sem saida de
-- estoque". Claro que nao ha saida — a venda foi apagada.
--
-- POR QUE ACONTECE
-- `trg_eventos_financeiros_venda` e AFTER INSERT OR UPDATE, sem DELETE. O mesmo
-- vale para a OS, que nao tem gatilho nenhum de exclusao ligado aos eventos.
--
-- A venda #83, tambem apagada, teve sorte: foi CANCELADA antes de ser apagada, e
-- o cancelamento passa por UPDATE de status — que o gatilho ve. Quem apaga
-- direto, sem cancelar antes, deixa o rastro. E o caminho depende de quem usa.
--
-- TRES CAMINHOS, TRES GATILHOS
--   1. venda apagada          (DELETE em venda)
--   2. OS apagada             (DELETE em ordemservico)
--   3. OS excluida logicamente (is_deleted = true) — nada reagia a isso hoje,
--      e e o caminho mais provavel, porque a OS tem exclusao logica enquanto a
--      venda e apagada de verdade.
--
-- Em todos, CONVERTIDO e preservado: virou transacao e cabe ao financeiro
-- estornar, do mesmo jeito que ja acontece no cancelamento.
--
-- Nenhum outro banco tem documento apagado com evento vivo (verificado nos
-- quatro). O backfill fecha os dois do Demir.

BEGIN;

-- =========================================================== venda apagada
CREATE OR REPLACE FUNCTION public.tg_eventos_financeiros_venda_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  update public.eventos_financeiros
     set status = 'CANCELADO', updated_at = now()
   where source_type = 'VENDA'
     and source_id = old.id
     and status = 'ATIVO';

  return old;
end;
$function$;

DROP TRIGGER IF EXISTS trg_eventos_financeiros_venda_delete ON public.venda;
CREATE TRIGGER trg_eventos_financeiros_venda_delete
AFTER DELETE ON public.venda
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_venda_delete();

-- ============================================== OS apagada ou excluida
CREATE OR REPLACE FUNCTION public.tg_eventos_financeiros_os_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  -- Serve aos dois gatilhos: no DELETE nao ha `new`, e na exclusao logica o
  -- `old.id` e o mesmo `new.id`. Usar `old` cobre os dois sem ramificar.
  update public.eventos_financeiros
     set status = 'CANCELADO', updated_at = now()
   where ordemservicoid = old.id
     and status = 'ATIVO';

  return old;
end;
$function$;

DROP TRIGGER IF EXISTS trg_eventos_financeiros_os_delete ON public.ordemservico;
CREATE TRIGGER trg_eventos_financeiros_os_delete
AFTER DELETE ON public.ordemservico
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_os_delete();

DROP TRIGGER IF EXISTS trg_eventos_financeiros_os_exclusao_logica ON public.ordemservico;
CREATE TRIGGER trg_eventos_financeiros_os_exclusao_logica
AFTER UPDATE OF is_deleted ON public.ordemservico
FOR EACH ROW
WHEN (coalesce(new.is_deleted, false) AND NOT coalesce(old.is_deleted, false))
EXECUTE FUNCTION public.tg_eventos_financeiros_os_delete();

-- ================================================= o que ja ficou para tras
DO $orfaos$
DECLARE
  v_venda int;
  v_os int;
  v_logica int;
BEGIN
  UPDATE public.eventos_financeiros e
     SET status = 'CANCELADO', updated_at = now()
   WHERE e.source_type = 'VENDA'
     AND e.status = 'ATIVO'
     AND NOT EXISTS (SELECT 1 FROM public.venda v WHERE v.id = e.source_id);
  GET DIAGNOSTICS v_venda = ROW_COUNT;

  UPDATE public.eventos_financeiros e
     SET status = 'CANCELADO', updated_at = now()
   WHERE e.ordemservicoid IS NOT NULL
     AND e.status = 'ATIVO'
     AND NOT EXISTS (SELECT 1 FROM public.ordemservico o WHERE o.id = e.ordemservicoid);
  GET DIAGNOSTICS v_os = ROW_COUNT;

  UPDATE public.eventos_financeiros e
     SET status = 'CANCELADO', updated_at = now()
    FROM public.ordemservico o
   WHERE o.id = e.ordemservicoid
     AND coalesce(o.is_deleted, false)
     AND e.status = 'ATIVO';
  GET DIAGNOSTICS v_logica = ROW_COUNT;

  RAISE NOTICE 'Encerrados: % de venda apagada, % de OS apagada, % de OS excluida.',
    v_venda, v_os, v_logica;
END $orfaos$;

COMMIT;
