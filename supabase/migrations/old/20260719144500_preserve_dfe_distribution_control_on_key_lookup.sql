CREATE OR REPLACE FUNCTION public.fiscal_salvar_dfe_consulta_pontual(
  p_empresa_id integer,
  p_docs jsonb,
  p_cstat text,
  p_xmotivo text,
  p_consumo_indevido_until timestamp with time zone DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_controle public.fiscal_dfe_controle%ROWTYPE;
  v_inseridos integer := 0;
BEGIN
  SELECT * INTO v_controle
  FROM public.fiscal_dfe_controle
  WHERE empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Controle DF-e nao encontrado para a empresa %.', p_empresa_id;
  END IF;

  v_inseridos := public.fiscal_salvar_dfe_lote(
    p_empresa_id,
    p_docs,
    v_controle.ult_nsu,
    v_controle.max_nsu,
    p_cstat,
    p_xmotivo,
    v_controle.next_sync_after,
    CASE
      WHEN p_cstat = '656' THEN p_consumo_indevido_until
      ELSE v_controle.consumo_indevido_until
    END
  );

  -- A consulta consChNFe nao faz parte da sequencia distNSU. Preserva o
  -- cursor, o horario da distribuicao e seu cooldown. Somente um novo 656
  -- pode atualizar o bloqueio global do CNPJ.
  UPDATE public.fiscal_dfe_controle
  SET
    ult_nsu = v_controle.ult_nsu,
    max_nsu = v_controle.max_nsu,
    last_sync_at = v_controle.last_sync_at,
    last_cstat = CASE WHEN p_cstat = '656' THEN p_cstat ELSE v_controle.last_cstat END,
    last_xmotivo = CASE WHEN p_cstat = '656' THEN p_xmotivo ELSE v_controle.last_xmotivo END,
    next_sync_after = v_controle.next_sync_after,
    consumo_indevido_until = CASE
      WHEN p_cstat = '656' THEN p_consumo_indevido_until
      ELSE v_controle.consumo_indevido_until
    END,
    updatedat = now()
  WHERE empresa_id = p_empresa_id;

  RETURN v_inseridos;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fiscal_salvar_dfe_consulta_pontual(
  integer,
  jsonb,
  text,
  text,
  timestamp with time zone
) TO service_role;
