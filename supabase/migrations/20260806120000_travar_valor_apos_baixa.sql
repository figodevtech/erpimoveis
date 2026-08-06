-- O valor de uma transacao ja baixada e historico conciliado.
--
-- O sistema ja tratava `pendente` assim: trocar o campo por PATCH e recusado,
-- porque pularia `pago_em`, `baixado_por` e a linha em transacao_baixa_historico.
-- O `valor` nao tinha barreira equivalente, embora mexa igualmente no que ja foi
-- conciliado — um pagamento baixado podia ter o bruto reescrito e a baixa nao era
-- revisitada.
--
-- POR QUE NO BANCO, E NAO NA ROTA
-- A guarda de aplicacao (validarEdicaoManual, em /api/transaction/[id]) so roda
-- quando a requisicao traz o header x-transaction-edit: true. Sem o header, o
-- PATCH grava `valor` direto, sem passar por nenhuma das regras. Isso e
-- deliberado — rotinas internas usam PATCH e nao devem cair na trava de
-- configuracao — mas significa que a protecao e declarada pelo chamador. No
-- banco nao ha como contornar: vale para a RPC de ajuste, para o PATCH com ou
-- sem header, e para qualquer caminho futuro.
--
-- ESCOPO
-- Barra apenas a mudanca de `valor` em linha que ja estava baixada. Nao afeta:
--   * a baixa em si (ali old.pendente ainda e true);
--   * `valorLiquido`, que continua livre — e a taxa da maquineta, conhecida
--     depois do pagamento, e nenhuma soma que fecha OS ou venda olha para ele;
--   * o rateio entre pagamentos ainda pendentes de uma OS ou venda;
--   * exclusao, que segue sendo o caminho para corrigir algo ja baixado.
--
-- Conferido antes de criar: nenhuma funcao do banco escreve em transacao.valor
-- fora de ajustar_valores_transacao, entao nenhum fluxo interno quebra por isto.
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_transacao_valor_apos_baixa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Só interessa quando o bruto muda de fato. Reescrever o mesmo numero (comum
  -- em update que mexe noutra coluna) nao e alteracao.
  IF round(coalesce(new.valor, 0), 2) = round(coalesce(old.valor, 0), 2) THEN
    RETURN new;
  END IF;

  -- `pendente = false` e o que marca dinheiro que entrou ou saiu. Vale tanto
  -- para a baixa pela acao "Pago" quanto para o lancamento registrado ja pago,
  -- que nao passa pela RPC e por isso nem sempre tem `pago_em` preenchido.
  IF coalesce(old.pendente, false) = false THEN
    RAISE EXCEPTION
      'O valor de uma transacao ja baixada nao pode ser alterado. Exclua e lance de novo.'
      USING ERRCODE = '22023';
  END IF;

  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_transacao_valor_apos_baixa() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_valor_apos_baixa_trg ON public.transacao;
CREATE TRIGGER transacao_valor_apos_baixa_trg
  BEFORE UPDATE OF valor ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_valor_apos_baixa();

COMMIT;
