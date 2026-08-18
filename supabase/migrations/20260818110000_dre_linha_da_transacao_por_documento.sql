-- O badge "DRE" tambem no lancamento que so LIQUIDA documento.
--
-- A 20260818100000 so respondia quando a transacao era o proprio fato
-- economico. Pagamento de OS ou venda devolvia vazio — tecnicamente certo
-- (aquele dinheiro nao e receita nova; a receita foi reconhecida na entrega),
-- mas na tela virava silencio, e silencio nao explica nada.
--
-- O caso que expos isso: uma transacao de R$ 8.500 que baixou tres OS de uma
-- vez. Na DRE nao existe nenhum lancamento de R$ 8.500 — existem a receita, o
-- custo e a comissao de cada uma das tres OS, em competencias que podem nem ser
-- a data do pagamento. Quem abre a transacao precisa conseguir ver isso.
--
-- Por isso a funcao passa a devolver o PAPEL de cada linha:
--
--   DIRETO     a transacao e o fato. Lancamento avulso classificado no plano de
--              contas, ou despesa de OS/venda (comissao, despesa de servico)
--              que virou transacao — o evento fica CONVERTIDO apontando para
--              ela. O valor da transacao e o valor na DRE.
--
--   DOCUMENTO  a transacao e a baixa de um documento. O que entra na DRE sao os
--              lancamentos do documento, um por linha, com o valor DELE — nao o
--              da transacao, e nao necessariamente somando o valor dela: uma
--              parcela paga parte de uma OS cuja receita ja entrou inteira.
--
-- Um mesmo evento nunca aparece nos dois papeis: o ramo DOCUMENTO descarta o
-- que ja veio por `transacaoid`, senao a comissao de uma OS apareceria duas
-- vezes na transacao que a pagou.
BEGIN;

DROP FUNCTION IF EXISTS public.dre_linha_da_transacao(bigint);

CREATE FUNCTION public.dre_linha_da_transacao(p_transacaoid bigint)
RETURNS TABLE (
  papel          text,
  documento_tipo text,
  documento_id   bigint,
  linha_id       integer,
  codigo         text,
  nome           text,
  natureza_dre   text,
  valor          numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH template_ativo AS (
    SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC, id DESC LIMIT 1
  ),
  tx AS (
    SELECT * FROM public.transacao WHERE id = p_transacaoid
  ),
  -- Documentos que esta transacao LIQUIDA. Pagamento multiplo cobre varios (o
  -- rateio diz quais); pagamento comum cobre um; avulso nao cobre nenhum.
  --
  -- `evento_financeiro_id IS NULL` e o que separa liquidar de materializar.
  -- Uma despesa da OS — servico terceirizado, comissao — vira transacao com
  -- `ordemservicoid` preenchido, mas ela nao paga a OS: ela E aquela despesa, e
  -- aponta para o evento que virou. Sem este filtro, abrir os R$ 200 de um
  -- terceirizado mostraria tambem a receita inteira da OS, como se aquele
  -- pagamento a tivesse quitado. O papel dela e DIRETO, so.
  documentos AS (
    SELECT 'OS'::text AS tipo, t.ordemservicoid::bigint AS id
      FROM tx t WHERE t.ordemservicoid IS NOT NULL AND t.evento_financeiro_id IS NULL
    UNION
    SELECT 'VENDA'::text, t.vendaid::bigint
      FROM tx t WHERE t.vendaid IS NOT NULL AND t.evento_financeiro_id IS NULL
    UNION
    SELECT r.tipo_documento::text, r.documento_id::bigint
      FROM public.pagamento_multiplo_rateio r
     WHERE r.transacao_id = p_transacaoid
  ),
  eventos AS (
    SELECT 'DIRETO'::text AS papel, NULL::text AS doc_tipo, NULL::bigint AS doc_id,
           e.valor, e.dre_linha_id, e.origem, e.natureza, e.competencia_em
      FROM public.eventos_financeiros e
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       AND ((e.source_type = 'TRANSACAO' AND e.source_id = p_transacaoid)
            OR e.transacaoid = p_transacaoid)
    UNION ALL
    SELECT 'DOCUMENTO'::text, d.tipo, d.id,
           e.valor, e.dre_linha_id, e.origem, e.natureza, e.competencia_em
      FROM documentos d
      JOIN public.eventos_financeiros e
        -- OS tem DOIS vinculos possiveis. `ordemservicoid` e a coluna original,
        -- de quando o livro so servia a OS; `source_type`/`source_id` vieram na
        -- 20260802160000, que generalizou a tabela mas nao fez backfill das
        -- linhas antigas. No Demir isso e a maioria: 225 dos 377 eventos de OS
        -- tem `source_type` nulo. Casar so pelo par novo perderia todos eles —
        -- e a OS apareceria como se nao tivesse lancamento nenhum.
        -- Venda nasceu depois da generalizacao e nao tem esse legado.
        ON (d.tipo = 'OS'    AND (e.ordemservicoid = d.id
                                  OR (e.source_type = 'ORDEM_SERVICO' AND e.source_id = d.id)))
        OR (d.tipo = 'VENDA' AND e.source_type = 'VENDA' AND e.source_id = d.id)
     WHERE e.status IN ('ATIVO', 'CONVERTIDO')
       -- Ja contado como DIRETO: e a despesa que esta propria transacao pagou.
       AND e.transacaoid IS DISTINCT FROM p_transacaoid
  ),
  resolvidos AS (
    SELECT ev.papel, ev.doc_tipo, ev.doc_id, ev.valor,
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
  SELECT r.papel, r.doc_tipo, r.doc_id, dl.id, dl.codigo, dl.nome, dl.natureza_dre,
         round(sum(r.valor), 2) AS valor
    FROM resolvidos r
    JOIN public.dre_linha dl ON dl.id = r.linha_id
   GROUP BY r.papel, r.doc_tipo, r.doc_id, dl.id, dl.codigo, dl.nome, dl.natureza_dre
   ORDER BY r.doc_id NULLS FIRST, dl.codigo;
$function$;

COMMENT ON FUNCTION public.dre_linha_da_transacao(bigint) IS
  'Como uma transacao aparece na DRE. papel=DIRETO: ela e o fato, e o valor dela e o valor na linha. papel=DOCUMENTO: ela apenas liquida OS/venda, e o que entra na DRE sao os lancamentos do documento, com o valor deles. Mesma resolucao de linha que dre_somar_por_linha. Usada pelo badge "DRE" do dialog de transacao.';

COMMIT;
