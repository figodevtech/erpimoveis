-- Leitura apenas: colunas da tabela oficial de classificação tributária e o
-- que consta para o cClassTrib cadastrado no padrão. Termina em ROLLBACK.
BEGIN;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '--- colunas de fiscal_nfe_classificacao_tributaria ---';
  FOR r IN
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fiscal_nfe_classificacao_tributaria'
     ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  % (%)', r.column_name, r.data_type;
  END LOOP;

  RAISE NOTICE '--- cClassTrib usados no padrao fiscal ---';
  FOR r IN
    SELECT c.modelo,
           c.padroes_emissao -> 'SAIDA' ->> 'cclass_trib' AS codigo,
           c.padroes_emissao -> 'SAIDA' ->> 'cst_ibscbs'  AS cst
      FROM public.nfe_config c
     WHERE c.padroes_emissao -> 'SAIDA' ->> 'cclass_trib' IS NOT NULL
  LOOP
    RAISE NOTICE '  % -> cClassTrib=% cst=%', r.modelo, r.codigo, r.cst;
  END LOOP;

  RAISE NOTICE '--- a classificacao 000001 na tabela oficial ---';
  FOR r IN
    SELECT codigo, cst, nome, permite_nfe, inicio_vigencia, fim_vigencia, versao_fonte
      FROM public.fiscal_nfe_classificacao_tributaria
     WHERE codigo = '000001'
  LOOP
    RAISE NOTICE '  codigo=% cst=% permite_nfe=% vigencia=%..% fonte=%',
      r.codigo, r.cst, r.permite_nfe, r.inicio_vigencia,
      coalesce(r.fim_vigencia::text, 'aberta'), r.versao_fonte;
    RAISE NOTICE '  nome=%', r.nome;
  END LOOP;
END $$;

ROLLBACK;
