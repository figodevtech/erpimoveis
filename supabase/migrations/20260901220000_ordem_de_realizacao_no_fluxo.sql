-- A ordem de realização no Fluxo de Caixa.
--
-- O QUE ESTAVA ERRADO
-- O Fluxo lista por `data desc`. Só que `data` é `timestamptz`, e cada caminho de
-- escrita grava uma HORA diferente para o mesmo dia:
--
--   lançamento novo (dialog do fluxo) ..... meia-noite local
--   baixa, lote, adiantamento, transf. .... 12:00 no fuso -03:00
--   entrada de estoque parcelada .......... 12:00 sem offset
--   entrada à vista, OS paga por link ..... now(), o instante real
--
-- Quem lançava uma transação às 18h ficava com `data` na meia-noite daquele dia e
-- afundava para baixo de todas as baixas — a linha mais nova aparecia no meio do
-- dia, e não no topo.
--
-- O desempate por `id` também não é ordem de realização. Numa baixa, `id` é o do
-- TÍTULO, criado quando a venda ou a OS nasceu: dar baixa hoje num título do mês
-- passado jogava a linha para o fim do dia de hoje.
--
-- E nenhuma coluna registrava QUANDO o movimento foi feito. `pago_em` é o dia
-- informado pelo operador, ancorado ao meio-dia; `updated_at` muda em qualquer
-- edição posterior; `data` é a data do movimento, não a do registro.
--
-- A CORREÇÃO
-- Separar as duas perguntas que estavam fundidas numa coluna só:
--
--   que dia foi o movimento? ................ `data_dia`
--   em que ordem foram registrados? ......... `movimento_registrado_em`
--
-- A listagem passa a ordenar por `data_dia`, depois `movimento_registrado_em`,
-- depois `id`. Como `data_dia` achata meia-noite, meio-dia e now() no mesmo dia,
-- as linhas JÁ GRAVADAS entram na ordem certa sem reescrever `data` — e ninguém
-- precisa uniformizar os oito caminhos que escrevem a coluna.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O dia do movimento
-- ---------------------------------------------------------------------------
--
-- Offset fixo, não nome de fuso: `AT TIME ZONE <interval>` é IMMUTABLE e serve em
-- coluna gerada, enquanto a forma com texto é apenas STABLE e o Postgres recusa.
-- Fortaleza não tem horário de verão, então -03:00 é exato — é o mesmo -03:00 que
-- a rota já usa para recortar período (FORTALEZA_OFFSET).
ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS data_dia date
  GENERATED ALWAYS AS ((data AT TIME ZONE INTERVAL '-03:00')::date) STORED;

COMMENT ON COLUMN public.transacao.data_dia IS
  'O dia local (-03:00) de `data`. Existe porque `data` carrega horas que variam conforme o caminho que criou a linha (meia-noite, meio-dia ou now()), e ordenar por ela misturava a ordem dentro do dia. Gerada: não se escreve.';

-- ---------------------------------------------------------------------------
-- 2) Quando o movimento foi registrado
-- ---------------------------------------------------------------------------
ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS movimento_registrado_em timestamptz;

-- O histórico de baixa é imutável e guarda o instante real em que a baixa foi
-- executada — é a melhor resposta que existe para as linhas antigas. Sem ele,
-- vale `updated_at` na linha já liquidada e `created_at` no resto.
--
-- O histórico é um livro, não uma linha por título: desde 20260813050000 a
-- UNIQUE (transacao_id) caiu e baixar, estornar e baixar de novo grava um evento
-- cada. Vale o ÚLTIMO — é ele que diz se o título está baixado ou reaberto, é o
-- registro mais recente (que é o que esta coluna significa), e é a leitura para
-- a qual o índice transacao_baixa_historico(transacao_id, id DESC) existe.
--
-- Os gatilhos saem do caminho: este UPDATE toca uma coluna nova e mais nada, mas
-- os AFTER UPDATE da tabela (eventos da DRE, histórico de contraparte, status
-- financeiro da OS) reprocessariam a base inteira à toa. Nenhum gatilho da
-- transacao está desativado de propósito hoje, então ENABLE devolve o estado.
ALTER TABLE public.transacao DISABLE TRIGGER USER;

UPDATE public.transacao t
   SET movimento_registrado_em = coalesce(
         (SELECT bh.created_at
            FROM public.transacao_baixa_historico bh
           WHERE bh.transacao_id = t.id
           ORDER BY bh.id DESC
           LIMIT 1),
         CASE WHEN t.pendente = false THEN t.updated_at END,
         t.created_at
       )
 WHERE t.movimento_registrado_em IS NULL;

ALTER TABLE public.transacao ENABLE TRIGGER USER;

ALTER TABLE public.transacao
  ALTER COLUMN movimento_registrado_em SET DEFAULT now();
ALTER TABLE public.transacao
  ALTER COLUMN movimento_registrado_em SET NOT NULL;

COMMENT ON COLUMN public.transacao.movimento_registrado_em IS
  'Quando o movimento foi registrado no sistema, em relógio de verdade — diferente de `pago_em`, que é o dia informado pelo operador, e de `updated_at`, que qualquer edição posterior move. É o que ordena as linhas dentro de um mesmo dia no Fluxo.';

-- ---------------------------------------------------------------------------
-- 3) Quem mantém a coluna
-- ---------------------------------------------------------------------------
--
-- Um gatilho em vez de editar cada RPC: baixar_transacao_pendente,
-- registrar_baixa_filha, recalcular_baixas_transacao, o adiantamento, a
-- transferência e as RPCs de entrada movem `data` ou fecham o título por
-- caminhos próprios, e todas passam por aqui.
--
-- Carimba quando a linha VIRA movimento (pendente cai para false) ou quando o
-- movimento muda de dia. O estorno, que reabre o título e devolve `data` ao
-- vencimento, também carimba — sem prejuízo: título reaberto sai do Fluxo, e se
-- for baixado de novo o carimbo é refeito.
CREATE OR REPLACE FUNCTION public.tg_transacao_movimento_registrado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF (old.pendente IS DISTINCT FROM new.pendente AND new.pendente = false)
     OR (old.data IS DISTINCT FROM new.data) THEN
    new.movimento_registrado_em := now();
  END IF;

  RETURN new;
END;
$function$;

ALTER FUNCTION public.tg_transacao_movimento_registrado() OWNER TO postgres;

COMMENT ON FUNCTION public.tg_transacao_movimento_registrado() IS
  'Carimba movimento_registrado_em com now() quando a transação vira movimento ou muda de dia. É o que dá ao Fluxo a ordem de realização dentro do dia.';

DROP TRIGGER IF EXISTS transacao_movimento_registrado_trg ON public.transacao;
CREATE TRIGGER transacao_movimento_registrado_trg
  BEFORE UPDATE OF pendente, data ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_movimento_registrado();

-- ---------------------------------------------------------------------------
-- 4) O caminho da listagem
-- ---------------------------------------------------------------------------
--
-- É a ordenação inteira do Fluxo, na ordem em que a rota pede, mais o filtro que
-- ela sempre aplica. Índice ascendente serve aos dois sentidos: o Postgres varre
-- btree de trás para frente sem custo, e as abas a pagar/a receber ordenam asc.
CREATE INDEX IF NOT EXISTS transacao_fluxo_ordem_idx
  ON public.transacao (data_dia, movimento_registrado_em, id)
  WHERE is_deleted = false;

COMMIT;
