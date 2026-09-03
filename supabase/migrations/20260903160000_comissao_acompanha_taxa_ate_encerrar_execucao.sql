-- A taxa de comissao do realizador passa a acompanhar o cadastro ate a execucao
-- terminar, e so entao congela.
--
-- O PROBLEMA. `comissao_percent_aplicada` era carimbado no INSERT do vinculo e
-- nunca mais mudava. OS aberta em julho, com o realizador a 5%, executada ate
-- setembro depois de o cadastro dele subir para 10%, pagava os 5% de julho --
-- uma taxa que ja nao existia quando o trabalho foi feito. Medido no Demir: a
-- OS #145 fechou em 02/09 pagando 5% (R$ 225) para quem esta a 10% desde 03/08.
--
-- A REGRA NOVA. Enquanto a execucao nao terminou, o carimbo segue o cadastro.
-- Quando `execucao_fim_em` e gravado, o valor daquele instante fica congelado
-- para sempre. Ou seja: paga-se a taxa vigente no dia em que o servico foi
-- entregue, nao a do dia em que o realizador foi atribuido.
--
-- POR QUE `execucao_fim_em` E NAO O STATUS. E o carimbo que define "OS
-- concluida" no sistema inteiro (20260902100000), e ele ja sabe voltar a NULL
-- quando a OS reabre. Uma OS que volta para EM_ANDAMENTO volta a acompanhar o
-- cadastro, que e o comportamento certo: o trabalho ainda esta sendo feito.
--
-- O QUE NAO MUDA. `gera_comissao = false` continua zerando o carimbo, e a regra
-- do maior percentual entre realizadores (20260901160000) segue intacta -- ela
-- opera sobre o carimbo, que agora so esta mais atual.
--
-- BACKFILL. So OS com a execucao em aberto: nelas o carimbo passa a valer pelo
-- cadastro de hoje, que e exatamente o que a regra nova diz. OS ja encerrada
-- nao e tocada -- o valor dela e historico, e mexer nisso reescreveria mes
-- fechado. A correcao pontual de uma OS ja encerrada existe fora daqui, em
-- `scripts/migracao/demir-comissao-recarimbar-os.ts`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Carimbo pelo cadastro, respeitando a flag do servico
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recarimbar_comissao_osservico(
  p_ordemservicoid integer,
  p_servicoid integer DEFAULT NULL
)
RETURNS void
LANGUAGE sql
AS $function$
  UPDATE public.osservico_realizador r
     SET comissao_percent_aplicada =
           CASE
             WHEN coalesce((SELECT s.gera_comissao FROM public.servico s WHERE s.id = r.servicoid), true)
               THEN coalesce((SELECT u.comissao_percent FROM public.usuario u WHERE u.id = r.usuarioid), 0)
             ELSE 0
           END,
         updated_at = now()
   WHERE r.ordemservicoid = p_ordemservicoid
     AND (p_servicoid IS NULL OR r.servicoid = p_servicoid);
$function$;

COMMENT ON FUNCTION public.recarimbar_comissao_osservico(integer, integer) IS
  'Traz comissao_percent_aplicada do cadastro do usuario para os vinculos da OS (ou de um servico dela). Servico sem comissao carimba zero.';

