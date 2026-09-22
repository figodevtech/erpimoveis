-- Família do NCM: a descrição sozinha não classifica mercadoria.
--
-- A NCM é hierárquica e cada nível só faz sentido lido junto com os de cima.
-- O 9032.89.25 é publicado como "De sistemas de injeção" — injeção de quê?
-- A resposta está no item 9032.89.2, "Controladores eletrônicos do tipo
-- utilizado em veículos automóveis". Pior ainda: 9032.89.29 é literalmente
-- "Outros", e sozinho não diz nada a ninguém.
--
-- `caminho` guarda as descrições dos níveis superiores já resolvidas:
--
--   posição (4)  Instrumentos e aparelhos para regulação ou controle
--   desdobr. (5) Outros instrumentos e aparelhos
--   item (7)     Controladores eletrônicos do tipo utilizado em veículos
--
-- Fica de fora o capítulo (2 dígitos), longo e genérico demais para um rótulo,
-- e os níveis cuja descrição é só "Outros", que não acrescentam nada quando
-- existe um nível mais específico. O texto é montado na importação, a partir
-- da mesma fonte oficial — o banco não guarda as linhas intermediárias, então
-- `fiscal_ncm` continua sendo só o conjunto de códigos de 8 dígitos e a
-- checagem de existência do motor de DIFAL não muda.
--
-- O caminho também entra na busca: quem procura "controlador" precisa achar o
-- 9032.89.25, cuja descrição própria não tem essa palavra.
BEGIN;

ALTER TABLE public.fiscal_ncm
  ADD COLUMN IF NOT EXISTS caminho text;

COMMENT ON COLUMN public.fiscal_ncm.caminho IS
  'Descrições dos níveis superiores (posição, desdobramentos e item), separadas por " › ". Dá sentido a descrições como "Outros".';

-- A coluna de busca passa a cobrir descrição e caminho. É GENERATED, então
-- precisa ser recriada para mudar a expressão; o índice vai junto.
DROP INDEX IF EXISTS public.fiscal_ncm_descricao_busca;

ALTER TABLE public.fiscal_ncm
  DROP COLUMN IF EXISTS descricao_busca;

ALTER TABLE public.fiscal_ncm
  ADD COLUMN descricao_busca text GENERATED ALWAYS AS (
    translate(
      lower(regexp_replace(descricao || ' ' || coalesce(caminho, ''), '<[^>]*>', ' ', 'g')),
      'áàâãäéèêëíìîïóòôõöúùûüñçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑÇ',
      'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
    )
  ) STORED;

COMMENT ON COLUMN public.fiscal_ncm.descricao_busca IS
  'Descrição e caminho, sem acento, sem HTML e em minúsculas, só para busca. Gerada pelo banco; nunca escrever direto.';

CREATE INDEX IF NOT EXISTS fiscal_ncm_descricao_busca
  ON public.fiscal_ncm USING gin (descricao_busca gin_trgm_ops);

COMMIT;
