-- Permite filtrar o historico por entradas sem lancamento financeiro antes da
-- paginacao. As views-base continuam intactas; estas apenas acrescentam o
-- indicador calculado a partir das transacoes ativas vinculadas ao documento.
BEGIN;

CREATE OR REPLACE VIEW public.estoque_movimento_financeiro_historico AS
SELECT
  historico.*,
  CASE
    WHEN historico.origem = 'ENTRADA'
     AND historico.acao = 'REGISTRO'
     AND historico.entrada_id IS NOT NULL
    THEN EXISTS (
      SELECT 1
        FROM public.transacao transacao
       WHERE transacao.entrada_id = historico.entrada_id
         AND transacao.is_deleted = false
    )
    ELSE NULL
  END AS financeiro_lancado
FROM public.estoque_movimento_historico historico;

COMMENT ON VIEW public.estoque_movimento_financeiro_historico IS
  'Historico de produtos acrescido do indicador de lancamento financeiro ativo da entrada.';

ALTER VIEW public.estoque_movimento_financeiro_historico OWNER TO postgres;
REVOKE ALL ON public.estoque_movimento_financeiro_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.estoque_movimento_financeiro_historico TO service_role;

CREATE OR REPLACE VIEW public.usoconsumo_movimento_financeiro_historico AS
SELECT
  historico.*,
  CASE
    WHEN historico.sentido = 'entrada'
    THEN EXISTS (
      SELECT 1
        FROM public.transacao transacao
       WHERE transacao.usoconsumo_entrada_id = historico.id
         AND transacao.is_deleted = false
    )
    ELSE NULL
  END AS financeiro_lancado
FROM public.usoconsumo_movimento_historico historico;

COMMENT ON VIEW public.usoconsumo_movimento_financeiro_historico IS
  'Historico de uso e consumo acrescido do indicador de lancamento financeiro ativo da entrada.';

ALTER VIEW public.usoconsumo_movimento_financeiro_historico OWNER TO postgres;
REVOKE ALL ON public.usoconsumo_movimento_financeiro_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usoconsumo_movimento_financeiro_historico TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
