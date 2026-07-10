ALTER TABLE public.fiscal_dfe_controle
  ADD COLUMN IF NOT EXISTS next_sync_after timestamp with time zone;

CREATE OR REPLACE FUNCTION public.fiscal_salvar_dfe_lote(
  p_empresa_id integer,
  p_docs jsonb,
  p_ult_nsu text,
  p_max_nsu text,
  p_cstat text,
  p_xmotivo text,
  p_next_sync_after timestamp with time zone DEFAULT NULL,
  p_consumo_indevido_until timestamp with time zone DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_doc jsonb;
  v_existing_id bigint;
  v_inserted integer := 0;
  v_chave text;
  v_schema text;
  v_nsu text;
BEGIN
  FOR v_doc IN SELECT * FROM jsonb_array_elements(coalesce(p_docs, '[]'::jsonb))
  LOOP
    v_nsu := nullif(v_doc->>'nsu', '');
    v_schema := nullif(v_doc->>'schema', '');
    v_chave := nullif(v_doc->>'chave_acesso', '');
    v_existing_id := NULL;

    IF v_nsu IS NULL OR v_schema IS NULL THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_existing_id
    FROM public.fiscal_dfe_documento
    WHERE empresa_id = p_empresa_id
      AND nsu = v_nsu
    LIMIT 1;

    IF v_existing_id IS NULL AND v_chave IS NOT NULL THEN
      SELECT id INTO v_existing_id
      FROM public.fiscal_dfe_documento
      WHERE empresa_id = p_empresa_id
        AND chave_acesso = v_chave
        AND schema = v_schema
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.fiscal_dfe_documento (
        empresa_id,
        nsu,
        schema,
        tipo_documento,
        chave_acesso,
        data_emissao,
        emitente_nome,
        emitente_cnpj,
        valor_total,
        status,
        status_manifestacao,
        xml,
        resumo,
        updatedat
      )
      VALUES (
        p_empresa_id,
        v_nsu,
        v_schema,
        coalesce(v_doc->>'tipo_documento', 'OUTRO'),
        v_chave,
        nullif(v_doc->>'data_emissao', '')::timestamp with time zone,
        nullif(v_doc->>'emitente_nome', ''),
        nullif(v_doc->>'emitente_cnpj', ''),
        nullif(v_doc->>'valor_total', '')::numeric,
        nullif(v_doc->>'status', ''),
        nullif(v_doc->>'status_manifestacao', ''),
        coalesce(v_doc->>'xml', ''),
        coalesce(v_doc->'resumo', '{}'::jsonb),
        now()
      );
      v_inserted := v_inserted + 1;
    ELSE
      UPDATE public.fiscal_dfe_documento
      SET
        schema = v_schema,
        tipo_documento = coalesce(v_doc->>'tipo_documento', tipo_documento),
        chave_acesso = coalesce(v_chave, chave_acesso),
        data_emissao = coalesce(nullif(v_doc->>'data_emissao', '')::timestamp with time zone, data_emissao),
        emitente_nome = coalesce(nullif(v_doc->>'emitente_nome', ''), emitente_nome),
        emitente_cnpj = coalesce(nullif(v_doc->>'emitente_cnpj', ''), emitente_cnpj),
        valor_total = coalesce(nullif(v_doc->>'valor_total', '')::numeric, valor_total),
        status = coalesce(nullif(v_doc->>'status', ''), status),
        status_manifestacao = coalesce(nullif(v_doc->>'status_manifestacao', ''), status_manifestacao),
        xml = coalesce(nullif(v_doc->>'xml', ''), xml),
        resumo = coalesce(v_doc->'resumo', resumo),
        updatedat = now()
      WHERE id = v_existing_id;
    END IF;
  END LOOP;

  INSERT INTO public.fiscal_dfe_controle (
    empresa_id,
    ult_nsu,
    max_nsu,
    last_cstat,
    last_xmotivo,
    last_sync_at,
    next_sync_after,
    consumo_indevido_until,
    updatedat
  )
  VALUES (
    p_empresa_id,
    p_ult_nsu,
    p_max_nsu,
    p_cstat,
    p_xmotivo,
    now(),
    p_next_sync_after,
    p_consumo_indevido_until,
    now()
  )
  ON CONFLICT (empresa_id)
  DO UPDATE SET
    ult_nsu = EXCLUDED.ult_nsu,
    max_nsu = EXCLUDED.max_nsu,
    last_cstat = EXCLUDED.last_cstat,
    last_xmotivo = EXCLUDED.last_xmotivo,
    last_sync_at = now(),
    next_sync_after = EXCLUDED.next_sync_after,
    consumo_indevido_until = EXCLUDED.consumo_indevido_until,
    updatedat = now();

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fiscal_salvar_dfe_lote(
  integer,
  jsonb,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  timestamp with time zone
) TO anon;
GRANT EXECUTE ON FUNCTION public.fiscal_salvar_dfe_lote(
  integer,
  jsonb,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  timestamp with time zone
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_salvar_dfe_lote(
  integer,
  jsonb,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  timestamp with time zone
) TO service_role;
