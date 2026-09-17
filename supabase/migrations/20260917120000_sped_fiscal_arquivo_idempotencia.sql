BEGIN;

-- Migration: Adiciona restricao de unicidade para idempotencia de arquivos SPED Fiscal
-- Garante que arquivos do mesmo tipo (PREVIA ou FINAL) com mesmo hash nao sejam duplicados para a mesma versao,
-- ao mesmo tempo em que permite que uma PREVIA e um FINAL coexistam com o mesmo conteudo/hash.

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_sped_arquivo_versao_tipo_hash_uk
  ON public.fiscal_sped_arquivo(versao_id, tipo, arquivo_sha256);

COMMENT ON INDEX public.fiscal_sped_arquivo_versao_tipo_hash_uk IS
  'Evita duplicidade de arquivos do mesmo tipo (PREVIA ou FINAL) com o mesmo hash para uma dada versao, permitindo coexistencia entre PREVIA e FINAL com o mesmo conteudo.';

COMMIT;
