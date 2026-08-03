-- DRE — Fase 0, passos 1 e 2: data de competencia e livro de resultado generico.
--
-- CONTEXTO
-- O sistema nao possuia data de competencia em lugar nenhum: `transacao` tem
-- `data`, `vencimento_em` e `pago_em`, todas de caixa. Sem competencia nao
-- existe DRE — uma conta de energia de julho paga em agosto pertence a julho.
--
-- Em paralelo, `eventos_financeiros` ja era um livro de resultado para OS, com
-- chave de idempotencia, snapshots, ciclo ATIVO/CONVERTIDO/CANCELADO e vinculo
-- com `transacao`. Em vez de criar uma tabela paralela — que produziria duas
-- fontes de verdade para o resultado da OS, exatamente a origem dos bugs de
-- comissao corrigidos nas migrations 130000 a 150000 — esta migracao generaliza
-- a tabela existente para aceitar outras origens (venda, transacao, manual).
--
-- DECISOES
-- 1. `competencia_em` retroativo = `transacao.data`. E o unico dado disponivel e
--    e corrigivel lancamento a lancamento depois.
-- 2. Para eventos de OS ja existentes, a competencia e o fim da execucao
--    (`execucao_fim_em`), com fallback na entrada da OS. E o momento em que o
--    servico foi entregue — mesmo criterio adotado na Central Pessoal.
-- 3. `source_item_id` e coluna propria, e nao significado embutido dentro de
--    `chave_origem`. Isso protege a DRE de uma futura troca da PK de
--    `osservico`/`osproduto` (hoje compostas), que passaria a exigir apenas um
--    UPDATE em vez de um redesenho.
-- 4. A constraint UNIQUE existente e preservada intacta: todo o caminho de OS
--    (`sincronizar_`/`reconciliar_eventos_financeiros_os`, que usam
--    `on conflict (ordemservicoid, origem, chave_origem, natureza)`) continua
--    funcionando sem alteracao. Origens novas usam um indice unico parcial.
--
-- Nenhum comportamento atual muda: todas as colunas sao aditivas e o backfill
-- apenas preenche o que estava vazio.
BEGIN;

-- ---------------------------------------------------------------- passo 1
-- Competencia no financeiro.

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS competencia_em timestamp with time zone;

COMMENT ON COLUMN public.transacao.competencia_em IS
  'Data de competencia (regime economico). Define o periodo na DRE, ao contrario de `data`/`pago_em`, que sao de caixa. Backfill inicial copiou `data`.';

UPDATE public.transacao
   SET competencia_em = data
 WHERE competencia_em IS NULL;

CREATE INDEX IF NOT EXISTS transacao_competencia_em_idx
  ON public.transacao (competencia_em);

-- ---------------------------------------------------------------- passo 2
-- Livro de resultado generico.

ALTER TABLE public.eventos_financeiros
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id bigint,
  ADD COLUMN IF NOT EXISTS source_item_id bigint,
  ADD COLUMN IF NOT EXISTS competencia_em timestamp with time zone,
  ADD COLUMN IF NOT EXISTS natureza_dre text,
  ADD COLUMN IF NOT EXISTS centro_custo_id integer,
  ADD COLUMN IF NOT EXISTS estorno_de_id bigint,
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.eventos_financeiros.source_type IS
  'Modulo de origem: ORDEM_SERVICO, VENDA, TRANSACAO ou MANUAL.';
COMMENT ON COLUMN public.eventos_financeiros.source_item_id IS
  'Identificador da linha na origem. Coluna propria de proposito: nao depende do formato de `chave_origem`.';
COMMENT ON COLUMN public.eventos_financeiros.natureza_dre IS
  'Papel na DRE: RECEITA, DEDUCAO, CUSTO ou DESPESA. Distinto de `natureza`, que e apenas RECEITA/DESPESA no fluxo de caixa.';
COMMENT ON COLUMN public.eventos_financeiros.competencia_em IS
  'Data que determina o periodo na DRE.';

-- Origens novas nao tem ordem de servico.
ALTER TABLE public.eventos_financeiros
  ALTER COLUMN ordemservicoid DROP NOT NULL;

ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_estorno_de_id_fkey;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_estorno_de_id_fkey
  FOREIGN KEY (estorno_de_id) REFERENCES public.eventos_financeiros(id) ON DELETE SET NULL;

ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_centro_custo_id_fkey;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_centro_custo_id_fkey
  FOREIGN KEY (centro_custo_id) REFERENCES public.centrosdecusto(id) ON DELETE SET NULL;

ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_source_type_check;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('ORDEM_SERVICO', 'VENDA', 'TRANSACAO', 'MANUAL'));

ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_natureza_dre_check;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_natureza_dre_check
  CHECK (natureza_dre IS NULL OR natureza_dre IN ('RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA'));

-- Backfill: tudo que existe hoje veio de ordem de servico.
UPDATE public.eventos_financeiros e
   SET source_type = 'ORDEM_SERVICO',
       source_id = e.ordemservicoid,
       source_item_id = coalesce(e.servicoid, e.produtoid),
       is_manual = (e.origem = 'AVULSO'),
       natureza_dre = case
         when e.natureza = 'RECEITA' then 'RECEITA'
         when e.origem in ('PRODUTO', 'SERVICO', 'COMISSAO') then 'CUSTO'
         else 'DESPESA'
       end,
       competencia_em = coalesce(o.execucao_fim_em, o.dataentrada, e.created_at)
  FROM public.ordemservico o
 WHERE o.id = e.ordemservicoid
   AND e.source_type IS NULL;

-- Idempotencia das origens novas. A constraint antiga
-- (ordemservicoid, origem, chave_origem, natureza) segue valendo para OS: as
-- funcoes de sincronizacao dependem dela no `on conflict`.
CREATE UNIQUE INDEX IF NOT EXISTS eventos_financeiros_fonte_uk
  ON public.eventos_financeiros (source_type, source_id, origem, chave_origem, natureza)
  WHERE ordemservicoid IS NULL;

CREATE INDEX IF NOT EXISTS eventos_financeiros_competencia_idx
  ON public.eventos_financeiros (competencia_em);
CREATE INDEX IF NOT EXISTS eventos_financeiros_fonte_idx
  ON public.eventos_financeiros (source_type, source_id);
CREATE INDEX IF NOT EXISTS eventos_financeiros_natureza_dre_idx
  ON public.eventos_financeiros (natureza_dre, competencia_em)
  WHERE status = 'ATIVO';

COMMIT;
