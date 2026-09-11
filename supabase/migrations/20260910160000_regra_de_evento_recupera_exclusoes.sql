-- A regra unica de "esta transacao gera evento de resultado?" recupera as seis
-- exclusoes que perdeu, e a sincronizacao recupera o realinhamento de natureza.
--
-- O SINTOMA
-- Abrir a transacao #2122 do Demir (DEPOSITO de R$ 400,00), trocar categoria,
-- plano de conta ou centro de custo e salvar devolvia "Violacao de unicidade
-- (ja cadastrado)". Nada no dialogo nem na rota estava errado: o 23505 vinha do
-- gatilho `trg_eventos_financeiros_transacao`, no indice
-- `idx_eventos_financeiros_transacao_avulso_uk`.
--
-- O QUE ACONTECEU
-- A 20260908160000 tirou a lista de exclusoes de dentro de
-- `sincronizar_eventos_financeiros_transacao` e a transformou em
-- `transacao_gera_evento_de_resultado`, para que a fila de pendencias e a
-- sincronizacao respondessem a MESMA pergunta — isso continua certo. O que
-- falhou foi a copia: ela dizia "comportamento identico ao da 20260805200000",
-- mas a versao em vigor era a da 20260828170000, com seis condicoes a mais.
-- Ficaram de fora:
--
--   pagamento_multiplo_id, baixa_de_transacao_id, transferencia_id,
--   eh_adiantamento, adiantamento_id e tipo IN ('SAQUE', 'DEPOSITO')
--
-- (`lancamento_id`, a setima, ja voltou pela 20260909125000, pelo mesmo motivo
-- e no mesmo lugar. Duas correcoes do mesmo esquecimento em dois dias dizem que
-- o conjunto precisa de teste, nao de mais uma leitura atenta — o teste de
-- `pendencias_e_migracao_classificacao` passa a cobrir cada condicao.)
--
-- POR QUE ISSO VIRA ERRO DE UNICIDADE
-- Sem a exclusao, o deposito chega ao upsert. A natureza e calculada do tipo
-- (so RECEITA vira RECEITA; deposito cai no ELSE e vira DESPESA), enquanto o
-- evento que ja existe para a transacao e RECEITA. Como `natureza` faz parte da
-- chave do `on conflict`, o upsert nao reconhece a linha existente e tenta
-- INSERT — e o indice unico por `transacaoid` recusa a segunda linha.
--
-- A 20260825140000 tinha escrito um `update` de realinhamento de natureza
-- exatamente para esse caso, e a 20260908160000 o levou junto. Ele volta aqui,
-- e nao so pelo deposito: numa transacao avulsa comum o usuario PODE trocar o
-- tipo de RECEITA para DESPESA, e esse caminho da o mesmo 23505.
--
-- O QUE ISSO JA FEZ COM A DRE — MEDIDO EM 10/09/2026
-- O erro na tela era o caso benigno: barulho, mas nada gravado. O caso grave e
-- o que salvou em silencio, porque a natureza batia:
--
--   Demir:   4 eventos ATIVOS indevidos, R$ 43.539,56 — duas antecipacoes de
--            recebiveis como RECEITA (R$ 43.132,50), um saque e o deposito do
--            reembolso dele lancados AMBOS como DESPESA na mesma linha.
--   Garage:  7 eventos ATIVOS indevidos, R$ 23.718,70 — seis pernas de tres
--            transferencias entre contas proprias e um saque.
--   Demo:    nenhum.
--
-- Um quinto evento do Demir (transacao #2668) saiu do conjunto sozinho entre
-- duas medicoes, no mesmo dia: enquanto isto nao for aplicado, editar qualquer
-- uma dessas transacoes muda o resultado do exercicio. Por isso o backfill
-- pergunta pelo estado no momento em que roda, em vez de listar ids.
--
-- UM CASO PARA O USUARIO, NAO PARA A MIGRATION
-- No Garage, a transacao #451 ("EXAME CLINICO ADMISSIONAL", R$ 50,00) e despesa
-- de verdade lancada como SAQUE. Ela sai do resultado aqui junto com o resto, e
-- e o comportamento correto: o conserto e trocar o tipo do lancamento para
-- DESPESA, na tela. Adivinhar pela descricao seria a DRE decidindo sozinha o
-- que e gasto e o que e tesouraria.
--
-- Alem desses, 84 transacoes no Demir e 5 no Garage estao sem evento e o
-- criariam na proxima edicao. O backfill no fim cancela o que entrou; o que
-- ainda nao entrou deixa de poder entrar.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A regra, com o conjunto inteiro
-- ---------------------------------------------------------------------------
-- Mesma estrutura da 20260909125000; o que muda e a lista. Cada condicao
-- responde a uma pergunta so: este dinheiro e fato novo, ou e o mesmo fato ja
-- reconhecido mudando de lugar?
CREATE OR REPLACE FUNCTION public.transacao_gera_evento_de_resultado(
  p_transacao_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx public.transacao%ROWTYPE;
  v_exclui boolean;
BEGIN
  SELECT * INTO v_tx FROM public.transacao WHERE id = p_transacao_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Liquidacao de algo ja reconhecido, compra que vira estoque, ou saldo de
  -- abertura trazido de outro sistema: nao e resultado novo.
  --
  -- `baixa_de_transacao_id` e a baixa parcial de um titulo que ja tem evento;
  -- `pagamento_multiplo_id`, a parcela que quita varios documentos de uma vez;
  -- `lancamento_id`, o boleto que quita despesas de OS. Os tres sao a mesma
  -- ideia do `evento_financeiro_id`, em formatos diferentes.
  --
  -- `eh_adiantamento` e `adiantamento_id` sao antecipacao de recebivel: o
  -- dinheiro chega antes, a receita ja foi (ou sera) reconhecida no documento.
  -- Contar os dois e faturar duas vezes.
  --
  -- SAQUE, DEPOSITO e `transferencia_id` sao tesouraria: dinheiro mudando de
  -- lugar entre o caixa e a conta da propria empresa. Nao dependem da conta do
  -- plano — um saque numa conta de despesa continua sendo saque. Quando um
  -- gasto de verdade for lancado como saque, o conserto e trocar o tipo do
  -- lancamento, nao fazer a DRE adivinhar.
  IF v_tx.is_deleted
     OR v_tx.evento_financeiro_id IS NOT NULL
     OR v_tx.lancamento_id IS NOT NULL
     OR v_tx.pagamento_multiplo_id IS NOT NULL
     OR v_tx.baixa_de_transacao_id IS NOT NULL
     OR v_tx.ordemservicoid IS NOT NULL
     OR v_tx.vendaid IS NOT NULL
     OR v_tx.entrada_id IS NOT NULL
     OR v_tx.usoconsumo_entrada_id IS NOT NULL
     OR v_tx.origem = 'ORIGEM_MIGRACAO'
     OR coalesce(v_tx.eh_adiantamento, false)
     OR v_tx.adiantamento_id IS NOT NULL
     OR v_tx.transferencia_id IS NOT NULL
     OR upper(v_tx.tipo::text) IN ('SAQUE', 'DEPOSITO') THEN
    RETURN false;
  END IF;

  -- Grupo marcado para ficar fora do resultado. O `limit 1` e o mesmo criterio
  -- da sincronizacao: mais de um mapeamento ativo por grupo ja e barrado pelo
  -- indice unico parcial.
  SELECT mp.exclui_do_resultado
    INTO v_exclui
    FROM public.planosdeconta pc
    JOIN public.dre_mapeamento mp
      ON mp.origem_tipo = 'PLANO_GRUPO' AND mp.origem_id = pc.grupo_id AND mp.ativo
   WHERE pc.id = v_tx.plano_de_conta_id
   LIMIT 1;

  RETURN NOT coalesce(v_exclui, false);
END;
$function$;

COMMENT ON FUNCTION public.transacao_gera_evento_de_resultado(bigint) IS
  'Verdadeiro quando a transacao deve gerar evento financeiro proprio. Regra unica, usada pela sincronizacao e pela fila de pendencias. Ficam de fora: liquidacao de algo ja reconhecido (evento, lancamento de eventos, pagamento multiplo, baixa parcial, OS, venda, entrada, uso e consumo), carga de migracao, antecipacao de recebivel, tesouraria (saque, deposito e transferencia entre contas proprias) e conta em grupo excluido do resultado.';

-- ---------------------------------------------------------------------------
-- 2) A sincronizacao recupera o realinhamento de natureza
-- ---------------------------------------------------------------------------
-- Identica a versao em vigor, com o `update` da 20260825140000 de volta antes
-- do upsert. Ele existe porque `natureza` faz parte da chave do `on conflict`:
-- quando a natureza da transacao muda, o upsert nao reconheceria a linha
-- existente e tentaria inserir uma segunda, batendo no indice unico por
-- `transacaoid`. Realinhar antes deixa o upsert seguir normalmente.
--
-- Vale para qualquer status menos CONVERTIDO — inclusive CANCELADO: um evento
-- cancelado com a natureza antiga bloqueia a reinsercao do mesmo jeito.
CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_transacao(p_transacaoid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tx public.transacao%ROWTYPE;
  v_linha_id integer;
  v_natureza text;
  v_natureza_dre text;
begin
  select * into v_tx from public.transacao where id = p_transacaoid;
  if not found then return; end if;

  -- Nao e fato novo. Se ja existir evento (a transacao foi religada, ou o grupo
  -- dela passou a ser excluido do resultado), cancela o que houver e encerra.
  if not public.transacao_gera_evento_de_resultado(p_transacaoid) then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'TRANSACAO' and source_id = p_transacaoid and status = 'ATIVO';
    return;
  end if;

  select mp.linha_id
    into v_linha_id
    from public.planosdeconta pc
    join public.dre_mapeamento mp
      on mp.origem_tipo = 'PLANO_GRUPO' and mp.origem_id = pc.grupo_id and mp.ativo
   where pc.id = v_tx.plano_de_conta_id
   limit 1;

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
  'Evento de resultado de uma transacao avulsa. Quem decide se ha evento e transacao_gera_evento_de_resultado; aqui fica o que gravar. Realinha a natureza antes do upsert porque ela faz parte da chave do on conflict.';

-- ---------------------------------------------------------------------------
-- 3) Backfill: cancelar o que entrou no resultado sem dever
-- ---------------------------------------------------------------------------
-- So o que ESTA correcao religou, e so em ATIVO. Nao mexe em CONVERTIDO nem em
-- evento de OS ou venda: a condicao repete, item a item, as seis exclusoes
-- perdidas, para que o alcance do backfill seja o mesmo do defeito.
--
-- Cancelar (e nao apagar) mantem o rastro: o evento continua consultavel, fora
-- de todos os totais, como sempre foi o tratamento de evento que nao vale.
DO $backfill$
DECLARE
  v_cancelados integer;
BEGIN
  UPDATE public.eventos_financeiros e
     SET status = 'CANCELADO', updated_at = now()
   WHERE e.status = 'ATIVO'
     AND e.source_type = 'TRANSACAO'
     AND EXISTS (
       SELECT 1 FROM public.transacao t
        WHERE t.id = e.source_id
          AND (t.pagamento_multiplo_id IS NOT NULL
            OR t.baixa_de_transacao_id IS NOT NULL
            OR t.transferencia_id IS NOT NULL
            OR coalesce(t.eh_adiantamento, false)
            OR t.adiantamento_id IS NOT NULL
            OR upper(t.tipo::text) IN ('SAQUE', 'DEPOSITO')));

  GET DIAGNOSTICS v_cancelados = ROW_COUNT;
  RAISE NOTICE 'Eventos de tesouraria, antecipacao e liquidacao cancelados: %.', v_cancelados;
END
$backfill$;

NOTIFY pgrst, 'reload schema';
COMMIT;
