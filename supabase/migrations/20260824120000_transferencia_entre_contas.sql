-- Transferência entre contas próprias.
--
-- O QUE FALTAVA
-- Mover dinheiro do Banco A para o Banco B só era possível à mão: uma despesa
-- lá, uma receita cá, digitadas separadamente. As duas linhas nasciam órfãs uma
-- da outra — nada as ligava, nada impedia editar uma sem a outra, e as duas
-- entravam no resultado. Uma transferência de R$ 50.000 virava R$ 50.000 de
-- despesa e R$ 50.000 de receita que nunca existiram.
--
-- O MODELO
-- Duas transações que são uma operação só, no mesmo molde que
-- `transacao_parcelamento` e `pagamento_multiplo` já usam: uma tabela-grupo, e
-- as duas linhas apontando para ela.
--
-- A tabela-grupo em vez de uma auto-referência porque NENHUMA DAS DUAS PERNAS É
-- SUBORDINADA À OUTRA. Uma FK `A -> B` teria de eleger uma dona, e a escolha
-- seria arbitrária; FKs mútuas seriam circulares no insert e travariam a
-- exclusão das duas.
--
-- O QUE JÁ FUNCIONAVA E FOI APROVEITADO
-- O saldo bancário não precisou de nada. `signedAmount`, em
-- src/app/api/bancos/resumo/route.ts, dá -X à DESPESA e +X à RECEITA: a conta de
-- origem cai, a de destino sobe, e o consolidado da empresa não se move. É
-- exatamente o que uma transferência tem que fazer.
--
-- O método de pagamento é escolhido por quem lança e não ganhou valor novo no
-- enum: a mesma transferência pode ser um Pix entre contas ou dinheiro passando
-- de um caixa para o outro, e o enum já tem os dois.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A operação
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.transacao_transferencia (
  id               bigserial PRIMARY KEY,
  valor            numeric(14,2) NOT NULL,
  data             timestamptz   NOT NULL,
  banco_origem_id  bigint NOT NULL REFERENCES public.bancoconta(id),
  banco_destino_id bigint NOT NULL REFERENCES public.bancoconta(id),
  metodopagamento  public.metodo_pagamento NOT NULL,
  descricao        text,
  criado_por       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transacao_transferencia_valor_positivo_check
    CHECK (valor > 0),
  CONSTRAINT transacao_transferencia_contas_distintas_check
    CHECK (banco_origem_id <> banco_destino_id)
);

COMMENT ON TABLE public.transacao_transferencia IS
  'Uma movimentacao de dinheiro entre duas contas proprias. As duas transacoes que a realizam apontam para esta linha por transferencia_id.';
COMMENT ON COLUMN public.transacao_transferencia.valor IS
  'Quanto saiu de uma conta e entrou na outra. E o mesmo numero nas duas pernas.';
COMMENT ON COLUMN public.transacao_transferencia.data IS
  'Quando o dinheiro mudou de conta. As duas pernas nascem liquidadas nesta data.';
COMMENT ON COLUMN public.transacao_transferencia.banco_origem_id IS
  'Conta de onde o dinheiro saiu. Recebe a perna de DESPESA.';
COMMENT ON COLUMN public.transacao_transferencia.banco_destino_id IS
  'Conta para onde o dinheiro foi. Recebe a perna de RECEITA.';
COMMENT ON COLUMN public.transacao_transferencia.metodopagamento IS
  'Como o dinheiro andou: Pix entre contas, TED, dinheiro de um caixa para o outro. Escolhido por quem lanca; vale para as duas pernas.';
COMMENT ON COLUMN public.transacao_transferencia.criado_por IS
  'Quem registrou a transferencia. Vem da sessao, nunca do corpo da requisicao.';

