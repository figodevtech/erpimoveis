-- Cadastro de tipos de motivo de saida (produto e uso/consumo), substituindo as
-- listas fixas que hoje vivem duplicadas no front, na API e dentro das RPCs.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tipos_motivo_saida (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  escopo text NOT NULL DEFAULT 'AMBOS',
  ativo boolean NOT NULL DEFAULT true,
  createdat timestamp with time zone NOT NULL DEFAULT now(),
  updatedat timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tipos_motivo_saida_codigo_unique UNIQUE (codigo),
  CONSTRAINT tipos_motivo_saida_escopo_check CHECK (escopo IN ('PRODUTO', 'USOCONSUMO', 'AMBOS'))
);

GRANT ALL ON TABLE public.tipos_motivo_saida TO anon;
GRANT ALL ON TABLE public.tipos_motivo_saida TO authenticated;
GRANT ALL ON TABLE public.tipos_motivo_saida TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.tipos_motivo_saida_id_seq TO anon, authenticated, service_role;

-- Seed com exatamente os motivos ja hard-coded hoje, preservando compatibilidade
-- total com saidas ja registradas (o valor gravado em estoque_saida.motivo /
-- usoconsumo_saida.motivo continua sendo o mesmo texto).
INSERT INTO public.tipos_motivo_saida (codigo, nome, escopo) VALUES
  ('USO_INTERNO', 'Uso interno', 'PRODUTO'),
  ('DOACAO', 'Doação', 'PRODUTO'),
  ('CONSUMO_INTERNO', 'Consumo interno', 'USOCONSUMO'),
  ('ENTREGA_FUNCIONARIO', 'Entrega a funcionário', 'USOCONSUMO'),
  ('MANUTENCAO_INTERNA', 'Manutenção interna', 'USOCONSUMO'),
  ('AVARIA', 'Avaria', 'AMBOS'),
  ('PERDA', 'Perda', 'AMBOS'),
  ('FURTO', 'Furto', 'AMBOS'),
  ('VENCIMENTO', 'Vencimento', 'AMBOS'),
  ('TRANSFERENCIA', 'Transferência', 'AMBOS'),
  ('AJUSTE_INVENTARIO', 'Ajuste de inventário', 'AMBOS'),
  ('OUTRO', 'Outro', 'AMBOS')
ON CONFLICT (codigo) DO NOTHING;

-- A lista fixa nao faz mais sentido: a validacao passa a ser dinamica (via
-- tipos_motivo_saida) dentro das proprias RPCs abaixo.
ALTER TABLE public.estoque_saida DROP CONSTRAINT IF EXISTS estoque_saida_motivo_check;
ALTER TABLE public.usoconsumo_saida DROP CONSTRAINT IF EXISTS usoconsumo_saida_motivo_check;

