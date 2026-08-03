-- produto."exibirPdv" nasceu com DEFAULT false, mas a regra de negocio e a
-- oposta: todo produto cadastrado deve aparecer no PDV, e esconder e a excecao
-- marcada na aba Marketplace. O formulario de cadastro ja envia true
-- (cadastro-produto.tsx), entao o default so aparecia em inserts que omitem a
-- coluna -- importacoes, scripts e integracoes -- e o produto nascia invisivel
-- no PDV sem ninguem ter pedido isso.
--
-- Apenas o default muda. Os dois lugares que gravam false continuam explicitos e
-- inalterados: o delete logico de produto e o placeholder do Mercado Livre.
-- Linhas existentes tambem nao sao tocadas: um produto escondido de proposito
-- deve continuar escondido.
BEGIN;

ALTER TABLE public.produto ALTER COLUMN "exibirPdv" SET DEFAULT true;

COMMENT ON COLUMN public.produto."exibirPdv" IS
  'true: o produto aparece na busca do PDV. Padrao true; false e escolha explicita (ocultado no cadastro, excluido logicamente ou placeholder de integracao).';

COMMIT;
