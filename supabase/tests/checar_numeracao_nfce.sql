-- Somente leitura: o que a NFC-e realmente gravou de série/número.
BEGIN;

DO $$
DECLARE r record; total int;
BEGIN
  RAISE NOTICE '--- Configuração por modelo ---';
  FOR r IN
    SELECT id, modelo::text AS modelo, serie, ultimo_numero, ambiente::text AS amb
      FROM public.nfe_config ORDER BY modelo
  LOOP
    RAISE NOTICE '  % | serie % | ultimo_numero % | %', r.modelo, r.serie, r.ultimo_numero, r.amb;
  END LOOP;

  RAISE NOTICE '--- Notas gravadas (10 mais recentes) ---';
  total := 0;
  FOR r IN
    SELECT id, modelo::text AS modelo, serie, numero, numero_definitivo,
           status::text AS status, ambiente::text AS amb,
           coalesce(substring(chave_acesso from 21 for 2), '--') AS mod_na_chave,
           coalesce(substring(chave_acesso from 23 for 3), '---') AS serie_na_chave,
           coalesce(substring(chave_acesso from 26 for 9), '---') AS numero_na_chave
      FROM public.nfe
     WHERE is_deleted = false
     ORDER BY id DESC LIMIT 10
  LOOP
    total := total + 1;
    RAISE NOTICE '  id % | % | serie % nº % (definitivo: %) | % | % | chave: mod=% serie=% nº=%',
      r.id, r.modelo, r.serie, r.numero, r.numero_definitivo, r.status, r.amb,
      r.mod_na_chave, r.serie_na_chave, r.numero_na_chave;
  END LOOP;
  IF total = 0 THEN RAISE NOTICE '  nenhuma nota'; END IF;

  RAISE NOTICE '--- Fila de números liberados ---';
  total := 0;
  FOR r IN
    SELECT l.config_id, c.modelo::text AS modelo, l.serie, l.numero, l.motivo
      FROM public.nfe_numero_liberado l
      JOIN public.nfe_config c ON c.id = l.config_id
     ORDER BY c.modelo, l.numero
  LOOP
    total := total + 1;
    RAISE NOTICE '  config % (%) | serie % | nº % | %', r.config_id, r.modelo, r.serie, r.numero, coalesce(r.motivo,'-');
  END LOOP;
  IF total = 0 THEN RAISE NOTICE '  fila vazia'; END IF;
END;
$$;

ROLLBACK;
