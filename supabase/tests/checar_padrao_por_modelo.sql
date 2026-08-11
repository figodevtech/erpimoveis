-- Leitura apenas: mostra o padrão fiscal gravado em cada modelo. Termina em ROLLBACK.
BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, modelo, serie, ambiente, padroes_emissao
      FROM public.nfe_config ORDER BY id
  LOOP
    RAISE NOTICE '--- % (id %) | serie % | % ---', r.modelo, r.id, r.serie, r.ambiente;
    RAISE NOTICE '    SAIDA:   %', coalesce((r.padroes_emissao -> 'SAIDA')::text, '(vazio)');
    RAISE NOTICE '    ENTRADA: %', coalesce((r.padroes_emissao -> 'ENTRADA')::text, '(vazio)');
  END LOOP;
END $$;

ROLLBACK;
