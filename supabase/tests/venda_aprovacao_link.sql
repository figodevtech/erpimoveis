-- Testes transacionais do link de aprovação de vendas.
-- npm run db:test:sql -- supabase/tests/venda_aprovacao_link.sql
BEGIN;

DO $test$
DECLARE
  v_template_id integer;
  v_produto_id integer;
  v_quantidade integer;
  v_sub_total numeric;
  v_valor_total numeric;
  v_valor_desconto numeric;
  v_tipo_desconto public.enum_tipo_desconto_venda;
  v_documento text;
  v_estoque integer;
  v_id_rejeicao integer;
  v_id_aprovacao integer;
  v_id_edicao integer;
  v_id_expirado integer;
  v_id_sem_estoque integer;
  v_estoque_antes integer;
  v_ok integer := 0;
  v_falhou integer := 0;
BEGIN
  IF to_regprocedure('public.responder_aprovacao_venda(uuid,text,text)') IS NULL
     OR to_regprocedure('public.preparar_venda_para_aprovacao(integer,uuid,timestamp with time zone,uuid)') IS NULL
     OR to_regprocedure('public.avancar_venda_aprovada_pagamento(integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'A migration de aprovação de vendas ainda não foi aplicada.';
  END IF;

  SELECT v.id, vp.produtoid, vp.quantidade, vp.sub_total, vp.valor_total,
         vp.valor_desconto, vp.tipo_desconto,
         regexp_replace(coalesce(c.cpfcnpj, ''), '\D', '', 'g'), p.estoque
    INTO v_template_id, v_produto_id, v_quantidade, v_sub_total, v_valor_total,
         v_valor_desconto, v_tipo_desconto, v_documento, v_estoque
    FROM public.venda v
    JOIN public.cliente c ON c.id = v.clienteid
    JOIN public.vendaproduto vp ON vp.venda_id = v.id
    JOIN public.produto p ON p.id = vp.produtoid
   WHERE regexp_replace(coalesce(c.cpfcnpj, ''), '\D', '', 'g') <> ''
     AND p.estoque >= vp.quantidade
   LIMIT 1;

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'É necessária uma venda com cliente documentado e produto em estoque para o teste.';
  END IF;

  CREATE TEMP TABLE _molde_venda ON COMMIT DROP AS
    SELECT * FROM public.venda WHERE id = v_template_id;

  -- Cria uma cópia isolada da venda e um item para cada cenário.
  v_id_rejeicao := nextval(pg_get_serial_sequence('public.venda', 'id'));
  UPDATE _molde_venda SET id = v_id_rejeicao, status = 'ORCAMENTO',
    statusaprovacao = NULL, descricao = 'Proposta rejeição',
    pagamento_em = NULL, baixada_em = NULL;
  INSERT INTO public.venda OVERRIDING SYSTEM VALUE SELECT * FROM _molde_venda;
  INSERT INTO public.vendaproduto
    (venda_id, produtoid, quantidade, sub_total, valor_total, valor_desconto, tipo_desconto)
  VALUES
    (v_id_rejeicao, v_produto_id, v_quantidade, v_sub_total, v_valor_total, v_valor_desconto, v_tipo_desconto);

  v_id_aprovacao := nextval(pg_get_serial_sequence('public.venda', 'id'));
  UPDATE _molde_venda SET id = v_id_aprovacao, descricao = 'Proposta aprovação';
  INSERT INTO public.venda OVERRIDING SYSTEM VALUE SELECT * FROM _molde_venda;
  INSERT INTO public.vendaproduto
    (venda_id, produtoid, quantidade, sub_total, valor_total, valor_desconto, tipo_desconto)
  VALUES
    (v_id_aprovacao, v_produto_id, v_quantidade, v_sub_total, v_valor_total, v_valor_desconto, v_tipo_desconto);

  v_id_edicao := nextval(pg_get_serial_sequence('public.venda', 'id'));
  UPDATE _molde_venda SET id = v_id_edicao, descricao = 'Proposta edição';
  INSERT INTO public.venda OVERRIDING SYSTEM VALUE SELECT * FROM _molde_venda;
  INSERT INTO public.vendaproduto
    (venda_id, produtoid, quantidade, sub_total, valor_total, valor_desconto, tipo_desconto)
  VALUES
    (v_id_edicao, v_produto_id, v_quantidade, v_sub_total, v_valor_total, v_valor_desconto, v_tipo_desconto);

  v_id_expirado := nextval(pg_get_serial_sequence('public.venda', 'id'));
  UPDATE _molde_venda SET id = v_id_expirado, descricao = 'Proposta expirada';
  INSERT INTO public.venda OVERRIDING SYSTEM VALUE SELECT * FROM _molde_venda;
  INSERT INTO public.vendaproduto
    (venda_id, produtoid, quantidade, sub_total, valor_total, valor_desconto, tipo_desconto)
  VALUES
    (v_id_expirado, v_produto_id, v_quantidade, v_sub_total, v_valor_total, v_valor_desconto, v_tipo_desconto);

  v_id_sem_estoque := nextval(pg_get_serial_sequence('public.venda', 'id'));
  UPDATE _molde_venda SET id = v_id_sem_estoque, descricao = 'Proposta sem estoque';
  INSERT INTO public.venda OVERRIDING SYSTEM VALUE SELECT * FROM _molde_venda;
  INSERT INTO public.vendaproduto
    (venda_id, produtoid, quantidade, sub_total, valor_total, valor_desconto, tipo_desconto)
  VALUES
    (v_id_sem_estoque, v_produto_id, v_estoque + 1, v_sub_total, v_valor_total, v_valor_desconto, v_tipo_desconto);

  UPDATE public.venda
     SET status = 'APROVACAO_ORCAMENTO', statusaprovacao = 'PENDENTE'
   WHERE id IN (
     v_id_rejeicao, v_id_aprovacao, v_id_edicao, v_id_expirado, v_id_sem_estoque
   );

  INSERT INTO public.vendaaprovacao (vendaid, token, expira_em) VALUES
    (v_id_rejeicao, '00000000-0000-4000-8000-000000000001', now() + interval '48 hours'),
    (v_id_aprovacao, '00000000-0000-4000-8000-000000000002', now() + interval '48 hours'),
    (v_id_edicao, '00000000-0000-4000-8000-000000000003', now() + interval '48 hours'),
    (v_id_expirado, '00000000-0000-4000-8000-000000000004', now() - interval '1 second'),
    (v_id_sem_estoque, '00000000-0000-4000-8000-000000000005', now() + interval '48 hours');

  -- 1. Documento errado não consome o token.
  BEGIN
    PERFORM public.responder_aprovacao_venda(
      '00000000-0000-4000-8000-000000000001', '00000000000', 'APROVAR'
    );
    v_falhou := v_falhou + 1;
  EXCEPTION WHEN invalid_parameter_value THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vendaaprovacao
       WHERE vendaid = v_id_rejeicao AND usado_em IS NULL AND invalidado_em IS NULL
    ) THEN
      RAISE EXCEPTION 'O token foi consumido após documento incorreto.';
    END IF;
    v_ok := v_ok + 1;
  END;

  -- 2. Recusa cria a etapa própria e exige um novo envio antes de aprovar.
  PERFORM public.responder_aprovacao_venda(
    '00000000-0000-4000-8000-000000000001', v_documento, 'REPROVAR'
  );
  IF EXISTS (
    SELECT 1 FROM public.venda v
    JOIN public.vendaaprovacao a ON a.vendaid = v.id
    WHERE v.id = v_id_rejeicao AND v.status::text = 'ORCAMENTO_RECUSADO'
      AND v.statusaprovacao::text = 'REPROVADA' AND a.resultado::text = 'REPROVADA'
      AND a.usado_em IS NOT NULL
  ) THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;

  PERFORM public.preparar_venda_para_aprovacao(
    v_id_rejeicao,
    '00000000-0000-4000-8000-000000000101',
    now() + interval '48 hours',
    NULL
  );
  IF EXISTS (
    SELECT 1 FROM public.venda v
    JOIN public.vendaaprovacao a ON a.vendaid = v.id
    WHERE v.id = v_id_rejeicao
      AND v.status::text = 'APROVACAO_ORCAMENTO'
      AND v.statusaprovacao::text = 'PENDENTE'
      AND a.token = '00000000-0000-4000-8000-000000000101'
      AND a.usado_em IS NULL AND a.invalidado_em IS NULL
  ) THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;

  -- 3. Aprovação registra ORCAMENTO_APROVADO sem baixar estoque. O avanço
  -- explícito para PAGAMENTO faz uma única baixa.
  SELECT estoque INTO v_estoque_antes FROM public.produto WHERE id = v_produto_id;
  PERFORM public.responder_aprovacao_venda(
    '00000000-0000-4000-8000-000000000002', v_documento, 'APROVAR'
  );
  IF EXISTS (
    SELECT 1 FROM public.venda
     WHERE id = v_id_aprovacao AND status::text = 'ORCAMENTO_APROVADO'
       AND statusaprovacao::text = 'APROVADA'
  ) AND (SELECT estoque FROM public.produto WHERE id = v_produto_id) = v_estoque_antes
  THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;

  PERFORM public.avancar_venda_aprovada_pagamento(v_id_aprovacao, NULL);
  IF EXISTS (
    SELECT 1 FROM public.venda
     WHERE id = v_id_aprovacao AND status::text = 'PAGAMENTO'
       AND statusaprovacao::text = 'APROVADA'
  ) AND (SELECT estoque FROM public.produto WHERE id = v_produto_id) = v_estoque_antes - v_quantidade
  THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;

  -- Repetir o avanço é idempotente e não baixa de novo.
  PERFORM public.avancar_venda_aprovada_pagamento(v_id_aprovacao, NULL);
  IF (SELECT estoque FROM public.produto WHERE id = v_produto_id) = v_estoque_antes - v_quantidade
  THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;

  BEGIN
    PERFORM public.responder_aprovacao_venda(
      '00000000-0000-4000-8000-000000000002', v_documento, 'APROVAR'
    );
    v_falhou := v_falhou + 1;
  EXCEPTION WHEN invalid_parameter_value THEN
    IF (SELECT estoque FROM public.produto WHERE id = v_produto_id) = v_estoque_antes - v_quantidade
    THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;
  END;

  -- 3b. A troca de status em `venda` usa NEW.id e não tenta acessar
  -- OLD.venda_id, que só existe em vendaproduto.
  UPDATE public.venda SET status = 'ORCAMENTO' WHERE id = v_id_aprovacao;
  IF EXISTS (
    SELECT 1 FROM public.venda
     WHERE id = v_id_aprovacao AND status::text = 'ORCAMENTO'
       AND statusaprovacao IS NULL
  ) THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;

  -- 4. Campo interno não invalida; descrição comercial invalida e limpa PENDENTE.
  UPDATE public.venda SET observacoes = 'Somente equipe' WHERE id = v_id_edicao;
  IF EXISTS (
    SELECT 1 FROM public.vendaaprovacao
     WHERE vendaid = v_id_edicao AND invalidado_em IS NULL
  ) THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;

  UPDATE public.venda SET descricao = 'Proposta alterada' WHERE id = v_id_edicao;
  IF EXISTS (
    SELECT 1 FROM public.vendaaprovacao
     WHERE vendaid = v_id_edicao AND invalidado_em IS NOT NULL
  ) AND (SELECT statusaprovacao FROM public.venda WHERE id = v_id_edicao) IS NULL
  THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;

  -- 5. Token expirado é recusado e permanece sem uso.
  BEGIN
    PERFORM public.responder_aprovacao_venda(
      '00000000-0000-4000-8000-000000000004', v_documento, 'APROVAR'
    );
    v_falhou := v_falhou + 1;
  EXCEPTION WHEN invalid_parameter_value THEN
    IF (SELECT usado_em FROM public.vendaaprovacao WHERE vendaid = v_id_expirado) IS NULL
    THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;
  END;

  -- 6. A decisão pode ser aprovada sem estoque, mas o avanço para pagamento
  -- falha atomicamente e preserva o orçamento aprovado.
  PERFORM public.responder_aprovacao_venda(
    '00000000-0000-4000-8000-000000000005', v_documento, 'APROVAR'
  );
  BEGIN
    PERFORM public.avancar_venda_aprovada_pagamento(v_id_sem_estoque, NULL);
    v_falhou := v_falhou + 1;
  EXCEPTION WHEN OTHERS THEN
    IF EXISTS (
      SELECT 1 FROM public.venda v
      JOIN public.vendaaprovacao a ON a.vendaid = v.id
      WHERE v.id = v_id_sem_estoque AND v.status::text = 'ORCAMENTO_APROVADO'
        AND v.statusaprovacao::text = 'APROVADA' AND a.usado_em IS NOT NULL
    ) THEN v_ok := v_ok + 1; ELSE v_falhou := v_falhou + 1; END IF;
  END;

  RAISE NOTICE '=== % verificações passaram, % falharam ===', v_ok, v_falhou;
  IF v_falhou > 0 THEN
    RAISE EXCEPTION 'Há % verificações falhando.', v_falhou;
  END IF;
END $test$;

ROLLBACK;
