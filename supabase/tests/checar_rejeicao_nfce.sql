-- Somente leitura: última tentativa de NFC-e e o retorno da SEFAZ.
BEGIN;

DO $$
DECLARE r record; total int;
BEGIN
  RAISE NOTICE '--- Config da NFC-e ---';
  FOR r IN
    SELECT serie, ultimo_numero, ambiente::text AS amb, qrcode_versao
      FROM public.nfe_config WHERE modelo = 'NFCE'::public.enum_modelo_nfe
  LOOP
    RAISE NOTICE '  serie % | ultimo_numero % | ambiente % | QR v%',
      r.serie, r.ultimo_numero, r.amb, r.qrcode_versao;
  END LOOP;

  RAISE NOTICE '--- NFC-e gravadas ---';
  total := 0;
  FOR r IN
    SELECT id, serie, numero, numero_definitivo, status::text AS status,
           ambiente::text AS amb, codigo_rejeicao, motivo_rejeicao,
           coalesce(chave_acesso, '-') AS chave
      FROM public.nfe
     WHERE modelo = 'NFCE'::public.enum_modelo_nfe AND is_deleted = false
     ORDER BY id DESC LIMIT 5
  LOOP
    total := total + 1;
    RAISE NOTICE '  id % | serie % nº % (def: %) | % | %',
      r.id, r.serie, r.numero, r.numero_definitivo, r.status, r.amb;
    RAISE NOTICE '     cStat: % | %', coalesce(r.codigo_rejeicao,'-'), coalesce(r.motivo_rejeicao,'-');
    RAISE NOTICE '     chave: %', r.chave;
  END LOOP;
  IF total = 0 THEN RAISE NOTICE '  nenhuma NFC-e gravada'; END IF;

  RAISE NOTICE '--- Emitente ---';
  FOR r IN
    SELECT id, cnpj, uf, inscricaoestadual, ambiente::text AS amb, regimetributario::text AS crt
      FROM public.empresa ORDER BY id
  LOOP
    RAISE NOTICE '  empresa % | CNPJ % | UF % | IE % | ambiente(empresa) % | CRT %',
      r.id, r.cnpj, r.uf, coalesce(r.inscricaoestadual,'-'), r.amb, r.crt;
  END LOOP;
END;
$$;

ROLLBACK;
