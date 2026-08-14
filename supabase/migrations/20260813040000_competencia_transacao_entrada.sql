-- Transação de entrada nasce com a competência da nota.
--
-- PROBLEMA
-- Nenhum caminho da entrada fiscal informa `competencia_em`: nem a tela, nem os
-- serviços, nem os três INSERTs de `transacao` dentro das RPCs
-- (`registrar_entrada_confirmada`, `registrar_entrada_usoconsumo`,
-- `registrar_entrada_fiscal_mista`). A coluna não tem default nem gatilho, então
-- a transação nasce nula.
--
-- Hoje isso não fura a DRE: `sincronizar_eventos_financeiros_transacao` já ignora
-- transação com `entrada_id`/`usoconsumo_entrada_id` — compra que vira estoque
-- não é resultado novo, o custo aparece na saída. Mas o evento, quando existe,
-- usa `coalesce(competencia_em, data)`, e `data` numa compra em 10x é o
-- VENCIMENTO de cada parcela. No dia em que uma dessas compras entrar no
-- resultado — uso e consumo é o candidato natural, já que é consumido e não
-- revendido —, uma nota de agosto viraria resultado espalhado por dez meses.
--
-- Carimbar agora é barato; corrigir histórico depois não é.
--
-- POR QUE GATILHO, E NÃO AS RPCs
-- Mesma escolha (e mesmo motivo) de `tg_transacao_valor_base_padrao`, em
-- 20260806140000: "Todo caminho de criacao que existe hoje informa `valor` e nao
-- conhece `valor_base`. Preencher aqui evita ter que alterar as dezenas de
-- INSERTs espalhados pelas RPCs de entrada, venda, OS e uso/consumo."
--
-- Aqui vale igual: três funções grandes teriam que ser reescritas inteiras para
-- ganhar uma coluna, e qualquer caminho novo nasceria sem ela de novo. No
-- gatilho, a regra é uma só e não tem como divergir.
--
-- A DATA
-- Emissão da NF-e (`entrada.data_emissao`), porque é quando a compra aconteceu.
-- Sem emissão — entrada manual, sem XML —, vale quando a entrada foi registrada.
-- Valor informado pelo chamador nunca é sobrescrito: o gatilho só preenche nulo.
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_transacao_competencia_entrada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF new.competencia_em IS NOT NULL THEN
    RETURN new;
  END IF;

  -- Nota mista preenche as duas colunas; as duas metades são da mesma nota, e
  -- por isso a ordem entre elas não muda a data.
  IF new.entrada_id IS NOT NULL THEN
    SELECT coalesce(e.data_emissao, e.created_at)
      INTO new.competencia_em
      FROM public.entrada e
     WHERE e.id = new.entrada_id;
  ELSIF new.usoconsumo_entrada_id IS NOT NULL THEN
    SELECT coalesce(u.data_emissao, u.created_at)
      INTO new.competencia_em
      FROM public.usoconsumo_entrada u
     WHERE u.id = new.usoconsumo_entrada_id;
  END IF;

  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_transacao_competencia_entrada() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_competencia_entrada_trg ON public.transacao;
CREATE TRIGGER transacao_competencia_entrada_trg
  BEFORE INSERT ON public.transacao
  FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_competencia_entrada();

-- ---------------------------------------------------------------------------
-- Histórico
--
-- Toda transação de entrada que existe hoje está com a competência nula — não
-- havia caminho que a preenchesse. Como essas transações estão fora da DRE, o
-- backfill não move nenhum número de relatório; ele só evita que o histórico
-- fique dividido entre "antes" e "depois" do gatilho.
--
-- `data` fica de fora do coalesce de propósito: em parcelamento ela é o
-- vencimento, e o vencimento não é competência.
-- ---------------------------------------------------------------------------

UPDATE public.transacao t
   SET competencia_em = coalesce(e.data_emissao, e.created_at)
  FROM public.entrada e
 WHERE e.id = t.entrada_id
   AND t.competencia_em IS NULL;

UPDATE public.transacao t
   SET competencia_em = coalesce(u.data_emissao, u.created_at)
  FROM public.usoconsumo_entrada u
 WHERE u.id = t.usoconsumo_entrada_id
   AND t.entrada_id IS NULL
   AND t.competencia_em IS NULL;

COMMIT;
