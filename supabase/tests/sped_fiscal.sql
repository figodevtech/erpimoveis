BEGIN;

DO $$
BEGIN
  IF public.fiscal_cnpj_normalizar('00.000.000/e08g-12') <> '00000000E08G12' THEN
    RAISE EXCEPTION 'normalizacao do CNPJ alfanumerico divergiu';
  END IF;
  IF NOT public.fiscal_cnpj_valido('04.252.011/0001-10') THEN
    RAISE EXCEPTION 'CNPJ numerico oficial foi recusado';
  END IF;
  IF NOT public.fiscal_cnpj_valido('00.000.000/E08G-12') THEN
    RAISE EXCEPTION 'CNPJ alfanumerico oficial foi recusado';
  END IF;
  IF public.fiscal_cnpj_valido('00000000E08G13') THEN
    RAISE EXCEPTION 'DV invalido foi aceito';
  END IF;
  IF public.fiscal_cnpj_valido('00000000E08G1A') THEN
    RAISE EXCEPTION 'letra nas posicoes de DV foi aceita';
  END IF;
  IF public.fiscal_cnpj_valido('00000000000000') THEN
    RAISE EXCEPTION 'base repetida foi aceita';
  END IF;
END
$$;

DO $$
DECLARE
  v_empresa_id integer;
  v_competencia_id bigint;
BEGIN
  SELECT id INTO v_empresa_id FROM public.empresa ORDER BY id LIMIT 1;
  IF v_empresa_id IS NULL THEN
    RAISE NOTICE 'sem empresa para testar workflow SPED';
    RETURN;
  END IF;

  v_competencia_id := public.fiscal_sped_criar_competencia(
    v_empresa_id,
    date '2099-08-01',
    NULL
  );
  IF v_competencia_id IS NULL THEN
    RAISE EXCEPTION 'competencia SPED nao foi criada';
  END IF;
END
$$;

ROLLBACK;
