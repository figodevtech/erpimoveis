CREATE OR REPLACE FUNCTION public.nfe_alocar_numero(p_config_id bigint)
RETURNS TABLE (
  numero integer,
  serie integer,
  empresaid bigint,
  modelo public.enum_modelo_nfe,
  ambiente public.enum_ambiente_nfe
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_config public.nfe_config%ROWTYPE;
BEGIN
  SELECT *
    INTO v_config
    FROM public.nfe_config
   WHERE id = p_config_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração de NF-e % não encontrada.', p_config_id;
  END IF;

  UPDATE public.nfe_config
     SET ultimo_numero = COALESCE(ultimo_numero, 0) + 1,
         updatedat = now()
   WHERE id = p_config_id
   RETURNING ultimo_numero, nfe_config.serie, nfe_config.empresaid, nfe_config.modelo, nfe_config.ambiente
    INTO numero, serie, empresaid, modelo, ambiente;

  RETURN NEXT;
END;
$$;