-- ---------------------------------------------------------------------------
-- 2) O vínculo, nas duas pernas
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS transferencia_id bigint
    REFERENCES public.transacao_transferencia(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.transacao.transferencia_id IS
  'Transferencia entre contas de que esta linha e uma das pernas. Nula em lancamento comum. Escrita somente por registrar_transferencia_entre_contas; nao preencher a mao.';

CREATE INDEX IF NOT EXISTS transacao_transferencia_id_idx
  ON public.transacao (transferencia_id)
  WHERE transferencia_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Categoria de sistema
-- ---------------------------------------------------------------------------
--
-- Sem uma categoria propria as duas pernas cairiam em "NAO RELACIONADO" e se
-- perderiam no meio dos avulsos. Mesma ideia — e mesma forma idempotente e
-- conservadora — das categorias de venda, OS e antecipacao: se ja houver uma
-- categoria chamada TRANSFERENCIA criada a mao, ela e adotada em vez de
-- duplicada. O indice unico parcial em codigo_sistema garante que exista uma so.

DO $$
DECLARE
  v_id integer;
BEGIN
  SELECT id INTO v_id
    FROM public.categoriatransacao
   WHERE codigo_sistema = 'TRANSFERENCIA'
   ORDER BY id
   LIMIT 1;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.categoriatransacao
     WHERE upper(btrim(nome)) IN ('TRANSFERENCIA', 'TRANSFERÊNCIA',
                                  'TRANSFERENCIA ENTRE CONTAS',
                                  'TRANSFERÊNCIA ENTRE CONTAS')
     ORDER BY id
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.categoriatransacao
      (nome, descricao, icone, ativo, codigo_sistema, createdat, updatedat)
    VALUES
      ('TRANSFERÊNCIA',
       'Categoria de sistema para transferências entre contas próprias.',
       'arrow-left-right', true, 'TRANSFERENCIA', now(), now());
  ELSE
    UPDATE public.categoriatransacao
       SET codigo_sistema = 'TRANSFERENCIA',
           ativo = true,
           updatedat = now()
     WHERE id = v_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Registrar: tudo ou nada
-- ---------------------------------------------------------------------------
--
-- E RPC pelo mesmo motivo que `baixar_por_adiantamento` e: MEIA TRANSFERENCIA E
-- DINHEIRO EVAPORADO. Se a segunda linha falhasse depois da primeira, o saldo da
-- empresa encolheria sozinho e ninguem descobriria por onde.

CREATE OR REPLACE FUNCTION public.registrar_transferencia_entre_contas(
  p_valor numeric,
  p_data timestamp with time zone,
  p_banco_origem_id bigint,
  p_banco_destino_id bigint,
  p_metodopagamento text,
  p_descricao text DEFAULT NULL,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_criado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_metodo public.metodo_pagamento;
  v_valor numeric(14,2);
  v_origem text;
  v_destino text;
  v_categoria_id integer;
  v_transferencia_id bigint;
  v_saida_id bigint;
  v_entrada_id bigint;
  v_descricao text;
BEGIN
  IF p_valor IS NULL OR round(p_valor, 2) <= 0 THEN
    RAISE EXCEPTION 'O valor da transferência deve ser maior que zero.'
      USING ERRCODE = '22023';
  END IF;
  v_valor := round(p_valor, 2);

  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Data da transferência obrigatória.' USING ERRCODE = '22023';
  END IF;

  IF p_banco_origem_id IS NULL OR p_banco_destino_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta de origem e a de destino.' USING ERRCODE = '22023';
  END IF;

  IF p_banco_origem_id = p_banco_destino_id THEN
    RAISE EXCEPTION
      'A conta de origem e a de destino são a mesma: não há transferência a registrar.'
      USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(p_metodopagamento), '') IS NULL THEN
    RAISE EXCEPTION 'Método de pagamento obrigatório.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_metodo := btrim(p_metodopagamento)::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Método de pagamento inválido: %.', btrim(p_metodopagamento)
      USING ERRCODE = '22023';
  END;

  SELECT titulo INTO v_origem FROM public.bancoconta WHERE id = p_banco_origem_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de origem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT titulo INTO v_destino FROM public.bancoconta WHERE id = p_banco_destino_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta de destino não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  v_origem := coalesce(nullif(btrim(v_origem), ''), 'conta #' || p_banco_origem_id);
  v_destino := coalesce(nullif(btrim(v_destino), ''), 'conta #' || p_banco_destino_id);
  v_descricao := nullif(btrim(coalesce(p_descricao, '')), '');

  SELECT id INTO v_categoria_id
    FROM public.categoriatransacao WHERE codigo_sistema = 'TRANSFERENCIA' LIMIT 1;

  INSERT INTO public.transacao_transferencia
    (valor, data, banco_origem_id, banco_destino_id, metodopagamento,
     descricao, criado_por)
  VALUES
    (v_valor, p_data, p_banco_origem_id, p_banco_destino_id, v_metodo,
     v_descricao, p_criado_por)
  RETURNING id INTO v_transferencia_id;

  /*
   * As duas pernas carregam os MESMOS valor, data, método e vínculo. O que muda
   * é só o sentido, a conta e o texto — e é de propósito que seja tão pouco: o
   * gatilho de imutabilidade mais abaixo depende de as duas serem espelho uma da
   * outra para poder recusar qualquer edição que desfaça o par.
   *
   * `pendente = false` nas duas, sem opção de agendar: a transferência é fato
   * consumado quando alguém a registra. Um par pendente ficaria em A Pagar e em
   * A Receber ao mesmo tempo, com a empresa cobrando a si mesma.
   */

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido",
    valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento,
    categoria_id, plano_de_conta_id, centro_custo_id,
    transferencia_id, created_by, baixado_por
  ) VALUES (
    coalesce(v_descricao, 'Transferência para ' || v_destino),
    v_valor, v_valor, v_valor, 0, 0,
    p_data, p_data, p_data, p_data,
    'DESPESA'::public.tipos_transacao, false, p_banco_origem_id, v_metodo,
    v_categoria_id, p_plano_de_conta_id, p_centro_custo_id,
    v_transferencia_id, p_criado_por, p_criado_por
  ) RETURNING id INTO v_saida_id;

  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido",
    valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento,
    categoria_id, plano_de_conta_id, centro_custo_id,
    transferencia_id, created_by, baixado_por
  ) VALUES (
    coalesce(v_descricao, 'Transferência de ' || v_origem),
    v_valor, v_valor, v_valor, 0, 0,
    p_data, p_data, p_data, p_data,
    'RECEITA'::public.tipos_transacao, false, p_banco_destino_id, v_metodo,
    v_categoria_id, p_plano_de_conta_id, p_centro_custo_id,
    v_transferencia_id, p_criado_por, p_criado_por
  ) RETURNING id INTO v_entrada_id;

  RETURN jsonb_build_object(
    'transferencia_id', v_transferencia_id,
    'saida_id', v_saida_id,
    'entrada_id', v_entrada_id,
    'valor', v_valor,
    'banco_origem', v_origem,
    'banco_destino', v_destino
  );
