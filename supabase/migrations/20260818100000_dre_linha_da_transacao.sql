-- Badge "DRE" no dialog de transacao: em qual linha este lancamento cai.
--
-- O DESAFIO
-- Uma transacao pode tocar a DRE de duas formas diferentes:
--
--   1. Ela E o fato economico (avulsa) — o evento nasce com source_type =
--      'TRANSACAO', source_id = id, e ja carrega dre_linha_id gravado por
--      `sincronizar_eventos_financeiros_transacao` (PLANO_GRUPO).
--
--   2. Ela E A BAIXA de um fato ja reconhecido em OS/venda (comissao, frete,
--      servico, produto) — o evento tem outro source_type, `transacaoid`
--      aponta para esta transacao, e o `dre_linha_id` do evento costuma estar
--      NULL: a linha so existe resolvida em tempo de consulta, via
--      dre_mapeamento (EVENTO_ORIGEM), igual `dre_somar_por_linha` ja faz.
--
-- Duplicar essa segunda resolucao em JS divergiria do relatorio assim que
-- alguem mudasse o mapeamento. Esta funcao reusa a mesma logica, so que
-- filtrada por transacao em vez de por periodo — e por isso fica ao lado das
-- outras dre_* como funcao, nao como consulta solta na rota.
--
-- Uma transacao pode gerar mais de uma linha (baixa de OS com produto e
-- servico juntos, por exemplo): a funcao devolve uma linha por grupo,
-- somando o valor. A tela decide o que fazer com mais de uma.
BEGIN;

CREATE OR REPLACE FUNCTION public.dre_linha_da_transacao(p_transacaoid bigint)
RETURNS TABLE (linha_id integer, codigo text, nome text, valor numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH template_ativo AS (
    SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC, id DESC LIMIT 1
  ),
  eventos AS (
    SELECT e.valor, e.dre_linha_id, e.origem, e.natureza, e.competencia_em
      FROM public.eventos_financeiros e
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND (
             (e.source_type = 'TRANSACAO' AND e.source_id = p_transacaoid)
          OR e.transacaoid = p_transacaoid
       )
  ),
  resolvidos AS (
    SELECT ev.valor,
           coalesce(
             ev.dre_linha_id,
             (SELECT mp.linha_id
                FROM public.dre_mapeamento mp, template_ativo t
               WHERE mp.template_id = t.id
                 AND mp.ativo
                 AND mp.origem_tipo = 'EVENTO_ORIGEM'
                 AND mp.origem_valor = ev.origem || ':' || ev.natureza
                 AND (mp.vigencia_inicio IS NULL OR ev.competencia_em >= mp.vigencia_inicio)
                 AND (mp.vigencia_fim IS NULL OR ev.competencia_em <= mp.vigencia_fim)
               LIMIT 1)
           ) AS linha_id
      FROM eventos ev
  )
  SELECT dl.id AS linha_id, dl.codigo, dl.nome, round(sum(r.valor), 2) AS valor
    FROM resolvidos r
    JOIN public.dre_linha dl ON dl.id = r.linha_id
   WHERE r.linha_id IS NOT NULL
   GROUP BY dl.id, dl.codigo, dl.nome
   ORDER BY dl.codigo;
$function$;

COMMENT ON FUNCTION public.dre_linha_da_transacao(bigint) IS
  'Em qual(is) linha(s) da DRE uma transacao aparece — direto (e o fato) ou como baixa de evento de OS/venda. Mesma resolucao de dre_somar_por_linha, filtrada por transacao. Usada pelo badge "DRE" do dialog de edicao.';

COMMIT;
