CREATE TEMP TABLE tmp_fiscal_dfe_merge AS
WITH grupos AS (
  SELECT empresa_id, chave_acesso, min(id) AS keep_id
  FROM public.fiscal_dfe_documento
  WHERE chave_acesso IS NOT NULL
    AND (schema LIKE 'resNFe%' OR schema LIKE 'procNFe%')
  GROUP BY empresa_id, chave_acesso
  HAVING count(*) > 1
),
proc AS (
  SELECT DISTINCT ON (d.empresa_id, d.chave_acesso) d.*
  FROM public.fiscal_dfe_documento d
  JOIN grupos g
    ON g.empresa_id = d.empresa_id
   AND g.chave_acesso = d.chave_acesso
  WHERE d.schema LIKE 'procNFe%'
  ORDER BY d.empresa_id, d.chave_acesso, d.createdat DESC NULLS LAST, d.id DESC
)
SELECT d.*, p.id AS proc_id, p.nsu AS proc_nsu, p.schema AS proc_schema,
  p.tipo_documento AS proc_tipo_documento, p.data_emissao AS proc_data_emissao,
  p.emitente_nome AS proc_emitente_nome, p.emitente_cnpj AS proc_emitente_cnpj,
  p.valor_total AS proc_valor_total, p.status AS proc_status,
  p.status_manifestacao AS proc_status_manifestacao, p.xml AS proc_xml,
  p.resumo AS proc_resumo
FROM public.fiscal_dfe_documento d
JOIN grupos g ON g.keep_id = d.id
LEFT JOIN proc p
  ON p.empresa_id = d.empresa_id
 AND p.chave_acesso = d.chave_acesso;

DELETE FROM public.fiscal_dfe_documento d
USING tmp_fiscal_dfe_merge k
WHERE d.empresa_id = k.empresa_id
  AND d.chave_acesso = k.chave_acesso
  AND d.id <> k.id
  AND (d.schema LIKE 'resNFe%' OR d.schema LIKE 'procNFe%');

UPDATE public.fiscal_dfe_documento d
SET
  schema = coalesce(k.proc_schema, d.schema),
  tipo_documento = coalesce(k.proc_tipo_documento, d.tipo_documento),
  data_emissao = coalesce(k.proc_data_emissao, d.data_emissao),
  emitente_nome = coalesce(k.proc_emitente_nome, d.emitente_nome),
  emitente_cnpj = coalesce(k.proc_emitente_cnpj, d.emitente_cnpj),
  valor_total = coalesce(k.proc_valor_total, d.valor_total),
  status = coalesce(k.proc_status, d.status),
  status_manifestacao = coalesce(d.status_manifestacao, k.proc_status_manifestacao),
  xml = coalesce(nullif(k.proc_xml, ''), d.xml),
  resumo = jsonb_strip_nulls(
    coalesce(d.resumo, '{}'::jsonb) ||
    coalesce(k.proc_resumo, '{}'::jsonb) ||
    jsonb_build_object(
      'nsuResumo', d.nsu,
      'nsuProcNFe', k.proc_nsu,
      'xmlCompletoConsulta', jsonb_build_object(
        'disponivel', k.proc_id IS NOT NULL,
        'consultadoEm', now()
      )
    )
  ),
  updatedat = now()
FROM tmp_fiscal_dfe_merge k
WHERE d.id = k.id;

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
  v_existing_schema text;
  v_inserted integer := 0;
  v_chave text;
  v_schema text;
  v_nsu text;
  v_is_nfe boolean;
  v_should_keep_proc boolean;
