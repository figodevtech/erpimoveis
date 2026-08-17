-- Corrige a função compartilhada pelos triggers de venda e vendaproduto.
--
-- A versão original referenciava OLD.venda_id dentro de um CASE. Em eventos da
-- tabela venda, OLD é um registro de venda e possui `id`, não `venda_id`.
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_invalidar_aprovacao_venda_alterada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda_id integer;
  v_invalidacoes integer := 0;
BEGIN
  IF TG_TABLE_NAME = 'venda' THEN
    IF TG_OP = 'DELETE' THEN
      v_venda_id := OLD.id;
    ELSE
      v_venda_id := NEW.id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_venda_id := OLD.venda_id;
  ELSE
    v_venda_id := NEW.venda_id;
  END IF;

  v_invalidacoes := public.invalidar_aprovacoes_venda(v_venda_id, 'ORCAMENTO_ALTERADO');

  IF v_invalidacoes > 0 THEN
    UPDATE public.venda
       SET statusaprovacao = NULL,
           updatedat = now()
     WHERE id = v_venda_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_invalidar_aprovacao_venda_alterada() OWNER TO postgres;

COMMIT;
