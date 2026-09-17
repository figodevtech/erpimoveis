BEGIN;

CREATE OR REPLACE FUNCTION public.fiscal_sped_importar_efd_anterior(
  p_competencia_id bigint,
  p_competencia_arquivo date,
  p_nome_arquivo text,
  p_storage_path text,
  p_arquivo_sha256 text,
  p_cabecalho jsonb,
  p_saldos_apuracao jsonb,
  p_usuario_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competencia public.fiscal_sped_competencia%ROWTYPE;
  v_id bigint;
BEGIN
  SELECT * INTO v_competencia
    FROM public.fiscal_sped_competencia
   WHERE id = p_competencia_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competencia SPED nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_competencia.status = 'FECHADA' THEN
    RAISE EXCEPTION 'Competencia SPED fechada nao aceita importacao.' USING ERRCODE = '55000';
  END IF;
  IF p_competencia_arquivo <> (v_competencia.competencia - interval '1 month')::date THEN
    RAISE EXCEPTION 'A EFD importada deve ser da competencia imediatamente anterior.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id
    FROM public.fiscal_sped_efd_anterior_importacao
   WHERE competencia_id = p_competencia_id
     AND arquivo_sha256 = p_arquivo_sha256;
  IF FOUND THEN RETURN v_id; END IF;

  UPDATE public.fiscal_sped_efd_anterior_importacao
     SET status = 'REJEITADA'
   WHERE competencia_id = p_competencia_id
     AND status = 'VALIDADA';

  INSERT INTO public.fiscal_sped_efd_anterior_importacao(
    competencia_id, competencia_arquivo, nome_arquivo, storage_path,
    arquivo_sha256, status, cabecalho, saldos_apuracao, imported_by
  ) VALUES (
    p_competencia_id, p_competencia_arquivo, p_nome_arquivo, p_storage_path,
    p_arquivo_sha256, 'VALIDADA', coalesce(p_cabecalho, '{}'::jsonb),
    coalesce(p_saldos_apuracao, '{}'::jsonb), p_usuario_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_importar_1601(
  p_competencia_id bigint,
  p_nome_arquivo text,
  p_storage_path text,
  p_arquivo_sha256 text,
  p_linhas jsonb,
  p_usuario_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competencia public.fiscal_sped_competencia%ROWTYPE;
  v_id bigint;
BEGIN
  SELECT * INTO v_competencia
    FROM public.fiscal_sped_competencia
   WHERE id = p_competencia_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competencia SPED nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_competencia.status = 'FECHADA' THEN
    RAISE EXCEPTION 'Competencia SPED fechada nao aceita importacao.' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'Importacao 1601 exige ao menos uma linha.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id
    FROM public.fiscal_sped_1601_importacao
   WHERE competencia_id = p_competencia_id
     AND arquivo_sha256 = p_arquivo_sha256;
  IF FOUND THEN RETURN v_id; END IF;

  UPDATE public.fiscal_sped_1601_importacao
     SET status = 'REJEITADA'
   WHERE competencia_id = p_competencia_id
     AND status = 'VALIDADA';

  INSERT INTO public.fiscal_sped_1601_importacao(
    competencia_id, nome_arquivo, storage_path, arquivo_sha256,
    status, quantidade_linhas, imported_by
  ) VALUES (
    p_competencia_id, p_nome_arquivo, p_storage_path, p_arquivo_sha256,
    'VALIDADA', jsonb_array_length(p_linhas), p_usuario_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.fiscal_sped_1601_linha(
    importacao_id, numero_linha, instituicao_cnpj, instituicao_nome,
    instituicao_codigo_participante, intermediario_cnpj, intermediario_nome,
    intermediario_codigo_participante, total_operacoes, total_icms,
    total_iss, total_outros, dados_origem
  )
  SELECT
    v_id, linha.numero_linha, linha.instituicao_cnpj,
    linha.instituicao_nome, linha.instituicao_codigo_participante,
    linha.intermediario_cnpj, linha.intermediario_nome,
    linha.intermediario_codigo_participante, linha.total_operacoes,
    0, linha.total_iss, linha.total_outros, linha.dados_origem
  FROM jsonb_to_recordset(p_linhas) AS linha(
    numero_linha integer,
    instituicao_cnpj text,
    instituicao_nome text,
    instituicao_codigo_participante text,
    intermediario_cnpj text,
    intermediario_nome text,
    intermediario_codigo_participante text,
    total_operacoes numeric,
    total_iss numeric,
    total_outros numeric,
    dados_origem jsonb
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fiscal_sped_importar_efd_anterior(
  bigint, date, text, text, text, jsonb, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_importar_1601(
  bigint, text, text, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_importar_efd_anterior(
  bigint, date, text, text, text, jsonb, jsonb, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_importar_1601(
  bigint, text, text, text, jsonb, uuid
) TO service_role;

COMMIT;
