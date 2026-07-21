ALTER TABLE public.fiscal_dfe_controle
  ADD COLUMN IF NOT EXISTS cnpj_consultado text;

UPDATE public.fiscal_dfe_controle AS controle
SET cnpj_consultado = regexp_replace(coalesce(empresa.cnpj, ''), '\D', '', 'g'),
    updatedat = now()
FROM public.empresa AS empresa
WHERE empresa.id = controle.empresa_id
  AND nullif(btrim(controle.cnpj_consultado), '') IS NULL;

CREATE OR REPLACE FUNCTION public.fiscal_reset_dfe_por_troca_cnpj(
  p_empresa_id integer,
  p_cnpj text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
BEGIN
  IF length(v_cnpj) <> 14 THEN
    RAISE EXCEPTION 'CNPJ inválido para reinicialização do DF-e.';
  END IF;

  DELETE FROM public.fiscal_dfe_documento
  WHERE empresa_id = p_empresa_id;

  INSERT INTO public.fiscal_dfe_controle (
    empresa_id,
    cnpj_consultado,
    ult_nsu,
    max_nsu,
    last_sync_at,
    last_cstat,
    last_xmotivo,
    next_sync_after,
    consumo_indevido_until,
    sync_lock_until,
    sync_started_at,
    updatedat
  )
  VALUES (
    p_empresa_id,
    v_cnpj,
    '000000000000000',
    '000000000000000',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (empresa_id)
  DO UPDATE SET
    cnpj_consultado = EXCLUDED.cnpj_consultado,
    ult_nsu = EXCLUDED.ult_nsu,
    max_nsu = EXCLUDED.max_nsu,
    last_sync_at = NULL,
    last_cstat = NULL,
    last_xmotivo = NULL,
    next_sync_after = NULL,
    consumo_indevido_until = NULL,
    sync_lock_until = NULL,
    sync_started_at = NULL,
    updatedat = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.fiscal_reset_dfe_por_troca_cnpj(integer, text)
  TO service_role;
