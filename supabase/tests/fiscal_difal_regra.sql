BEGIN;

-- Regras de DIFAL: o que o banco tem de garantir sozinho, mesmo que o motor
-- em TypeScript tenha um bug. Tudo aqui roda dentro de uma transação que
-- termina em ROLLBACK.
DO $$
DECLARE
  v_interna numeric;
  v_fcp numeric;
  v_vigentes integer;
  v_nulos integer;
  v_zeros integer;
BEGIN
  -- 1. A carga inicial resolve o caso real: PB -> PI em 22/09/2026.
  SELECT count(*) INTO v_vigentes
    FROM public.fiscal_difal_regra
   WHERE uf = 'PI' AND ativo AND tipo_regra = 'GERAL'
     AND vigencia_inicio <= DATE '2026-09-22'
     AND (vigencia_fim IS NULL OR vigencia_fim >= DATE '2026-09-22');
  IF v_vigentes <> 1 THEN
    RAISE EXCEPTION 'esperava exatamente 1 regra geral vigente no PI, veio %', v_vigentes;
  END IF;

  SELECT aliquota_icms_interna, aliquota_fcp INTO v_interna, v_fcp
    FROM public.fiscal_difal_regra
   WHERE uf = 'PI' AND ativo AND tipo_regra = 'GERAL'
     AND vigencia_inicio <= DATE '2026-09-22'
     AND (vigencia_fim IS NULL OR vigencia_fim >= DATE '2026-09-22');
  IF v_interna <> 22.5 THEN RAISE EXCEPTION 'interna do PI: % (esperado 22,5)', v_interna; END IF;
  IF v_fcp IS NULL OR v_fcp <> 0 THEN RAISE EXCEPTION 'FCP do PI: % (esperado 0)', v_fcp; END IF;

  -- 2. A regra anterior continua no banco, fechada, para reemitir nota antiga.
  SELECT aliquota_icms_interna INTO v_interna
    FROM public.fiscal_difal_regra
   WHERE uf = 'PI' AND ativo AND tipo_regra = 'GERAL'
     AND vigencia_inicio <= DATE '2025-03-31'
     AND (vigencia_fim IS NULL OR vigencia_fim >= DATE '2025-03-31');
  IF v_interna <> 21 THEN RAISE EXCEPTION 'interna histórica do PI: % (esperado 21)', v_interna; END IF;

  -- 3. NULL e 0 são estados distintos de FCP, e o banco preserva os dois.
  INSERT INTO public.fiscal_difal_regra
    (uf, tipo_regra, descricao, aliquota_icms_interna, aliquota_fcp, vigencia_inicio, fonte)
  VALUES ('SC', 'GERAL', 'teste: FCP zero explícito', 17, 0, DATE '2026-01-01', 'teste');
  SELECT count(*) FILTER (WHERE aliquota_fcp IS NULL), count(*) FILTER (WHERE aliquota_fcp = 0)
    INTO v_nulos, v_zeros
    FROM public.fiscal_difal_regra WHERE uf = 'SC';
  IF v_nulos < 1 OR v_zeros < 1 THEN
    RAISE EXCEPTION 'SC deveria ter FCP NULL e FCP 0 convivendo; veio % nulos e % zeros', v_nulos, v_zeros;
  END IF;

  RAISE NOTICE 'carga inicial e distinção NULL/0: ok';
END $$;

