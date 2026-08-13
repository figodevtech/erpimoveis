-- Estornar a baixa: tirar o título do fluxo de caixa devolve ele para em aberto.
--
-- O QUE ACONTECEU
-- No banco da Demir Diesel uma operadora excluiu um título a pagar migrado de
-- R$ 311,36 que já estava liquidado. A exclusão apagou o título inteiro, não só
-- a baixa: como o lançamento veio de migração, não havia OS nem venda para
-- regerá-lo, e a dívida sumiu junto com o pagamento. O saldo do banco subiu
-- R$ 311,36 sem que nada tivesse acontecido no mundo.
--
-- E ela seguiu o caminho que o sistema mandava. Até aqui desfazer uma baixa não
-- existia como operação, e tanto o PATCH quanto a trava de valor diziam, por
-- escrito, "exclua e lance de novo". Para transação de OS ou venda isso passa,
-- porque o documento regera o título. Para título avulso ou migrado, a mesma
-- frase manda apagar a própria dívida.
--
-- A REGRA
-- Título liquidado não se exclui. Para excluir, primeiro sai do fluxo de caixa:
-- o dinheiro é desfeito, o título volta a ser a pagar ou a receber, e aí sim ele
-- pode ser excluído — quando já não há pagamento nenhum para se perder junto.
--
-- O QUE ISTO MUDA NO HISTÓRICO
-- `transacao_baixa_historico` tinha UNIQUE (transacao_id): uma baixa por título,
-- para sempre. A regra nova torna normal o que a chave proibia — baixar, estornar
-- e baixar de novo. A tabela passa a ser um livro: uma linha por evento, com a
-- coluna `operacao` dizendo qual foi. Nada é reescrito nem apagado, e o gatilho
-- de imutabilidade continua valendo.
--
-- Isto também conserta um caminho que já estava quebrado: `desfazer_adiantamento`
-- (20260812150000) devolve títulos para em aberto sem tocar no histórico, e a
-- segunda baixa desses títulos estourava violação de unicidade — que a rota
-- traduzia como "Esta transação já foi baixada", falando de outra coisa.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O histórico de baixa vira livro
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao_baixa_historico
  DROP CONSTRAINT IF EXISTS transacao_baixa_historico_transacao_id_key;

ALTER TABLE public.transacao_baixa_historico
  ADD COLUMN IF NOT EXISTS operacao text NOT NULL DEFAULT 'BAIXA';

ALTER TABLE public.transacao_baixa_historico
  DROP CONSTRAINT IF EXISTS transacao_baixa_historico_operacao_check;
ALTER TABLE public.transacao_baixa_historico
  ADD CONSTRAINT transacao_baixa_historico_operacao_check
    CHECK (operacao IN ('BAIXA', 'ESTORNO'));

-- Sem a chave única, ler o histórico de um título vira varredura. E a ordem
-- importa: o último evento é que diz se o título está baixado ou reaberto.
CREATE INDEX IF NOT EXISTS transacao_baixa_historico_transacao_idx
  ON public.transacao_baixa_historico(transacao_id, id DESC);

COMMENT ON COLUMN public.transacao_baixa_historico.operacao IS
  'BAIXA registra o pagamento; ESTORNO registra o desfazimento dele. O desfazimento é fato novo, não correção do passado: as duas linhas convivem.';
COMMENT ON COLUMN public.transacao_baixa_historico.baixado_por IS
  'Quem executou a operação da linha: quem baixou, na BAIXA; quem estornou, no ESTORNO.';

