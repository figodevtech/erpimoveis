-- Produto novo nasce PUBLICADO no canal Loja propria, como ja nasce com
-- "exibirPdv" = true (ver 20260803140000_produto_exibir_pdv_default_true).
--
-- A visibilidade no site nao e uma coluna de produto: vem de
-- site_product_link.status = 'PUBLICADO'. Sem vinculo, o produto nem entra em
-- site_catalog_export, entao todo cadastro novo ficava fora da loja ate alguem
-- publicar manualmente. Esconder do site passa a ser a excecao, marcada na aba
-- Marketplace (status PAUSADO/RASCUNHO), igual ao PDV.
--
-- Regras:
-- * Espelha o PDV: so publica quem nasce com "exibirPdv" = true e nao excluido.
--   Placeholders de integracao (Mercado Livre, Shopee) nascem com "exibirPdv" =
--   false e continuam fora do site.
-- * O canal exige empresa unica por banco (ver requireEmpresaId); com zero ou
--   mais de uma empresa o trigger nao faz nada.
-- * Nunca impede o cadastro: qualquer falha ao criar o vinculo vira WARNING.
-- * Produtos existentes nao sao tocados: um produto fora do site de proposito
--   deve continuar fora. Para publicar o catalogo antigo use "Publicar todos".
-- * Instalacoes sem loja configurada apenas acumulam o vinculo/fila; nada e
--   enviado sem STOREFRONT_API_URL e STOREFRONT_CATALOG_SYNC_SECRET.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_publicar_produto_novo_no_site()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresas integer;
  v_empresa_id integer;
BEGIN
  SELECT count(*), min(id)
    INTO v_empresas, v_empresa_id
    FROM (SELECT id FROM public.empresa ORDER BY id LIMIT 2) empresas;

  IF v_empresas <> 1 THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- O trigger de site_product_link enfileira a sincronizacao com a loja.
    INSERT INTO public.site_product_link (empresa_id, produto_id, status)
    VALUES (v_empresa_id, NEW.id, 'PUBLICADO')
    ON CONFLICT (empresa_id, produto_id) DO NOTHING;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'Produto % cadastrado sem publicacao no site: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publicar_produto_novo_no_site ON public.produto;
CREATE TRIGGER trg_publicar_produto_novo_no_site
AFTER INSERT ON public.produto
FOR EACH ROW
WHEN (NEW."exibirPdv" IS TRUE AND COALESCE(NEW.is_deleted, false) = false)
EXECUTE FUNCTION public.fn_publicar_produto_novo_no_site();

COMMENT ON FUNCTION public.fn_publicar_produto_novo_no_site() IS
  'Cria site_product_link PUBLICADO para produto novo visivel no PDV. Ocultar do site e escolha explicita na aba Marketplace.';

COMMIT;
