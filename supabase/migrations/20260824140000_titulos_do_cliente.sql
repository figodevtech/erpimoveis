-- Quem e o dono de um titulo a receber, em um lugar so.
--
-- A aba Financeiro do cadastro carregava os titulos do cliente por dois
-- caminhos: `ordemservicoid -> ordemservico.clienteid` e `vendaid ->
-- venda.clienteid`. Nunca por `transacao.cliente_id`. Titulo avulso — lancado
-- direto no fluxo de caixa ou vindo de carga de outro sistema — nao tem OS nem
-- venda, entao ficava invisivel no cadastro mesmo com `cliente_id` correto.
--
-- Isso apareceu na carga do DATASYSTEM no Demir: 333 titulos a receber com
-- `origem = 'ORIGEM_MIGRACAO'` e cliente resolvido por CPF/CNPJ, nenhum deles
-- somando na divida do cliente.
--
-- A view e a fonte unica dos dois consumidores (a aba do cadastro e a coluna de
-- divida da listagem). Separadas, elas divergiriam na primeira mudanca de regra
-- e o mesmo cliente mostraria dois numeros diferentes em duas telas.
--
-- PRECEDENCIA DO DONO
--   coalesce(t.cliente_id, os.clienteid, v.clienteid)
-- `cliente_id` primeiro porque e a contraparte editavel e autoritativa: e o que
-- o dialog do fluxo de caixa grava ao trocar o pagador, e a troca de
-- titularidade da OS ja leva os titulos junto. OS e venda sao o comportamento
-- de hoje, preservado como fallback.
--
-- O QUE NAO GANHA DONO
-- Titulo sem `cliente_id` e sem OS/venda fica com `cliente_id` nulo e nao entra
-- em cadastro nenhum. A view so propaga vinculo ja gravado — nao infere dono
-- por nome nem por semelhanca. Dado que nao bate nao vira vinculo.
BEGIN;

CREATE OR REPLACE VIEW public.transacao_cliente AS
SELECT
  t.id                                              AS transacao_id,
  COALESCE(t.cliente_id, os.clienteid, v.clienteid) AS cliente_id,
  t.valor,
  t.valor_acrescimos,
  t.valor_baixado,
  t.pendente,
  t.data,
  t.vencimento_em,
  t.pago_em,
  t.ordemservicoid,
  t.vendaid,
  t.metodopagamento,
  t.origem
FROM public.transacao t
LEFT JOIN public.ordemservico os ON os.id = t.ordemservicoid
LEFT JOIN public.venda v ON v.id = t.vendaid
-- Os mesmos filtros que a rota do relacionamento ja aplicava. O
-- `evento_financeiro_id is null` evita contar duas vezes a transacao espelho de
-- um evento financeiro da OS.
WHERE t.tipo = 'RECEITA'
  AND t.is_deleted = false
  AND t.evento_financeiro_id IS NULL;

COMMENT ON VIEW public.transacao_cliente IS
  'Titulos a receber com o dono resolvido (cliente_id, senao OS, senao venda). Nao infere vinculo.';

ALTER VIEW public.transacao_cliente OWNER TO postgres;
REVOKE ALL ON public.transacao_cliente FROM anon, authenticated;
GRANT SELECT ON public.transacao_cliente TO service_role;

-- A agregacao por cliente varre a tabela inteira por `cliente_id`; nao havia
-- indice nenhum nessa coluna.
CREATE INDEX IF NOT EXISTS transacao_cliente_id_idx
  ON public.transacao(cliente_id)
  WHERE cliente_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Titulos de um cliente, para o Score e a aba Financeiro
-- ---------------------------------------------------------------------------
-- Devolve exatamente o que `TituloClienteInput` consome, mais `origem`, que a
-- tela usa para marcar de onde veio o titulo que limitou a nota.
CREATE OR REPLACE FUNCTION public.titulos_do_cliente(p_cliente_id integer)
RETURNS TABLE (
  id bigint,
  valor numeric,
  valor_acrescimos numeric,
  valor_baixado numeric,
  pendente boolean,
  data timestamptz,
  vencimento_em timestamptz,
  pago_em timestamptz,
  ordemservicoid integer,
  vendaid integer,
  metodopagamento text,
  origem text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    tc.transacao_id,
    tc.valor,
    tc.valor_acrescimos,
    tc.valor_baixado,
    tc.pendente,
    tc.data,
    tc.vencimento_em,
    tc.pago_em,
    tc.ordemservicoid,
    tc.vendaid,
    tc.metodopagamento::text,
    tc.origem
  FROM public.transacao_cliente tc
  WHERE tc.cliente_id = p_cliente_id
  ORDER BY tc.data DESC;
$$;

ALTER FUNCTION public.titulos_do_cliente(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.titulos_do_cliente(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.titulos_do_cliente(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Divida em aberto por cliente, para a listagem e o filtro de devedores
-- ---------------------------------------------------------------------------
-- Reproduz o que `calcularScoreCliente` faz em TypeScript, para os dois numeros
-- nunca discordarem:
--   valor de face = valor - acrescimos  (`valorDeFace` SUBTRAI; `valor` ja os inclui)
--   em aberto     = face - valor_baixado, nunca negativo
--   vencido       = vencimento antes de hoje, no fuso das telas
--
-- `p_cliente_ids` nulo agrega todo mundo; a listagem passa so os ids da pagina.
-- `p_somente_devedores` corta quem nao tem titulo vencido, para o filtro poder
-- ser aplicado antes da paginacao.
CREATE OR REPLACE FUNCTION public.clientes_divida(
  p_cliente_ids integer[] DEFAULT NULL,
  p_somente_devedores boolean DEFAULT false
)
RETURNS TABLE (
  cliente_id integer,
  total_em_aberto numeric,
  total_vencido numeric,
  quantidade_em_aberto integer,
  quantidade_vencida integer,
  tem_migrado boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH aberto AS (
    SELECT
      tc.cliente_id,
      GREATEST(
        GREATEST(
          round(tc.valor - GREATEST(COALESCE(tc.valor_acrescimos, 0), 0), 2),
          0
        ) - GREATEST(COALESCE(tc.valor_baixado, 0), 0),
        0
      ) AS em_aberto,
      (COALESCE(tc.vencimento_em, tc.data) AT TIME ZONE 'America/Fortaleza')::date
        < (now() AT TIME ZONE 'America/Fortaleza')::date AS vencido,
      tc.origem = 'ORIGEM_MIGRACAO' AS migrado
    FROM public.transacao_cliente tc
    WHERE tc.cliente_id IS NOT NULL
      AND tc.pendente
      AND (p_cliente_ids IS NULL OR tc.cliente_id = ANY (p_cliente_ids))
  )
  SELECT
    aberto.cliente_id,
    round(COALESCE(sum(aberto.em_aberto), 0), 2),
    round(COALESCE(sum(aberto.em_aberto) FILTER (WHERE aberto.vencido), 0), 2),
    count(*)::int,
    (count(*) FILTER (WHERE aberto.vencido))::int,
    bool_or(aberto.migrado)
  FROM aberto
  GROUP BY aberto.cliente_id
  HAVING NOT p_somente_devedores
      OR count(*) FILTER (WHERE aberto.vencido) > 0;
$$;

ALTER FUNCTION public.clientes_divida(integer[], boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.clientes_divida(integer[], boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clientes_divida(integer[], boolean) TO service_role;

COMMIT;
