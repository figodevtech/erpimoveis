BEGIN;

-- Migration: Funcao atomica para registro concorrente e idempotente de arquivos SPED Fiscal
-- Garante alocacao segura de sequencia via advisory lock por versao e idempotencia estrita por (versao_id, tipo, arquivo_sha256).

CREATE OR REPLACE FUNCTION public.fiscal_sped_registrar_arquivo(
  p_versao_id bigint,
  p_tipo text,
  p_finalidade text,
  p_storage_bucket text,
  p_storage_path text,
  p_arquivo_sha256 text,
  p_tamanho_bytes bigint,
  p_quantidade_registros integer,
  p_contadores_registro jsonb,
  p_generated_by uuid
)
RETURNS TABLE (
  id bigint,
  versao_id bigint,
  sequencia integer,
  tipo text,
  finalidade text,
  storage_bucket text,
  storage_path text,
  arquivo_sha256 text,
  tamanho_bytes bigint,
  quantidade_registros integer,
  contadores_registro jsonb,
  generated_by uuid,
  generated_at timestamptz,
  is_new boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.fiscal_sped_arquivo%ROWTYPE;
  v_next_seq integer;
  v_inserted public.fiscal_sped_arquivo%ROWTYPE;
  v_lock_key bigint;
BEGIN
  -- Serializa registros de arquivos para a mesma versao usando advisory lock transacional
  v_lock_key := ('x' || substr(md5('sped_arquivo_lock:' || p_versao_id::text), 1, 15))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 1. Verifica se arquivo do mesmo tipo e hash já existe para esta versão (idempotência estrita)
  SELECT * INTO v_existing
    FROM public.fiscal_sped_arquivo a
   WHERE a.versao_id = p_versao_id
     AND a.tipo = p_tipo
     AND a.arquivo_sha256 = p_arquivo_sha256
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.id,
      v_existing.versao_id,
      v_existing.sequencia,
      v_existing.tipo,
      v_existing.finalidade,
      v_existing.storage_bucket,
      v_existing.storage_path,
      v_existing.arquivo_sha256,
      v_existing.tamanho_bytes,
      v_existing.quantidade_registros,
      v_existing.contadores_registro,
      v_existing.generated_by,
      v_existing.generated_at,
      false AS is_new;
    RETURN;
  END IF;

  -- 2. Aloca a próxima sequência de forma atômica protegida pelo lock
  SELECT COALESCE(MAX(a.sequencia), 0) + 1 INTO v_next_seq
    FROM public.fiscal_sped_arquivo a
   WHERE a.versao_id = p_versao_id;

  -- 3. Insere o novo registro
  INSERT INTO public.fiscal_sped_arquivo (
    versao_id,
    sequencia,
    tipo,
    finalidade,
    storage_bucket,
    storage_path,
    arquivo_sha256,
    tamanho_bytes,
    quantidade_registros,
    contadores_registro,
    generated_by
  ) VALUES (
    p_versao_id,
    v_next_seq,
    p_tipo,
    p_finalidade,
    p_storage_bucket,
    p_storage_path,
    p_arquivo_sha256,
    p_tamanho_bytes,
    p_quantidade_registros,
    p_contadores_registro,
    p_generated_by
  )
  RETURNING * INTO v_inserted;

  RETURN QUERY SELECT
    v_inserted.id,
    v_inserted.versao_id,
    v_inserted.sequencia,
    v_inserted.tipo,
    v_inserted.finalidade,
    v_inserted.storage_bucket,
    v_inserted.storage_path,
    v_inserted.arquivo_sha256,
    v_inserted.tamanho_bytes,
    v_inserted.quantidade_registros,
    v_inserted.contadores_registro,
    v_inserted.generated_by,
    v_inserted.generated_at,
    true AS is_new;
END;
$$;

-- Seguranca de privilegios: apenas service_role pode executar rotinas internas do SPED
REVOKE ALL ON FUNCTION public.fiscal_sped_registrar_arquivo(
  bigint, text, text, text, text, text, bigint, integer, jsonb, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fiscal_sped_registrar_arquivo(
  bigint, text, text, text, text, text, bigint, integer, jsonb, uuid
) TO service_role;

COMMENT ON FUNCTION public.fiscal_sped_registrar_arquivo IS
  'Aloca sequencia e registra arquivo SPED Fiscal de forma atomica com protecao contra concorrencia e garantia de idempotencia.';

COMMIT;
