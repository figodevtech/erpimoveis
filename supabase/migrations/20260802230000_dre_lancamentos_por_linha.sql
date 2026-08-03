-- DRE — lancamentos que compoem uma linha (drill-down).
--
-- A resolucao da linha e identica a de `dre_somar_por_linha`: `dre_linha_id`
-- direto, com fallback no mapeamento por origem de evento. Escrever a regra duas
-- vezes seria a forma mais provavel de o drill-down deixar de bater com o total
-- — que e justamente o que ele existe para provar.
--
-- Recebe um array de linhas para que o drill-down de uma linha-mae possa incluir
-- toda a subarvore: quem clica em "CUSTOS" espera ver os lancamentos de 4.1 a
-- 4.7, nao uma lista vazia.
BEGIN;

CREATE OR REPLACE FUNCTION public.dre_lancamentos_por_linha(
  p_template_id integer,
  p_linha_ids integer[],
  p_de timestamptz,
  p_ate timestamptz
)
RETURNS TABLE (
  id bigint,
  linha_id integer,
  competencia_em timestamptz,
  origem text,
  natureza text,
  natureza_dre text,
  descricao text,
  detalhe text,
  valor numeric,
  source_type text,
  source_id bigint,
  ordemservicoid integer,
  transacaoid bigint,
  is_manual boolean,
  estorno_de_id bigint,
  sem_custo boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.id, l.linha_id, l.competencia_em, l.origem, l.natureza, l.natureza_dre,
         l.descricao, l.detalhe, l.valor, l.source_type, l.source_id,
         l.ordemservicoid, l.transacaoid, l.is_manual, l.estorno_de_id,
         coalesce((l.dados_snapshot ->> 'custo_nao_informado')::boolean, false) AS sem_custo
    FROM (
      SELECT e.*,
             coalesce(
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
             ) AS linha_id
        FROM public.eventos_financeiros e
       WHERE e.status = 'ATIVO'
         AND e.competencia_em IS NOT NULL
         AND e.competencia_em >= p_de
         AND e.competencia_em <= p_ate
    ) l
   WHERE l.linha_id = ANY (p_linha_ids)
   ORDER BY l.competencia_em DESC, l.id DESC;
$function$;

COMMENT ON FUNCTION public.dre_lancamentos_por_linha(integer, integer[], timestamptz, timestamptz) IS
  'Lancamentos que compoem uma ou mais linhas da DRE. Usa a mesma resolucao de linha de dre_somar_por_linha, para que o total do drill-down seja identico ao da linha.';

COMMIT;
