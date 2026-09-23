BEGIN;

-- Ciência de avisos fiscais: o que o banco garante sozinho. Roda dentro de uma
-- transação que termina em ROLLBACK.
DO $$
DECLARE
  v_usuario uuid;
  v_nfe_a bigint;
  v_nfe_b bigint;
  v_id bigint;
  v_escopo uuid := '00000000-0000-4000-8000-00000000c1e0';
  v_falhou boolean;
BEGIN
  SELECT id INTO v_usuario FROM public.usuario ORDER BY id LIMIT 1;
  IF v_usuario IS NULL THEN RAISE EXCEPTION 'o teste precisa de ao menos um usuário'; END IF;

  -- 1. Ciência válida entra, com carimbo de data.
  INSERT INTO public.nfe_ciencia_aviso
    (escopo, origem_tipo, origem_id, item_ref, item_numero, code, fingerprint, versao_regra, mensagem, fontes, dados, usuario_id)
  VALUES
    (v_escopo, 'OS', 50, 'os:50:1964', 1, 'NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO', 'fp1.abc123', 'regras_nfe@teste',
     'O CFOP 6403 descreve...', '[{"titulo":"Tabela CFOP","jurisdicao":"NACIONAL"}]', '{"cfop":"6403","codigoIcms":"60"}', v_usuario)
  RETURNING id INTO v_id;
  IF (SELECT confirmado_em FROM public.nfe_ciencia_aviso WHERE id = v_id) IS NULL THEN
    RAISE EXCEPTION 'confirmado_em não foi preenchido';
  END IF;

  -- 2. A mesma situação no mesmo escopo e item não duplica.
  BEGIN
    INSERT INTO public.nfe_ciencia_aviso
      (escopo, origem_tipo, item_ref, item_numero, code, fingerprint, versao_regra, mensagem, usuario_id)
    VALUES (v_escopo, 'OS', 'os:50:1964', 1, 'NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO', 'fp1.abc123', 'r', 'm', v_usuario);
    RAISE EXCEPTION 'ciência duplicada foi aceita';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 3. Fingerprint fora do formato, origem desconhecida e item 0 são recusados.
  v_falhou := false;
  BEGIN
    INSERT INTO public.nfe_ciencia_aviso
      (escopo, origem_tipo, item_ref, item_numero, code, fingerprint, versao_regra, mensagem, usuario_id)
    VALUES (v_escopo, 'OS', '#0', 1, 'X', 'qualquer coisa', 'r', 'm', v_usuario);
  EXCEPTION WHEN check_violation THEN v_falhou := true;
  END;
  IF NOT v_falhou THEN RAISE EXCEPTION 'fingerprint fora do formato foi aceito'; END IF;

  v_falhou := false;
  BEGIN
    INSERT INTO public.nfe_ciencia_aviso
      (escopo, origem_tipo, item_ref, item_numero, code, fingerprint, versao_regra, mensagem, usuario_id)
    VALUES (v_escopo, 'PEDIDO', '#0', 1, 'X', 'fp1.a', 'r', 'm', v_usuario);
  EXCEPTION WHEN check_violation THEN v_falhou := true;
  END;
  IF NOT v_falhou THEN RAISE EXCEPTION 'origem desconhecida foi aceita'; END IF;

  v_falhou := false;
  BEGIN
    INSERT INTO public.nfe_ciencia_aviso
      (escopo, origem_tipo, item_ref, item_numero, code, fingerprint, versao_regra, mensagem, usuario_id)
    VALUES (v_escopo, 'AVULSA', '#0', 0, 'X', 'fp1.a', 'r', 'm', v_usuario);
  EXCEPTION WHEN check_violation THEN v_falhou := true;
  END;
  IF NOT v_falhou THEN RAISE EXCEPTION 'item_numero 0 foi aceito'; END IF;

  -- 4. Trilha de auditoria: não reescreve nem apaga.
  v_falhou := false;
  BEGIN
    UPDATE public.nfe_ciencia_aviso SET mensagem = 'outra' WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_falhou := true;
  END;
  IF NOT v_falhou THEN RAISE EXCEPTION 'a mensagem da ciência foi reescrita'; END IF;

  v_falhou := false;
  BEGIN
    UPDATE public.nfe_ciencia_aviso SET fingerprint = 'fp1.outro' WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_falhou := true;
  END;
  IF NOT v_falhou THEN RAISE EXCEPTION 'o fingerprint da ciência foi reescrito'; END IF;

  v_falhou := false;
  BEGIN
    DELETE FROM public.nfe_ciencia_aviso WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN v_falhou := true;
  END;
  IF NOT v_falhou THEN RAISE EXCEPTION 'a ciência foi apagada'; END IF;

  -- 5. Liga a uma NF-e, não muda de NF-e, e é desligada no descarte.
  SELECT id INTO v_nfe_a FROM public.nfe ORDER BY id LIMIT 1;
  SELECT id INTO v_nfe_b FROM public.nfe WHERE id <> v_nfe_a ORDER BY id LIMIT 1;
  IF v_nfe_a IS NOT NULL THEN
    UPDATE public.nfe_ciencia_aviso SET nfe_id = v_nfe_a WHERE id = v_id;
    IF (SELECT nfe_id FROM public.nfe_ciencia_aviso WHERE id = v_id) <> v_nfe_a THEN
      RAISE EXCEPTION 'a ciência não foi ligada à NF-e';
    END IF;

    IF v_nfe_b IS NOT NULL THEN
      v_falhou := false;
      BEGIN
        UPDATE public.nfe_ciencia_aviso SET nfe_id = v_nfe_b WHERE id = v_id;
      EXCEPTION WHEN check_violation THEN v_falhou := true;
      END;
      IF NOT v_falhou THEN RAISE EXCEPTION 'a ciência foi movida para outra NF-e'; END IF;
    END IF;

    UPDATE public.nfe_ciencia_aviso SET nfe_id = NULL WHERE id = v_id;
    IF (SELECT nfe_id FROM public.nfe_ciencia_aviso WHERE id = v_id) IS NOT NULL THEN
      RAISE EXCEPTION 'a ciência não foi desligada da NF-e descartada';
    END IF;
  ELSE
    RAISE NOTICE 'sem NF-e no banco: parte 5 (vínculo) não exercitada';
  END IF;

  -- 6. Só o servidor lê e escreve.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.nfe_ciencia_aviso'::regclass) THEN
    RAISE EXCEPTION 'RLS desligada em nfe_ciencia_aviso';
  END IF;
  IF has_table_privilege('anon', 'public.nfe_ciencia_aviso', 'SELECT')
     OR has_table_privilege('authenticated', 'public.nfe_ciencia_aviso', 'SELECT')
     OR has_table_privilege('authenticated', 'public.nfe_ciencia_aviso', 'INSERT') THEN
    RAISE EXCEPTION 'anon/authenticated com privilégio em nfe_ciencia_aviso';
  END IF;
  IF has_table_privilege('service_role', 'public.nfe_ciencia_aviso', 'DELETE')
     OR has_table_privilege('service_role', 'public.nfe_ciencia_aviso', 'TRUNCATE') THEN
    RAISE EXCEPTION 'service_role não deveria ter DELETE/TRUNCATE em nfe_ciencia_aviso';
  END IF;
END;
$$;

ROLLBACK;
