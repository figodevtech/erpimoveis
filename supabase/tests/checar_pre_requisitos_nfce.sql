-- Verificação (somente leitura) dos pré-requisitos das migrations de NFC-e.
--
-- A migration 20260810120000 aborta de propósito se existir origem com mais de
-- uma nota transmitida do mesmo modelo. Este script antecipa esse diagnóstico
-- sem alterar nada — termina em ROLLBACK.
--
-- O runner só ecoa RAISE NOTICE, por isso os resultados saem por lá.
BEGIN;

DO $$
DECLARE
  r record;
  total int;
BEGIN
  ---------------------------------------------------------------------------
  RAISE NOTICE '--- 1) Origens que fariam a migration abortar ---';
  total := 0;
  FOR r IN
    SELECT 'venda' AS origem, vendaid AS id_origem, count(*) AS qtd
      FROM public.nfe
     WHERE vendaid IS NOT NULL AND is_deleted = false
       AND status IN ('ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO')
     GROUP BY vendaid, modelo HAVING count(*) > 1
     UNION ALL
    SELECT 'OS', ordemservicoid, count(*)
      FROM public.nfe
     WHERE ordemservicoid IS NOT NULL AND is_deleted = false
       AND status IN ('ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO')
     GROUP BY ordemservicoid, modelo HAVING count(*) > 1
  LOOP
    total := total + 1;
    RAISE NOTICE '  CONFLITO: % % -> % notas', r.origem, r.id_origem, r.qtd;
  END LOOP;
  IF total = 0 THEN RAISE NOTICE '  nenhum conflito: a migration passa'; END IF;

  ---------------------------------------------------------------------------
  RAISE NOTICE '--- 2) Configuração fiscal existente ---';
  FOR r IN
    SELECT id, empresaid, modelo::text AS modelo, serie, ultimo_numero, ambiente::text AS ambiente
      FROM public.nfe_config ORDER BY empresaid, modelo
  LOOP
    RAISE NOTICE '  config % | empresa % | modelo % | serie % | ultimo_numero % | %',
      r.id, r.empresaid, r.modelo, r.serie, r.ultimo_numero, r.ambiente;
  END LOOP;

  ---------------------------------------------------------------------------
  RAISE NOTICE '--- 2b) NFC-e: QR Code e CSC ---';
  FOR r IN
    SELECT qrcode_versao,
           natureza_operacao,
           (csc_homologacao IS NOT NULL) AS tem_csc_homolog,
           (csc_producao IS NOT NULL) AS tem_csc_prod
      FROM public.nfe_config
     WHERE modelo = 'NFCE'::public.enum_modelo_nfe
  LOOP
    RAISE NOTICE '  QR Code versao % | natOp "%" | CSC homolog: % | CSC prod: %',
      r.qrcode_versao, coalesce(r.natureza_operacao, '-'), r.tem_csc_homolog, r.tem_csc_prod;
    IF r.qrcode_versao = 3 THEN
      RAISE NOTICE '  -> v3: CSC nao e necessario';
    ELSE
      RAISE NOTICE '  -> v2: exige CSC + idCSC cadastrados';
    END IF;
  END LOOP;

  ---------------------------------------------------------------------------
  RAISE NOTICE '--- 3) CSC já cadastrado em empresa (fonte do backfill) ---';
  FOR r IN
    SELECT id, uf,
           (cschomologacao IS NOT NULL AND btrim(cschomologacao) <> '') AS tem_homolog,
           (cscproducao IS NOT NULL AND btrim(cscproducao) <> '') AS tem_prod
      FROM public.empresa ORDER BY id
  LOOP
    RAISE NOTICE '  empresa % | UF % | CSC homologacao: % | CSC producao: %',
      r.id, coalesce(r.uf, '?'), r.tem_homolog, r.tem_prod;
  END LOOP;

  ---------------------------------------------------------------------------
  RAISE NOTICE '--- 4) Notas por modelo e status ---';
  total := 0;
  FOR r IN
    SELECT modelo::text AS modelo, status::text AS status, count(*) AS qtd
      FROM public.nfe WHERE is_deleted = false
     GROUP BY modelo, status ORDER BY modelo, status
  LOOP
    total := total + 1;
    RAISE NOTICE '  % / % -> %', r.modelo, r.status, r.qtd;
  END LOOP;
  IF total = 0 THEN RAISE NOTICE '  nenhuma nota emitida ainda'; END IF;
END;
$$;

ROLLBACK;
