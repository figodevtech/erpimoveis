-- Leitura apenas: padrão fiscal da NFS-e gravado hoje. Termina em ROLLBACK.
BEGIN;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '--- nfse_config.padroes_emissao ---';
  FOR r IN
    SELECT empresa_id, provedor, padroes_emissao FROM public.nfse_config ORDER BY empresa_id
  LOOP
    RAISE NOTICE '  empresa % | provedor % | padroes=%',
      r.empresa_id, coalesce(r.provedor, '(vazio)'), r.padroes_emissao;
  END LOOP;

  RAISE NOTICE '--- modelo de NFS-e determinado pela empresa ---';
  FOR r IN SELECT id, codigomunicipio, regimetributario FROM public.empresa ORDER BY id LOOP
    RAISE NOTICE '  empresa % | municipio % | regime %', r.id, r.codigomunicipio, r.regimetributario;
  END LOOP;
END $$;

ROLLBACK;
