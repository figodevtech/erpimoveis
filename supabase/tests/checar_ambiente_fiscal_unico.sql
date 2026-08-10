-- Ensaio da migration 20260810160000, terminando em ROLLBACK.
--
-- Roda o mesmo SQL da migration e confere o efeito, sem gravar nada. Serve para
-- pegar erro de tipo (como o "operator does not exist: enum_ambiente_nfe =
-- tipo_ambiente") antes do deploy.
BEGIN;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '--- Tipos das colunas de ambiente ---';
  FOR r IN
    SELECT c.table_name, c.column_name, c.udt_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name = 'ambiente'
       AND c.table_name IN ('empresa', 'nfe_config', 'nfe')
     ORDER BY c.table_name
  LOOP
    RAISE NOTICE '  %.% -> %', r.table_name, r.column_name, r.udt_name;
  END LOOP;

  RAISE NOTICE '--- ANTES ---';
  FOR r IN
    SELECT e.id AS empresa, e.ambiente::text AS amb_empresa,
           c.modelo::text AS modelo, c.ambiente::text AS amb_config
      FROM public.nfe_config c JOIN public.empresa e ON e.id = c.empresaid
     ORDER BY c.modelo
  LOOP
    RAISE NOTICE '  empresa % (%) | % -> %', r.empresa, r.amb_empresa, r.modelo, r.amb_config;
  END LOOP;
END;
$$;

-- Mesmo UPDATE da migration.
UPDATE public.nfe_config c
   SET ambiente = e.ambiente::text::public.enum_ambiente_nfe,
       updatedat = now()
  FROM public.empresa e
 WHERE e.id = c.empresaid
   AND c.ambiente::text IS DISTINCT FROM e.ambiente::text;

DO $$
DECLARE r record; divergentes int;
BEGIN
  RAISE NOTICE '--- DEPOIS ---';
  FOR r IN
    SELECT e.id AS empresa, e.ambiente::text AS amb_empresa,
           c.modelo::text AS modelo, c.ambiente::text AS amb_config
      FROM public.nfe_config c JOIN public.empresa e ON e.id = c.empresaid
     ORDER BY c.modelo
  LOOP
    RAISE NOTICE '  empresa % (%) | % -> %', r.empresa, r.amb_empresa, r.modelo, r.amb_config;
  END LOOP;

  SELECT count(*) INTO divergentes
    FROM public.nfe_config c JOIN public.empresa e ON e.id = c.empresaid
   WHERE c.ambiente::text IS DISTINCT FROM e.ambiente::text;

  IF divergentes > 0 THEN
    RAISE EXCEPTION 'Ainda restaram % configuracoes divergentes.', divergentes;
  END IF;
  RAISE NOTICE '  OK: nenhuma divergencia restante';
END;
$$;

ROLLBACK;
