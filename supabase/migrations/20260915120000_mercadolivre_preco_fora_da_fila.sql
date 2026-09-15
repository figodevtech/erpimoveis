-- O preço do anúncio no Mercado Livre é independente de produto.precovenda.
-- A fila volta a acompanhar só o estoque: alterar o preço de venda no ERP não
-- enfileira nada (antes a fila enviava o preço do cadastro por cima do anúncio).
DROP TRIGGER IF EXISTS trg_enfileirar_estoque_mercadolivre ON public.produto;

CREATE TRIGGER trg_enfileirar_estoque_mercadolivre
AFTER UPDATE OF estoque ON public.produto
FOR EACH ROW
WHEN (OLD.estoque IS DISTINCT FROM NEW.estoque)
EXECUTE FUNCTION public.fn_enfileirar_estoque_mercadolivre();
