-- DRE — agregacao por linha, no banco.
--
-- A soma dos eventos por linha resolve duas formas de vinculo:
--   1. `eventos_financeiros.dre_linha_id`, preenchido nos lancamentos vindos de
--      transacao, onde a linha depende do plano de contas;
--   2. `dre_mapeamento` por origem de evento (`SERVICO:RECEITA`,
--      `COMISSAO:DESPESA`, `DESCONTO:DESPESA`...), usado pelos lancamentos de OS
--      e venda, cuja natureza ja e conhecida.
--
-- O vinculo direto tem precedencia: se alguem reclassificar um lancamento
-- especifico, essa decisao vence a regra geral da origem.
--
-- Feito no banco, e nao na aplicacao, para evitar trazer todos os lancamentos do
-- periodo so para soma-los — e para que o drill-down use exatamente o mesmo
-- criterio da linha, garantindo que os dois totais batam.
BEGIN;

CREATE OR REPLACE FUNCTION public.dre_somar_por_linha(
  p_template_id integer,
  p_de timestamptz,
  p_ate timestamptz
)
RETURNS TABLE (linha_id integer, valor numeric, lancamentos bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.linha_id,
         round(sum(l.valor), 2) AS valor,
         count(*)::bigint       AS lancamentos
    FROM (
      SELECT coalesce(
               e.dre_linha_id,
               (SELECT mp.linha_id
                  FROM public.dre_mapeamento mp
                 WHERE mp.template_id = p_template_id
                   AND mp.ativo
                   AND mp.origem_tipo = 'EVENTO_ORIGEM'
                   AND mp.origem_valor = e.origem || ':' || e.natureza
                   AND (mp.vigencia_inicio IS NULL OR e.competencia_em >= mp.vigencia_inicio)
                   AND (mp.vigencia_fim IS NULL OR e.competencia_em <= mp.vigencia_fim)
                 LIMIT 1)
             ) AS linha_id,
             e.valor
        FROM public.eventos_financeiros e
       WHERE e.status = 'ATIVO'
         AND e.competencia_em IS NOT NULL
         AND e.competencia_em >= p_de
         AND e.competencia_em <= p_ate
    ) l
   WHERE l.linha_id IS NOT NULL
   GROUP BY l.linha_id;
$function$;

COMMENT ON FUNCTION public.dre_somar_por_linha(integer, timestamptz, timestamptz) IS
  'Soma os lancamentos ativos por linha da DRE no periodo. Usada pelo relatorio e pelo drill-down, para que os totais nunca divirjam.';

COMMIT;
