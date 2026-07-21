UPDATE public.fiscal_dfe_controle
SET next_sync_after = NULL,
    updatedat = now()
WHERE next_sync_after IS NOT NULL;

UPDATE public.fiscal_dfe_contexto
SET next_sync_after = NULL,
    updatedat = now()
WHERE next_sync_after IS NOT NULL;

DROP FUNCTION IF EXISTS public.fiscal_reservar_consulta_chave_dfe(integer, integer, interval);
