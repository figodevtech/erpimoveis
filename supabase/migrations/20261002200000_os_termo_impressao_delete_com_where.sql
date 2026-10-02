BEGIN;

-- Chamada pela API, `salvar_os_termos_impressao` falhava com "DELETE requires a
-- WHERE clause" (SQLSTATE 21000): o Supabase carrega o pg_safeupdate nas
-- sessões do PostgREST, e ele barra DELETE sem WHERE até dentro de função.
-- O teste SQL não pegou porque roda como postgres, fora do PostgREST.
-- O `WHERE true` só existe para satisfazer a extensão; a lista inteira
-- continua sendo trocada numa transação só.
CREATE OR REPLACE FUNCTION public.salvar_os_termos_impressao(p_termos jsonb)
RETURNS SETOF public.os_termo_impressao
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF p_termos IS NULL OR jsonb_typeof(p_termos) <> 'array' THEN
    RAISE EXCEPTION 'Os dizeres devem vir como uma lista.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.os_termo_impressao WHERE true;

  RETURN QUERY
  WITH inseridos AS (
    INSERT INTO public.os_termo_impressao (titulo, intro, itens, status, alvos, ordem)
    SELECT
      btrim(termo->>'titulo'),
      coalesce(btrim(termo->>'intro'), ''),
      CASE WHEN jsonb_typeof(termo->'itens') = 'array' THEN termo->'itens' ELSE '[]'::jsonb END,
      ARRAY(SELECT jsonb_array_elements_text(termo->'status'))::public.enum_status_os[],
      ARRAY(SELECT jsonb_array_elements_text(termo->'alvos')),
      (posicao - 1) * 10
    FROM jsonb_array_elements(p_termos) WITH ORDINALITY AS entrada(termo, posicao)
    RETURNING *
  )
  SELECT * FROM inseridos ORDER BY ordem, id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.salvar_os_termos_impressao(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_os_termos_impressao(jsonb) TO service_role;

COMMIT;