BEGIN
  FOR v_doc IN SELECT * FROM jsonb_array_elements(coalesce(p_docs, '[]'::jsonb))
  LOOP
    v_nsu := nullif(v_doc->>'nsu', '');
    v_schema := nullif(v_doc->>'schema', '');
    v_chave := nullif(v_doc->>'chave_acesso', '');
    v_existing_id := NULL;
    v_existing_schema := NULL;
    v_is_nfe := v_schema LIKE 'resNFe%' OR v_schema LIKE 'procNFe%';

    IF v_nsu IS NULL OR v_schema IS NULL THEN
      CONTINUE;
    END IF;

    IF v_is_nfe AND v_chave IS NOT NULL THEN
      SELECT id, schema INTO v_existing_id, v_existing_schema
      FROM public.fiscal_dfe_documento
      WHERE empresa_id = p_empresa_id
        AND chave_acesso = v_chave
        AND (schema LIKE 'resNFe%' OR schema LIKE 'procNFe%')
      ORDER BY createdat ASC NULLS LAST, id ASC
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL THEN
      SELECT id, schema INTO v_existing_id, v_existing_schema
      FROM public.fiscal_dfe_documento
      WHERE empresa_id = p_empresa_id
        AND nsu = v_nsu
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL AND v_chave IS NOT NULL THEN
      SELECT id, schema INTO v_existing_id, v_existing_schema
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
        jsonb_strip_nulls(
          coalesce(v_doc->'resumo', '{}'::jsonb) ||
          CASE
            WHEN v_is_nfe THEN jsonb_build_object(
              'nsuResumo', CASE WHEN v_schema LIKE 'resNFe%' THEN v_nsu ELSE NULL END,
              'nsuProcNFe', CASE WHEN v_schema LIKE 'procNFe%' THEN v_nsu ELSE NULL END
            )
            ELSE '{}'::jsonb
          END
        ),
        now()
      );
      v_inserted := v_inserted + 1;
    ELSE
      IF v_is_nfe AND v_chave IS NOT NULL THEN
        DELETE FROM public.fiscal_dfe_documento
        WHERE empresa_id = p_empresa_id
          AND chave_acesso = v_chave
          AND id <> v_existing_id
          AND (schema LIKE 'resNFe%' OR schema LIKE 'procNFe%');
      END IF;

      v_should_keep_proc := v_is_nfe
        AND v_existing_schema LIKE 'procNFe%'
        AND v_schema LIKE 'resNFe%';

      UPDATE public.fiscal_dfe_documento
      SET
        schema = CASE WHEN v_should_keep_proc THEN schema ELSE v_schema END,
        tipo_documento = CASE
          WHEN v_should_keep_proc THEN tipo_documento
          ELSE coalesce(v_doc->>'tipo_documento', tipo_documento)
        END,
        chave_acesso = coalesce(v_chave, chave_acesso),
        data_emissao = coalesce(nullif(v_doc->>'data_emissao', '')::timestamp with time zone, data_emissao),
        emitente_nome = coalesce(nullif(v_doc->>'emitente_nome', ''), emitente_nome),
        emitente_cnpj = coalesce(nullif(v_doc->>'emitente_cnpj', ''), emitente_cnpj),
        valor_total = coalesce(nullif(v_doc->>'valor_total', '')::numeric, valor_total),
        status = coalesce(nullif(v_doc->>'status', ''), status),
        status_manifestacao = coalesce(status_manifestacao, nullif(v_doc->>'status_manifestacao', '')),
        xml = CASE
          WHEN v_should_keep_proc THEN xml
          ELSE coalesce(nullif(v_doc->>'xml', ''), xml)
        END,
        resumo = CASE
          WHEN v_is_nfe THEN jsonb_strip_nulls(
            coalesce(resumo, '{}'::jsonb) ||
            CASE WHEN v_should_keep_proc THEN '{}'::jsonb ELSE coalesce(v_doc->'resumo', '{}'::jsonb) END ||
            jsonb_build_object(
              'nsuResumo', CASE
                WHEN v_schema LIKE 'resNFe%' THEN coalesce(resumo->>'nsuResumo', v_nsu)
                ELSE resumo->>'nsuResumo'
              END,
              'nsuProcNFe', CASE
                WHEN v_schema LIKE 'procNFe%' THEN v_nsu
                ELSE resumo->>'nsuProcNFe'
              END,
              'xmlCompletoConsulta', CASE
                WHEN v_schema LIKE 'procNFe%' THEN jsonb_build_object('disponivel', true, 'consultadoEm', now())
                ELSE resumo->'xmlCompletoConsulta'
              END
            )
          )
          ELSE coalesce(v_doc->'resumo', resumo)
        END,
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
