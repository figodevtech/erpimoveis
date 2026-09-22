-- Busca no catálogo de NCM: coluna normalizada e índice de trigrama.
--
-- O catálogo entrou no ERP para o motor fiscal conferir se um código existe.
-- Agora ele também alimenta o seletor de NCM das telas, e aí a consulta deixa
-- de ser por chave e passa a ser por texto — "injeção", "controlador".
--
-- Dois problemas do dado oficial impedem um ILIKE direto:
--
--   1. acento. A descrição do Siscomex vem acentuada; quem digita "injecao"
--      não acharia "injeção".
--   2. HTML. Algumas descrições trazem marcação do próprio portal, como
--      "(UHT - <i>Ultra High Temperature</i>)". Ela suja a busca e a exibição.
--
-- `descricao_busca` resolve os dois de uma vez, e é GENERATED: não existe
-- caminho de escrita que possa esquecer de atualizá-la. A tradução de acentos
-- é feita com translate() em vez da extensão unaccent, que não está instalada
-- neste banco — uma dependência a menos para uma tabela que só precisa disso.
--
-- O índice é GIN de trigrama (pg_trgm já está instalada) porque a busca é por
-- trecho no meio do texto: '%injecao%' não usa índice btree. O código continua
-- respondido pela PK, inclusive por prefixo ('903289%').
BEGIN;

ALTER TABLE public.fiscal_ncm
  DROP COLUMN IF EXISTS descricao_busca;

ALTER TABLE public.fiscal_ncm
  ADD COLUMN descricao_busca text GENERATED ALWAYS AS (
    translate(
      lower(regexp_replace(descricao, '<[^>]*>', ' ', 'g')),
      'áàâãäéèêëíìîïóòôõöúùûüñçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑÇ',
      'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
    )
  ) STORED;

COMMENT ON COLUMN public.fiscal_ncm.descricao_busca IS
  'Descrição sem acento, sem HTML e em minúsculas, só para busca. Gerada pelo banco; nunca escrever direto.';

CREATE INDEX IF NOT EXISTS fiscal_ncm_descricao_busca
  ON public.fiscal_ncm USING gin (descricao_busca gin_trgm_ops);

-- A busca por vigência acompanha quase toda consulta do seletor.
CREATE INDEX IF NOT EXISTS fiscal_ncm_vigencia
  ON public.fiscal_ncm (vigencia_inicio, vigencia_fim);

COMMIT;