CREATE OR REPLACE FUNCTION public.registrar_saida_estoque(
  p_produto_id integer,
  p_quantidade integer,
  p_motivo text,
  p_observacao text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_produto public.produto%ROWTYPE;
  v_saida_id bigint;
  v_motivo text := upper(btrim(coalesce(p_motivo, '')));
  v_observacao text := nullif(btrim(p_observacao), '');
  v_saldo_anterior integer;
  v_saldo_resultante integer;
  v_custo numeric(14,4);
BEGIN
  IF p_produto_id IS NULL OR p_produto_id <= 0 THEN
    RAISE EXCEPTION 'Produto invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'A quantidade deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tipos_motivo_saida
    WHERE codigo = v_motivo AND ativo AND escopo IN ('PRODUTO', 'AMBOS')
  ) THEN
    RAISE EXCEPTION 'Motivo de saida invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_motivo = 'OUTRO' AND v_observacao IS NULL THEN
    RAISE EXCEPTION 'Informe a observacao para o motivo Outro.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_produto
  FROM public.produto
  WHERE id = p_produto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  v_saldo_anterior := coalesce(v_produto.estoque, 0)::integer;
  IF v_saldo_anterior < p_quantidade THEN
    RAISE EXCEPTION 'Estoque insuficiente. Disponivel: %, solicitado: %.', v_saldo_anterior, p_quantidade
      USING ERRCODE = '23514';
  END IF;
  v_saldo_resultante := v_saldo_anterior - p_quantidade;
  v_custo := greatest(coalesce(v_produto.ultimovalordecompra, v_produto.precocompra, 0), 0);

  INSERT INTO public.estoque_saida (motivo, observacao, created_by)
  VALUES (v_motivo, v_observacao, p_created_by)
  RETURNING id INTO v_saida_id;

  INSERT INTO public.estoque_saida_item (
    saida_id, produto_id, quantidade, saldo_anterior, saldo_resultante, valor_custo_aplicado
  ) VALUES (
    v_saida_id, p_produto_id, p_quantidade, v_saldo_anterior, v_saldo_resultante, v_custo
  );

  UPDATE public.produto
  SET estoque = v_saldo_resultante,
      updatedat = now()
  WHERE id = p_produto_id;

  RETURN jsonb_build_object(
    'saida_id', v_saida_id,
    'saldo_anterior', v_saldo_anterior,
    'saldo_resultante', v_saldo_resultante
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_saida_usoconsumo(
  p_saida jsonb, p_itens jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_saida_id bigint; v_json jsonb; v_item public.usoconsumo_item%ROWTYPE; v_item_id integer; v_qtd integer; v_user uuid; v_motivo text;
BEGIN
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE='22023'; END IF;
  v_motivo := upper(btrim(coalesce(p_saida->>'motivo','')));
  IF NOT EXISTS (
    SELECT 1 FROM public.tipos_motivo_saida
    WHERE codigo = v_motivo AND ativo AND escopo IN ('USOCONSUMO', 'AMBOS')
  ) THEN RAISE EXCEPTION 'Motivo invalido.' USING ERRCODE='22023'; END IF;
  IF v_motivo='OUTRO' AND nullif(btrim(p_saida->>'observacao'),'') IS NULL THEN
    RAISE EXCEPTION 'Informe a observacao.' USING ERRCODE='22023';
  END IF;
  v_user:=nullif(p_saida->>'created_by','')::uuid;
  INSERT INTO public.usoconsumo_saida(motivo,observacao,setor,funcionario,centro_custo_id,created_by)
  VALUES(v_motivo,nullif(btrim(p_saida->>'observacao'),''),nullif(btrim(p_saida->>'setor'),''),
    nullif(btrim(p_saida->>'funcionario'),''),nullif(p_saida->>'centro_custo_id','')::integer,v_user)
  RETURNING id INTO v_saida_id;
  FOR v_json IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_item_id:=nullif(v_json->>'item_id','')::integer; v_qtd:=nullif(v_json->>'quantidade','')::integer;
    IF v_item_id IS NULL OR v_qtd IS NULL OR v_qtd<=0 THEN RAISE EXCEPTION 'Item ou quantidade invalida.' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_item FROM public.usoconsumo_item WHERE id=v_item_id AND ativo FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item % nao encontrado.',v_item_id USING ERRCODE='P0002'; END IF;
    IF v_item.estoque<v_qtd THEN RAISE EXCEPTION 'Estoque insuficiente para o item %.',v_item_id USING ERRCODE='23514'; END IF;
    INSERT INTO public.usoconsumo_saida_item(saida_id,item_id,quantidade,saldo_anterior,saldo_resultante,valor_custo_aplicado)
      VALUES(v_saida_id,v_item_id,v_qtd,v_item.estoque,v_item.estoque-v_qtd,coalesce(v_item.ultimovalordecompra,v_item.precocompra,0));
    PERFORM set_config('app.usoconsumo_movimento','permitido',true);
    UPDATE public.usoconsumo_item SET estoque=estoque-v_qtd,updated_by=v_user WHERE id=v_item_id;
  END LOOP;
  RETURN jsonb_build_object('saida_id',v_saida_id);
END $$;

COMMIT;