-- ---------------------------------------------------------------------------
-- 2) O recalculo passa a recarimbar enquanto a execucao nao encerrou
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalcular_comissao_osservico(
  p_ordemservicoid integer,
  p_servicoid integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_subtotal numeric;
  v_qtd int;
  v_gera_comissao boolean;
  v_total_itens numeric := 0;
  v_total_os_sem_frete numeric := 0;
  v_fator numeric := 1;
  v_base_liquida numeric;
  v_percent_maior numeric := 0;
  v_execucao_encerrada boolean := true;
BEGIN
  SELECT coalesce(s.subtotal, 0) INTO v_subtotal
    FROM public.osservico s
   WHERE s.ordemservicoid = p_ordemservicoid AND s.servicoid = p_servicoid;
  SELECT coalesce(sv.gera_comissao, true) INTO v_gera_comissao
    FROM public.servico sv WHERE sv.id = p_servicoid;
  SELECT count(*) INTO v_qtd FROM public.osservico_realizador r
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;
  IF v_qtd <= 0 THEN RETURN; END IF;

  SELECT greatest(coalesce(o.orcamentototal, 0) - coalesce(o.valor_frete, 0), 0),
         coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
           + coalesce((SELECT sum(coalesce(os.subtotal, 0)) FROM public.osservico os WHERE os.ordemservicoid = o.id), 0),
         o.execucao_fim_em IS NOT NULL
    INTO v_total_os_sem_frete, v_total_itens, v_execucao_encerrada
    FROM public.ordemservico o WHERE o.id = p_ordemservicoid;

  -- Enquanto o servico nao foi entregue, quem manda e o cadastro de hoje: a
  -- taxa que vale e a do dia da entrega, nao a do dia da atribuicao.
  IF NOT v_execucao_encerrada THEN
    PERFORM public.recarimbar_comissao_osservico(p_ordemservicoid, p_servicoid);
  END IF;

  IF v_total_itens > 0 THEN v_fator := v_total_os_sem_frete / v_total_itens; END IF;
  v_base_liquida := round(v_subtotal * v_fator / v_qtd, 2);

  -- O maior percentual entre quem executou. Com um realizador so, e a taxa dele
  -- e nada muda em relacao ao comportamento anterior.
  SELECT coalesce(max(coalesce(r.comissao_percent_aplicada, 0)), 0)
    INTO v_percent_maior
    FROM public.osservico_realizador r
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;

  -- Servico que nao comissiona zera a taxa efetiva, e nao so o valor: assim a
  -- linha zerada no relatorio se explica sozinha.
  IF NOT coalesce(v_gera_comissao, true) THEN
    v_percent_maior := 0;
  END IF;

  UPDATE public.osservico_realizador r
     SET valor_base = v_base_liquida,
         comissao_percent_efetiva = v_percent_maior,
         valor_comissao = round(v_base_liquida * v_percent_maior / 100.0, 2),
         updated_at = now()
   WHERE r.ordemservicoid = p_ordemservicoid AND r.servicoid = p_servicoid;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) O congelamento: ultimo recarimbo no instante em que a execucao encerra
-- ---------------------------------------------------------------------------
--
-- Sem gatilho, uma OS onde ninguem mexeu depois do aumento entraria em
-- PAGAMENTO com o carimbo velho -- justamente o caso que esta migracao existe
-- para resolver.
--
-- O gatilho e AFTER UPDATE sem lista de colunas de proposito: `execucao_fim_em`
-- e escrito por `fn_os_execucao_set_times`, um BEFORE que age quando o UPDATE
-- menciona apenas `status`. Um `AFTER UPDATE OF execucao_fim_em` nunca
-- dispararia, porque a clausula OF olha o SET do comando, nao o que o BEFORE
-- mudou.
CREATE OR REPLACE FUNCTION public.tg_congelar_comissao_ao_encerrar_execucao()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF new.execucao_fim_em IS NOT NULL AND old.execucao_fim_em IS NULL THEN
    PERFORM public.recarimbar_comissao_osservico(new.id, NULL);
    PERFORM public.recalcular_comissao_osservico(new.id, s.servicoid)
      FROM public.osservico s WHERE s.ordemservicoid = new.id;
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.tg_congelar_comissao_ao_encerrar_execucao() IS
  'No instante em que a execucao encerra, traz a taxa do cadastro uma ultima vez e recalcula. Dali em diante o carimbo nao muda mais sozinho.';

DROP TRIGGER IF EXISTS trg_congelar_comissao_ao_encerrar_execucao ON public.ordemservico;
CREATE TRIGGER trg_congelar_comissao_ao_encerrar_execucao
  AFTER UPDATE ON public.ordemservico
  FOR EACH ROW EXECUTE FUNCTION public.tg_congelar_comissao_ao_encerrar_execucao();

-- ---------------------------------------------------------------------------
-- 4) Backfill: so o que ainda esta em execucao
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_item record;
  v_os integer := 0;
  v_linhas integer := 0;
BEGIN
  FOR v_item IN
    SELECT DISTINCT r.ordemservicoid, r.servicoid
      FROM public.osservico_realizador r
      JOIN public.ordemservico o ON o.id = r.ordemservicoid
     WHERE o.execucao_fim_em IS NULL
       AND coalesce(o.is_deleted, false) = false
       AND o.status::text NOT IN ('CANCELADO')
     ORDER BY r.ordemservicoid, r.servicoid
  LOOP
    PERFORM public.recalcular_comissao_osservico(v_item.ordemservicoid, v_item.servicoid);
    v_linhas := v_linhas + 1;
  END LOOP;

  SELECT count(DISTINCT o.id) INTO v_os
    FROM public.ordemservico o
    JOIN public.osservico_realizador r ON r.ordemservicoid = o.id
   WHERE o.execucao_fim_em IS NULL
     AND coalesce(o.is_deleted, false) = false
     AND o.status::text NOT IN ('CANCELADO');

  RAISE NOTICE 'Comissao recarimbada em % servico(s) de % OS ainda em execucao.', v_linhas, v_os;
END
$backfill$;

COMMIT;
