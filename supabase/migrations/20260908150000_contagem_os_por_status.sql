-- Os contadores das abas de OS perguntavam "quantas em cada status?" com um
-- COUNT(*) por status: onze requisicoes HEAD disparadas juntas, onze varreduras
-- da mesma tabela para responder a uma pergunta so. Nos logs de 08/09 elas
-- aparecem no meio da fila que estourou o statement_timeout. Uma passada
-- agrupada responde tudo de uma vez.
--
-- Sem filtro de exclusao logica de proposito: a listagem de OS tambem nao tem,
-- e contador que nao bate com a lista e pior que contador lento.
--
-- Sem indice novo: `idx_os_status` ja cobre ordemservico(status) desde o
-- baseline.

-- As colunas de saida nao se chamam `status` para nao sombrear a coluna da
-- tabela dentro do corpo da funcao.
CREATE OR REPLACE FUNCTION public.ordens_contagem_por_status()
RETURNS TABLE (status_os text, total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.status::text, count(*)::bigint
    FROM public.ordemservico o
   GROUP BY o.status;
$function$;

GRANT EXECUTE ON FUNCTION public.ordens_contagem_por_status() TO service_role;
