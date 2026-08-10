-- Padrão fiscal dos itens: mede o buraco que ele preenche e ensaia a migration.
--
-- Roda a migration 20260810180000 dentro da transação e desfaz tudo no final,
-- então serve tanto antes do deploy (ensaio) quanto depois (conferência).
--
--   npm run db:test:sql -- supabase/tests/checar_padroes_fiscais_produto.sql
--
-- Termina em ROLLBACK: nada é gravado.
BEGIN;

DO $$
DECLARE
  r record;
  total bigint;
  gravado jsonb;
BEGIN
  ---------------------------------------------------------------------------
  -- 1) O tamanho do problema: quanto do cadastro fiscal está preenchido
  ---------------------------------------------------------------------------
  SELECT count(*) INTO total FROM produto WHERE NOT coalesce(is_deleted, false);
  RAISE NOTICE '--- produto: % linhas ativas ---', total;

  IF total > 0 THEN
    SELECT
      count(*) FILTER (WHERE nullif(btrim(ncm), '') IS NOT NULL)               AS ncm,
      count(*) FILTER (WHERE nullif(btrim(cest), '') IS NOT NULL)              AS cest,
      count(*) FILTER (WHERE nullif(btrim(origem_mercadoria), '') IS NOT NULL) AS origem,
      count(*) FILTER (WHERE nullif(btrim(csosn), '') IS NOT NULL)             AS csosn,
      count(*) FILTER (WHERE nullif(btrim(cst), '') IS NOT NULL)               AS cst,
      count(*) FILTER (WHERE aliquotaicms IS NOT NULL)                         AS aliq_icms,
      count(*) FILTER (WHERE nullif(btrim(cst_pis), '') IS NOT NULL)           AS cst_pis,
      count(*) FILTER (WHERE nullif(btrim(cst_cofins), '') IS NOT NULL)        AS cst_cofins,
      count(*) FILTER (WHERE nullif(btrim(cclass_trib), '') IS NOT NULL)       AS cclass_trib
    INTO r FROM produto WHERE NOT coalesce(is_deleted, false);

    RAISE NOTICE 'do item  -> ncm=% cest=%', r.ncm, r.cest;
    RAISE NOTICE 'do perfil-> origem=% csosn=% cst=% aliq_icms=%', r.origem, r.csosn, r.cst, r.aliq_icms;
    RAISE NOTICE '            cst_pis=% cst_cofins=% cclass_trib=%', r.cst_pis, r.cst_cofins, r.cclass_trib;
    RAISE NOTICE 'Os campos "do perfil" são os que o padrão passa a preencher.';
  END IF;

  ---------------------------------------------------------------------------
  -- 2) Ensaio da migration
  ---------------------------------------------------------------------------
  ALTER TABLE public.nfe_config
    ADD COLUMN IF NOT EXISTS padroes_emissao jsonb NOT NULL DEFAULT '{}'::jsonb;

  ALTER TABLE public.nfe_config
    DROP CONSTRAINT IF EXISTS nfe_config_padroes_emissao_object_check;

  ALTER TABLE public.nfe_config
    ADD CONSTRAINT nfe_config_padroes_emissao_object_check
    CHECK (jsonb_typeof(padroes_emissao) = 'object');

  RAISE NOTICE '--- migration aplicada sem erro ---';

  ---------------------------------------------------------------------------
  -- 3) O padrão sobrevive a ida e volta, chaveado por operação
  ---------------------------------------------------------------------------
  UPDATE public.nfe_config
     SET padroes_emissao = jsonb_build_object(
           'SAIDA', jsonb_build_object(
             'origem_mercadoria', '0',
             'cfop', '5102',
             'csosn', '102',
             'cst_pis', '49',
             'modo_pis', 'PERCENTUAL',
             'aliquota_pis', 0
           )
         )
   WHERE modelo = 'NFE'::public.enum_modelo_nfe;

  SELECT padroes_emissao INTO gravado
    FROM public.nfe_config
   WHERE modelo = 'NFE'::public.enum_modelo_nfe
   ORDER BY id LIMIT 1;

  IF gravado -> 'SAIDA' ->> 'csosn' IS DISTINCT FROM '102' THEN
    RAISE EXCEPTION 'padrao de SAIDA nao voltou como gravado: %', gravado;
  END IF;
  IF gravado ? 'ENTRADA' THEN
    RAISE EXCEPTION 'ramo ENTRADA apareceu sem ter sido gravado: %', gravado;
  END IF;

  RAISE NOTICE 'ida e volta do jsonb: ok (%).', gravado -> 'SAIDA';

  -- O check tem de barrar qualquer coisa que não seja objeto.
  BEGIN
    UPDATE public.nfe_config SET padroes_emissao = '[]'::jsonb
     WHERE modelo = 'NFE'::public.enum_modelo_nfe;
    RAISE EXCEPTION 'o check aceitou um array em padroes_emissao';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'check rejeita array, como esperado.';
  END;

  ---------------------------------------------------------------------------
  -- 4) Estado atual da configuração fiscal
  ---------------------------------------------------------------------------
  RAISE NOTICE '--- nfe_config ---';
  FOR r IN
    SELECT modelo, serie, ultimo_numero, ambiente, padroes_emissao
      FROM public.nfe_config ORDER BY id
  LOOP
    RAISE NOTICE '  % | serie % | ultimo % | % | padroes=%',
      r.modelo, r.serie, r.ultimo_numero, r.ambiente, r.padroes_emissao;
  END LOOP;

  FOR r IN SELECT id, uf, regimetributario FROM empresa ORDER BY id LOOP
    RAISE NOTICE '  empresa % | uf % | CRT %', r.id, r.uf, r.regimetributario;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 5) Procedência gravada nas notas já emitidas (vazia antes desta entrega)
  ---------------------------------------------------------------------------
  RAISE NOTICE '--- itens com procedência no snapshot ---';
  SELECT count(*) INTO total
    FROM nfe_item
   WHERE tributacao_snapshot ? 'procedenciaFiscal';
  RAISE NOTICE '  % de % itens', total, (SELECT count(*) FROM nfe_item);
END $$;

ROLLBACK;