-- 4. Cada CHECK tem de recusar o seu caso. Se algum INSERT passar, o bloco
-- levanta exceção: um cadastro incoerente vira imposto errado em toda nota.
DO $$
DECLARE
  v_caso text;
  v_sql text;
  v_casos text[][] := ARRAY[
    ARRAY['GERAL com NCM',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,ncm,aliquota_icms_interna,vigencia_inicio,fonte) VALUES ('PI','GERAL','x','87089990',18,DATE '2026-01-01','t')$q$],
    ARRAY['NCM sem o NCM',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,aliquota_icms_interna,vigencia_inicio,fonte) VALUES ('PI','NCM','x',18,DATE '2026-01-01','t')$q$],
    ARRAY['NCM com menos de 8 dígitos',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,ncm,aliquota_icms_interna,vigencia_inicio,fonte) VALUES ('PI','NCM','x','8708',18,DATE '2026-01-01','t')$q$],
    ARRAY['CEST fora do formato',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,cest,aliquota_icms_interna,vigencia_inicio,fonte) VALUES ('PI','CEST','x','123',18,DATE '2026-01-01','t')$q$],
    ARRAY['vigência terminando antes de começar',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,aliquota_icms_interna,vigencia_inicio,vigencia_fim,fonte) VALUES ('PI','GERAL','x',18,DATE '2026-02-01',DATE '2026-01-01','t')$q$],
    ARRAY['regra que não determina nada',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,vigencia_inicio,fonte) VALUES ('PI','GERAL','x',DATE '2026-01-01','t')$q$],
    ARRAY['UF inexistente',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,aliquota_icms_interna,vigencia_inicio,fonte) VALUES ('XX','GERAL','x',18,DATE '2026-01-01','t')$q$],
    ARRAY['alíquota acima de 100%',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,aliquota_icms_interna,vigencia_inicio,fonte) VALUES ('PI','GERAL','x',120,DATE '2026-01-01','t')$q$],
    ARRAY['FCP negativo',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,aliquota_icms_interna,aliquota_fcp,vigencia_inicio,fonte) VALUES ('PI','GERAL','x',18,-1,DATE '2026-01-01','t')$q$],
    ARRAY['tipo de regra inexistente',
      $q$INSERT INTO public.fiscal_difal_regra (uf,tipo_regra,descricao,aliquota_icms_interna,vigencia_inicio,fonte) VALUES ('PI','CHUTE','x',18,DATE '2026-01-01','t')$q$]
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_casos, 1) LOOP
    v_caso := v_casos[i][1];
    v_sql := v_casos[i][2];
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'o banco aceitou um cadastro que deveria recusar: %', v_caso;
    EXCEPTION
      WHEN check_violation THEN NULL;
      WHEN others THEN
        IF SQLERRM LIKE 'o banco aceitou%' THEN RAISE; END IF;
        NULL;
    END;
  END LOOP;
  RAISE NOTICE 'todos os cadastros incoerentes foram recusados';
END $$;

-- 5. Duas regras idênticas em UF, tipo, identificador e início de vigência
-- seriam conflito em toda emissão: o índice único barra antes disso.
DO $$
BEGIN
  INSERT INTO public.fiscal_difal_regra
    (uf, tipo_regra, descricao, ncm, aliquota_icms_interna, vigencia_inicio, fonte)
  VALUES ('PI', 'NCM', 'primeira', '87089990', 12, DATE '2026-01-01', 'teste');
  BEGIN
    INSERT INTO public.fiscal_difal_regra
      (uf, tipo_regra, descricao, ncm, aliquota_icms_interna, vigencia_inicio, fonte)
    VALUES ('PI', 'NCM', 'duplicata', '87089990', 18, DATE '2026-01-01', 'teste');
    RAISE EXCEPTION 'o banco aceitou duas regras ativas idênticas para o mesmo início de vigência';
  EXCEPTION
    WHEN unique_violation THEN RAISE NOTICE 'duplicata de regra recusada: ok';
  END;
END $$;

-- 6. A tabela é configuração fiscal: sem privilégio para anon/authenticated e
-- com RLS ligada. Quem lê é o servidor, com service_role.
DO $$
DECLARE
  v_rls boolean;
  v_privs integer;
BEGIN
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.fiscal_difal_regra'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'RLS não está ligada em fiscal_difal_regra'; END IF;

  SELECT count(*) INTO v_privs
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'fiscal_difal_regra'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_privs <> 0 THEN
    RAISE EXCEPTION 'anon/authenticated têm % privilégio(s) em fiscal_difal_regra', v_privs;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.permissao WHERE nome = 'fiscal:difal_gerenciar') THEN
    RAISE EXCEPTION 'permissão fiscal:difal_gerenciar não foi criada';
  END IF;
  RAISE NOTICE 'RLS, privilégios e permissões: ok';
END $$;

ROLLBACK;
