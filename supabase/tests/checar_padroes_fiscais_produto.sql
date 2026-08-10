-- Leitura apenas. Mede o quanto do cadastro fiscal do produto está preenchido
-- e mostra o que a nfe_config guarda hoje. Termina em ROLLBACK.
BEGIN;

DO $$
DECLARE
  r record;
  total bigint;
BEGIN
  SELECT count(*) INTO total FROM produto;
  RAISE NOTICE '--- produto: % linhas ---', total;

  IF total > 0 THEN
    SELECT
      count(*) FILTER (WHERE nullif(btrim(ncm), '') IS NOT NULL)              AS ncm,
      count(*) FILTER (WHERE nullif(btrim(cest), '') IS NOT NULL)             AS cest,
      count(*) FILTER (WHERE nullif(btrim(cfop), '') IS NOT NULL)             AS cfop,
      count(*) FILTER (WHERE nullif(btrim(csosn), '') IS NOT NULL)            AS csosn,
      count(*) FILTER (WHERE nullif(btrim(cst), '') IS NOT NULL)              AS cst,
      count(*) FILTER (WHERE aliquotaicms IS NOT NULL)                        AS aliq_icms,
      count(*) FILTER (WHERE nullif(btrim(cst_pis), '') IS NOT NULL)          AS cst_pis,
      count(*) FILTER (WHERE nullif(btrim(cst_cofins), '') IS NOT NULL)       AS cst_cofins,
      count(*) FILTER (WHERE nullif(btrim(modo_pis), '') IS NOT NULL)         AS modo_pis,
      count(*) FILTER (WHERE nullif(btrim(cst_ibscbs), '') IS NOT NULL)       AS cst_ibscbs,
      count(*) FILTER (WHERE nullif(btrim(cclass_trib), '') IS NOT NULL)      AS cclass_trib,
      count(*) FILTER (WHERE rtc_habilitado)                                  AS rtc_on,
      count(*) FILTER (WHERE nullif(btrim(origem_mercadoria), '') IS NOT NULL) AS origem
    INTO r FROM produto;

    RAISE NOTICE 'ncm=% cest=% cfop=% origem=%', r.ncm, r.cest, r.cfop, r.origem;
    RAISE NOTICE 'csosn=% cst=% aliq_icms=%', r.csosn, r.cst, r.aliq_icms;
    RAISE NOTICE 'cst_pis=% cst_cofins=% modo_pis=%', r.cst_pis, r.cst_cofins, r.modo_pis;
    RAISE NOTICE 'cst_ibscbs=% cclass_trib=% rtc_habilitado=%', r.cst_ibscbs, r.cclass_trib, r.rtc_on;
  END IF;

  RAISE NOTICE '--- empresa: colunas fiscais ---';
  FOR r IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'empresa'
      AND (column_name ILIKE '%regime%' OR column_name ILIKE '%crt%'
           OR column_name ILIKE '%uf%' OR column_name ILIKE '%csc%'
           OR column_name ILIKE '%ambiente%' OR column_name ILIKE '%municipio%')
    ORDER BY column_name
  LOOP
    RAISE NOTICE '  %', r.column_name;
  END LOOP;

  FOR r IN SELECT id, uf, regimetributario FROM empresa ORDER BY id LOOP
    RAISE NOTICE '  empresa id=% uf=% regime=%', r.id, r.uf, r.regimetributario;
  END LOOP;

  RAISE NOTICE '--- distintos usados em nfe_item (o que já saiu em nota) ---';
  FOR r IN
    SELECT cfop, csosn, cst, count(*) AS n
    FROM nfe_item GROUP BY 1,2,3 ORDER BY n DESC LIMIT 10
  LOOP
    RAISE NOTICE '  cfop=% csosn=% cst=% n=%', r.cfop, r.csosn, r.cst, r.n;
  END LOOP;

  RAISE NOTICE '--- colunas fiscais de nfe_item ---';
  FOR r IN
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nfe_item'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  % (%)', r.column_name, r.data_type;
  END LOOP;
END $$;

ROLLBACK;
