-- Reutiliza a fila de estoque para manter também o preço do anúncio vinculado.
-- O worker consulta o preço mais recente do produto no momento do processamento.
DROP TRIGGER IF EXISTS trg_enfileirar_estoque_mercadolivre ON public.produto;

CREATE TRIGGER trg_enfileirar_estoque_mercadolivre
AFTER UPDATE OF estoque, precovenda ON public.produto
FOR EACH ROW
WHEN (
  OLD.estoque IS DISTINCT FROM NEW.estoque
  OR OLD.precovenda IS DISTINCT FROM NEW.precovenda
)
EXECUTE FUNCTION public.fn_enfileirar_estoque_mercadolivre();
