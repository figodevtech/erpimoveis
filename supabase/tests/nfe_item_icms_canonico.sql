BEGIN;

-- nfe_item espelha o grupo ICMS do XML: ICMS próprio só nos grupos que o têm,
-- e ST de cada tipo na sua coluna. Os casos usam uma NF-e qualquer do banco
-- dentro desta transação, que termina em ROLLBACK.
DO $$
DECLARE
  v_nfe bigint;
  v_item integer := 900;
BEGIN
  SELECT id INTO v_nfe FROM public.nfe ORDER BY id LIMIT 1;
  IF v_nfe IS NULL THEN
    RAISE NOTICE 'Nenhuma NF-e neste banco: casos de gravação pulados.';
    RETURN;
  END IF;

  -- CST 00: ICMS próprio coerente com o grupo.
  INSERT INTO public.nfe_item (nfe_id, n_item, descricao, ncm, cfop, unidade, quantidade, valor_unitario,
    valor_total, cst, grupo_icms_xml, aliquotaicms, valor_bc_icms, valor_icms)
  VALUES (v_nfe, v_item, 'TESTE CST 00', '90328921', '5102', 'UN', 1, 11000, 11000, '00', 'ICMS00', 20, 11000, 2200);

  -- CST 60 como a NF-e 136 ficou no banco: tem de ser recusado.
  BEGIN
    INSERT INTO public.nfe_item (nfe_id, n_item, descricao, ncm, cfop, unidade, quantidade, valor_unitario,
      valor_total, cst, grupo_icms_xml, aliquotaicms, valor_bc_icms, valor_icms)
    VALUES (v_nfe, v_item + 1, 'TESTE CST 60', '90328921', '6403', 'UN', 1, 11000, 11000, '60', 'ICMS60', 20, 11000, 2200);
    RAISE EXCEPTION 'ICMS60 com ICMS próprio foi aceito em nfe_item';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- CST 60 com a ST retida nas colunas próprias: aceito.
  INSERT INTO public.nfe_item (nfe_id, n_item, descricao, ncm, cfop, unidade, quantidade, valor_unitario,
    valor_total, cst, grupo_icms_xml, valor_bc_st_retido, valor_icms_st_retido)
  VALUES (v_nfe, v_item + 2, 'TESTE CST 60 RET', '90328921', '5405', 'UN', 1, 1000, 1000, '60', 'ICMS60', 800, 54);

  -- ST retida fora do ICMS60/SN500: recusado.
  BEGIN
    INSERT INTO public.nfe_item (nfe_id, n_item, descricao, ncm, cfop, unidade, quantidade, valor_unitario,
      valor_total, cst, grupo_icms_xml, aliquotaicms, valor_bc_icms, valor_icms, valor_bc_st_retido, valor_icms_st_retido)
    VALUES (v_nfe, v_item + 3, 'TESTE CST 00 RET', '90328921', '5102', 'UN', 1, 1000, 1000, '00', 'ICMS00', 18, 1000, 180, 800, 54);
    RAISE EXCEPTION 'ST retida foi aceita num item ICMS00';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Base sem valor (ou o contrário): recusado.
  BEGIN
    INSERT INTO public.nfe_item (nfe_id, n_item, descricao, ncm, cfop, unidade, quantidade, valor_unitario,
      valor_total, cst, grupo_icms_xml, aliquotaicms, valor_bc_icms)
    VALUES (v_nfe, v_item + 4, 'TESTE BASE SEM VALOR', '90328921', '5102', 'UN', 1, 1000, 1000, '00', 'ICMS00', 18, 1000);
    RAISE EXCEPTION 'vBC sem vICMS foi aceito';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Grupo inexistente: recusado.
  BEGIN
    INSERT INTO public.nfe_item (nfe_id, n_item, descricao, ncm, cfop, unidade, quantidade, valor_unitario,
      valor_total, cst, grupo_icms_xml)
    VALUES (v_nfe, v_item + 5, 'TESTE GRUPO', '90328921', '5102', 'UN', 1, 1000, 1000, '60', 'ICMS61');
    RAISE EXCEPTION 'grupo ICMS inexistente foi aceito';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

-- Notas já emitidas ficam como estão: nenhuma linha antiga ganhou grupo, e a
-- constraint não foi validada contra elas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.nfe_item WHERE grupo_icms_xml IS NOT NULL AND n_item < 900
  ) THEN
    RAISE EXCEPTION 'a migration preencheu grupo_icms_xml em linhas antigas';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'nfe_item_icms_coerente_com_grupo' AND convalidated
  ) THEN
    RAISE EXCEPTION 'a constraint foi validada contra o histórico; deveria ser NOT VALID';
  END IF;
END
$$;

ROLLBACK;