END;
$function$;

ALTER FUNCTION public.registrar_transferencia_entre_contas(
  numeric, timestamp with time zone, bigint, bigint, text, text, integer, integer, uuid
) OWNER TO postgres;

COMMENT ON FUNCTION public.registrar_transferencia_entre_contas(
  numeric, timestamp with time zone, bigint, bigint, text, text, integer, integer, uuid
) IS
  'Move dinheiro entre duas contas proprias: grava a operacao e as duas pernas numa transacao so. A perna de saida e DESPESA na origem, a de entrada e RECEITA no destino, ambas liquidadas e fora do resultado.';

-- ---------------------------------------------------------------------------
-- 5) Uma perna não muda sozinha
-- ---------------------------------------------------------------------------
--
-- Editar o valor de um lado desmonta a transferencia em silencio: o saldo de uma
-- conta muda e o da outra nao, e a diferenca so aparece semanas depois, na
-- conciliacao, sem pista de onde veio.
--
-- Classificacao continua livre — descricao, plano de conta e centro de custo sao
-- como a empresa organiza o lancamento, nao o dinheiro em si.

CREATE OR REPLACE FUNCTION public.tg_transacao_transferencia_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.transferencia_id IS NULL AND OLD.transferencia_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.transferencia_id IS DISTINCT FROM OLD.transferencia_id THEN
    RAISE EXCEPTION
      'O vínculo da transferência não se edita: ele nasce com as duas pernas e some com elas.'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.valor IS DISTINCT FROM OLD.valor
     OR NEW."valorLiquido" IS DISTINCT FROM OLD."valorLiquido"
     OR NEW.valor_base IS DISTINCT FROM OLD.valor_base
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.banco_id IS DISTINCT FROM OLD.banco_id
     OR NEW.pendente IS DISTINCT FROM OLD.pendente THEN
    RAISE EXCEPTION
      'Esta linha é uma das pernas da transferência #% e não muda sozinha — o valor dela é o mesmo da outra conta. Para corrigir, exclua a transferência e refaça.',
      OLD.transferencia_id
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.tg_transacao_transferencia_imutavel() OWNER TO postgres;

DROP TRIGGER IF EXISTS transacao_transferencia_imutavel_trg ON public.transacao;
CREATE TRIGGER transacao_transferencia_imutavel_trg
BEFORE UPDATE ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_transacao_transferencia_imutavel();

-- ---------------------------------------------------------------------------
-- 6) Fora do resultado
-- ---------------------------------------------------------------------------
--
-- A parte obrigatoria. Sem ela uma transferencia de R$ 50.000 vira R$ 50.000 de
-- despesa e R$ 50.000 de receita no DRE do mes — dinheiro que so trocou de
-- bolso, contado como se a empresa tivesse gastado e faturado.
--
-- A heuristica de 20260802180000 ja marca `exclui_do_resultado` em grupo de
-- plano de contas cujo nome contenha "transferenc". Mas ela e um seed de uma vez,
-- depende de o usuario ter criado o grupo com esse nome e nao pega grupos
-- criados depois. Nao da para depender dela: a exclusao pela coluna e a regra, e
-- a heuristica vira redundancia inofensiva.
--
-- Corpo identico ao de 20260819130000, com uma linha a mais na lista de
-- exclusoes incondicionais.

CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_transacao(p_transacaoid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tx public.transacao%ROWTYPE;
  v_linha_id integer;
  v_exclui boolean := false;
  v_natureza text;
  v_natureza_dre text;
begin
  select * into v_tx from public.transacao where id = p_transacaoid;
  if not found then return; end if;

  if v_tx.is_deleted
     or v_tx.evento_financeiro_id is not null
     or v_tx.ordemservicoid is not null
     or v_tx.vendaid is not null
     or v_tx.entrada_id is not null
     or v_tx.usoconsumo_entrada_id is not null
     or v_tx.origem = 'ORIGEM_MIGRACAO'
     or coalesce(v_tx.eh_adiantamento, false)
     or v_tx.adiantamento_id is not null
     or v_tx.baixa_de_transacao_id is not null
     or v_tx.transferencia_id is not null
     or upper(v_tx.tipo::text) in ('SAQUE', 'DEPOSITO') then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  select mp.linha_id, mp.exclui_do_resultado
    into v_linha_id, v_exclui
    from public.planosdeconta pc
    join public.dre_mapeamento mp
      on mp.origem_tipo = 'PLANO_GRUPO' and mp.origem_id = pc.grupo_id and mp.ativo
   where pc.id = v_tx.plano_de_conta_id
   limit 1;

  if coalesce(v_exclui, false) then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  v_natureza := case when upper(v_tx.tipo::text) = 'RECEITA' then 'RECEITA' else 'DESPESA' end;

  select dl.natureza_dre into v_natureza_dre
    from public.dre_linha dl where dl.id = v_linha_id;

  v_natureza_dre := coalesce(v_natureza_dre,
    case when v_natureza = 'RECEITA' then 'RECEITA' else 'DESPESA' end);

  update public.eventos_financeiros
     set natureza = v_natureza, updated_at = now()
   where source_type = 'TRANSACAO'
     and source_id = p_transacaoid
     and status <> 'CONVERTIDO'
     and natureza is distinct from v_natureza;

  insert into public.eventos_financeiros
    (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, competencia_em, dre_linha_id,
     centro_custo_id, transacaoid, dados_snapshot, pode_gerar_transacao, status)
  values
    (null, 'TRANSACAO', p_transacaoid, 'AVULSO', v_natureza, v_natureza_dre,
     'TRANSACAO', coalesce(nullif(v_tx.descricao, ''), 'Lancamento #' || p_transacaoid),
     nullif(v_tx.plano_de_conta, ''), round(coalesce(v_tx.valor, 0), 2),
     coalesce(v_tx.competencia_em, v_tx.data), v_linha_id,
     v_tx.centro_custo_id, p_transacaoid,
     jsonb_build_object('categoria', v_tx.categoria, 'sem_classificacao', v_linha_id is null),
     false, 'ATIVO')
  on conflict (source_type, source_id, origem, chave_origem, natureza)
    where ordemservicoid is null
  do update set valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                competencia_em = excluded.competencia_em,
                dre_linha_id = excluded.dre_linha_id,
                natureza_dre = excluded.natureza_dre,
                centro_custo_id = excluded.centro_custo_id,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  where public.eventos_financeiros.status <> 'CONVERTIDO';
end;
$function$;

COMMENT ON FUNCTION public.sincronizar_eventos_financeiros_transacao(bigint) IS
  'Evento de resultado de uma transacao avulsa. Ignora o que e liquidacao de algo ja reconhecido (OS, venda, evento, baixa parcial), compra que vira estoque, saldo de abertura migrado, antecipacao de recebiveis, transferencia entre contas proprias e movimentacao de tesouraria.';

-- `transferencia_id` precisa estar no UPDATE OF. Sem isso, mudar so essa coluna
-- nao redispara a sincronizacao — e o passo que passa despercebido.
DROP TRIGGER IF EXISTS trg_eventos_financeiros_transacao ON public.transacao;
CREATE TRIGGER trg_eventos_financeiros_transacao
AFTER INSERT OR UPDATE OF
  valor, tipo, competencia_em, data, plano_de_conta_id, centro_custo_id,
  is_deleted, descricao, origem, pagamento_multiplo_id,
  eh_adiantamento, adiantamento_id, baixa_de_transacao_id, transferencia_id
ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_transacao();

COMMIT;
