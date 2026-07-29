-- Etiquetas identificam itens entre os dois estoques e, por isso, precisam ser globais.
BEGIN;

CREATE OR REPLACE FUNCTION public.validar_etiqueta_inventario_global()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_etiqueta text;
BEGIN
  v_etiqueta := nullif(upper(btrim(NEW.etiqueta)), '');
  NEW.etiqueta := v_etiqueta;
  IF v_etiqueta IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serializa tentativas concorrentes para a mesma etiqueta, inclusive entre tabelas.
  PERFORM pg_advisory_xact_lock(hashtextextended('inventario-etiqueta:' || v_etiqueta, 0));

  IF TG_TABLE_NAME = 'produto' THEN
    PERFORM 1 FROM public.usoconsumo_item
    WHERE upper(btrim(etiqueta)) = v_etiqueta
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Já existe um item de uso e consumo com esta etiqueta.' USING ERRCODE = '23505';
    END IF;

    PERFORM 1 FROM public.produto
    WHERE upper(btrim(etiqueta)) = v_etiqueta
      AND id <> coalesce(NEW.id, 0)
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Já existe um produto com esta etiqueta.' USING ERRCODE = '23505';
    END IF;
  ELSE
    PERFORM 1 FROM public.produto
    WHERE upper(btrim(etiqueta)) = v_etiqueta
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Já existe um produto com esta etiqueta.' USING ERRCODE = '23505';
    END IF;

    PERFORM 1 FROM public.usoconsumo_item
    WHERE upper(btrim(etiqueta)) = v_etiqueta
      AND id <> coalesce(NEW.id, 0)
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Já existe outro item de uso e consumo com esta etiqueta.' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS produto_etiqueta_global_trg ON public.produto;
CREATE TRIGGER produto_etiqueta_global_trg
  BEFORE INSERT OR UPDATE OF etiqueta ON public.produto
  FOR EACH ROW EXECUTE FUNCTION public.validar_etiqueta_inventario_global();

DROP TRIGGER IF EXISTS usoconsumo_etiqueta_global_trg ON public.usoconsumo_item;
CREATE TRIGGER usoconsumo_etiqueta_global_trg
  BEFORE INSERT OR UPDATE OF etiqueta ON public.usoconsumo_item
  FOR EACH ROW EXECUTE FUNCTION public.validar_etiqueta_inventario_global();

COMMIT;