-- ---------------------------------------------------------------------------
-- 2) A operação que faltava
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.estornar_baixa_transacao(
  p_transacao_id bigint,
  p_estornado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_acrescimos_removidos numeric(14,2) := 0;
  v_valor_reaberto numeric(14,2);
BEGIN
  SELECT * INTO v_transacao
    FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_transacao.pendente, false) THEN
    RAISE EXCEPTION 'Esta transação não está liquidada: não há baixa a estornar.'
      USING ERRCODE = '22023';
  END IF;

  -- As três recusas abaixo têm o mesmo motivo: a baixa não é desta transação
  -- sozinha, e desfazê-la por aqui deixaria a outra ponta cobrindo dinheiro que
  -- não existe mais. Cada uma aponta a operação que de fato desfaz o conjunto.
  IF v_transacao.adiantamento_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Este título foi liquidado pela antecipação #%. Desfaça a antecipação: ela devolve este título e os irmãos para em aberto de uma vez.',
      v_transacao.adiantamento_id USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_transacao.eh_adiantamento, false) THEN
    RAISE EXCEPTION
      'Esta é uma antecipação, não a baixa de um título. Excluí-la é que devolve os títulos para em aberto.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta baixa é uma perna do pagamento múltiplo #%. Desfaça o pagamento inteiro.',
      v_transacao.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;

  -- Reabrir vem antes de mexer no valor, e não por estilo: a trava
  -- `transacao_valor_apos_baixa_trg` (20260806120000) recusa alterar o bruto
  -- enquanto `pendente = false`. Enquanto o título estiver liquidado, nem o
  -- DELETE dos acréscimos abaixo passaria — o recálculo que ele dispara escreve
  -- em `valor`.
  --
  -- `data` volta a ser o vencimento. A baixa a havia trocado pela data do
  -- pagamento (é assim que o título entra no fluxo de caixa no dia certo), e sem
  -- desfazer isso o título reabriria vencendo no dia em que foi pago.
  UPDATE public.transacao
     SET pendente = true,
         data = coalesce(vencimento_em, data),
         pago_em = NULL,
         baixado_por = NULL,
         updated_at = now()
   WHERE id = p_transacao_id;

  -- O acréscimo era do pagamento: juros e multa nasceram do atraso até aquela
  -- data, e a data deixou de existir. O título volta a valer o que devia.
  -- Desconto não entra aqui — ele mexe só no líquido, e a taxa da maquineta ou
  -- o abatimento concedido são negociação à parte, não consequência da data.
  WITH removidos AS (
    DELETE FROM public.transacao_ajuste
     WHERE transacao_id = p_transacao_id
       AND natureza = 'ACRESCIMO'
    RETURNING valor_calculado
  )
  SELECT coalesce(sum(valor_calculado), 0) INTO v_acrescimos_removidos FROM removidos;

  -- O DELETE acima já dispara o recálculo — mas só quando havia linha de ajuste.
  -- Transação antiga, ou restaurada de auditoria, carrega `valor_acrescimos` sem
  -- linha nenhuma por trás; sem isto ela reabriria ainda valendo o valor com
  -- juros, e nada mais o corrigiria.
  v_valor_reaberto := round(coalesce(v_transacao.valor_base, v_transacao.valor), 2);

  UPDATE public.transacao
     SET valor = v_valor_reaberto,
         valor_acrescimos = 0,
         "valorLiquido" = round(v_valor_reaberto - coalesce(valor_descontos, 0), 2),
         updated_at = now()
   WHERE id = p_transacao_id;

  -- O estorno é um evento do livro, ao lado da baixa que ele desfaz. Guarda o
  -- banco e o método de onde o dinheiro saiu, porque é isso que some do fluxo.
  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id,
    coalesce(v_transacao.vencimento_em, v_transacao.data),
    -- Lançamento registrado já pago não passou pela RPC de baixa e pode não ter
    -- `pago_em`; a data do lançamento é o que se sabe sobre quando o dinheiro andou.
    coalesce(v_transacao.pago_em, v_transacao.data),
    p_estornado_por,
    v_transacao.banco_id,
    v_transacao.metodopagamento,
    'ESTORNO'
  );

  -- O status da OS ou da venda se acerta sozinho: `trg_recalcular_status_financeiro_os`
  -- dispara no UPDATE de `pendente` e refaz a conta do documento.

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', true,
    'valor', v_valor_reaberto,
    'acrescimos_removidos', v_acrescimos_removidos,
    'vencimento_em', coalesce(v_transacao.vencimento_em, v_transacao.data)
  );
END;
$$;

ALTER FUNCTION public.estornar_baixa_transacao(bigint, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) IS
  'Tira a transação do fluxo de caixa: desfaz a baixa, remove os acréscimos do pagamento e devolve o título para a pagar ou a receber.';

REVOKE ALL ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) A trava de valor deixa de mandar excluir
-- ---------------------------------------------------------------------------
--
-- A mensagem de 20260806120000 terminava em "Exclua e lance de novo", que agora
-- é justamente o caminho fechado. Só o texto muda; a regra é a mesma.

CREATE OR REPLACE FUNCTION public.tg_transacao_valor_apos_baixa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF round(coalesce(new.valor, 0), 2) = round(coalesce(old.valor, 0), 2) THEN
    RETURN new;
  END IF;

  IF coalesce(old.pendente, false) = false THEN
    RAISE EXCEPTION
      'O valor de uma transação já baixada não pode ser alterado. Tire-a do fluxo de caixa primeiro: o título volta a ficar em aberto e o valor volta a ser editável.'
      USING ERRCODE = '22023';
  END IF;

  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_transacao_valor_apos_baixa() OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 4) Auditoria em transacao_ajuste
-- ---------------------------------------------------------------------------
--
-- A tabela nasceu em 20260806140000, depois da última carga de auditoria, e ficou
-- sem o gatilho. Foi o que fez a linha de juros da transação 784 da Demir sumir
-- sem cópia quando o CASCADE a levou — a transação em si voltou inteira, vinda de
-- `auditoria_evento`, mas o ajuste não tinha de onde voltar.
--
-- Agora o estorno apaga acréscimo por regra, o que torna a falta bem mais cara.

DO $$
BEGIN
  IF to_regprocedure('public.habilitar_auditoria_tabela(regclass)') IS NOT NULL THEN
    PERFORM public.habilitar_auditoria_tabela('public.transacao_ajuste'::regclass);
  END IF;
END;
$$;

COMMIT;
