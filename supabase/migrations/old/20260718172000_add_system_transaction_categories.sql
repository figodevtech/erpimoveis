ALTER TABLE public.categoriatransacao
  ADD COLUMN IF NOT EXISTS codigo_sistema text;

CREATE UNIQUE INDEX IF NOT EXISTS categoriatransacao_codigo_sistema_key
  ON public.categoriatransacao (codigo_sistema)
  WHERE codigo_sistema IS NOT NULL;

DO $$
DECLARE
  venda_id integer;
  ordem_servico_id integer;
BEGIN
  SELECT id INTO venda_id
  FROM public.categoriatransacao
  WHERE upper(btrim(nome)) = 'VENDA'
  ORDER BY id
  LIMIT 1;

  IF venda_id IS NULL THEN
    INSERT INTO public.categoriatransacao
      (nome, descricao, icone, ativo, codigo_sistema, createdat, updatedat)
    VALUES
      ('VENDA', 'Categoria de sistema para pagamentos de vendas.', 'purchase', true, 'VENDA', now(), now())
    RETURNING id INTO venda_id;
  ELSE
    UPDATE public.categoriatransacao
    SET codigo_sistema = 'VENDA',
        ativo = true,
        updatedat = now()
    WHERE id = venda_id;
  END IF;

  SELECT id INTO ordem_servico_id
  FROM public.categoriatransacao
  WHERE upper(btrim(nome)) IN ('ORDEM DE SERVIÇO', 'ORDEM DE SERVICO')
  ORDER BY id
  LIMIT 1;

  IF ordem_servico_id IS NULL THEN
    INSERT INTO public.categoriatransacao
      (nome, descricao, icone, ativo, codigo_sistema, createdat, updatedat)
    VALUES
      ('ORDEM DE SERVIÇO', 'Categoria de sistema para pagamentos de ordens de serviço.', 'wrench', true, 'ORDEM_SERVICO', now(), now())
    RETURNING id INTO ordem_servico_id;
  ELSE
    UPDATE public.categoriatransacao
    SET codigo_sistema = 'ORDEM_SERVICO',
        ativo = true,
        updatedat = now()
    WHERE id = ordem_servico_id;
  END IF;

  UPDATE public.transacao
  SET categoria_id = venda_id
  WHERE vendaid IS NOT NULL
    AND categoria_id IS DISTINCT FROM venda_id;

  UPDATE public.transacao
  SET categoria_id = ordem_servico_id
  WHERE ordemservicoid IS NOT NULL
    AND categoria_id IS DISTINCT FROM ordem_servico_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.proteger_categoria_transacao_sistema()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.codigo_sistema IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Categorias de sistema não podem ser excluídas.';
    END IF;

    IF NEW.codigo_sistema IS DISTINCT FROM OLD.codigo_sistema THEN
      RAISE EXCEPTION 'O código de uma categoria de sistema não pode ser alterado.';
    END IF;

    IF NEW.ativo IS NOT TRUE THEN
      RAISE EXCEPTION 'Categorias de sistema não podem ser desativadas.';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_categoria_transacao_sistema
  ON public.categoriatransacao;
CREATE TRIGGER trg_proteger_categoria_transacao_sistema
BEFORE UPDATE OR DELETE ON public.categoriatransacao
FOR EACH ROW EXECUTE FUNCTION public.proteger_categoria_transacao_sistema();
