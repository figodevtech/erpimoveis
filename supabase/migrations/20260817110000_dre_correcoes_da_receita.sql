-- DRE — as tres correcoes apontadas pela conferencia da receita (17/08/2026).
--
-- A conferencia esta em `supabase/tests/checar_receitas_dre.sql` e documentada
-- na secao 7 de `docs/dre.md`. Rodada nos quatro bancos, ela achou tres coisas.
-- As duas primeiras sao codigo e continuam acontecendo; a terceira e dado
-- historico e para de crescer sozinha.
--
-- ----------------------------------------------------------------- PARTE 1
-- ANTECIPACAO DE RECEBIVEIS ENTRA COMO RECEITA
--
-- Antecipar recebiveis e operacao de credito sobre titulos cuja receita ja foi
-- reconhecida na OS ou na venda. Nada de novo acontece no resultado: muda so
-- *quando* o dinheiro entra no caixa. A unica despesa nova e o desagio.
--
-- `sincronizar_eventos_financeiros_transacao` ignora transacao que aponta para
-- OS, venda, entrada, evento financeiro ou migracao — todas liquidacoes de algo
-- ja reconhecido. A antecipacao nao aponta para nenhum deles: ela se liga aos
-- titulos por `adiantamento_id` nas transacoes filhas, um vinculo que a lista
-- nao conhecia. Entao virava um evento AVULSO:RECEITA.
--
-- No Demir sao R$ 50.969,70 em 3 lancamentos; no Demonstracao, R$ 507,05 em 2.
-- E o destino e pior que a duplicacao: como a linha vem do plano de contas,
-- duas delas caem em "Antecipacao de recebiveis" -> 10.2 Despesas financeiras,
-- e um evento de natureza RECEITA passa a SOMAR R$ 47.200,80 dentro de uma
-- linha de despesa. O unico numero que pertence a 10.2 — o desagio, R$ 2.598,05
-- na transacao #1355 — nao vira lancamento nenhum.
--
-- Os dois lados do vinculo entram na exclusao, por motivos diferentes:
--   `eh_adiantamento`    e a antecipacao em si — financiamento, nao receita;
--   `adiantamento_id`    e o titulo quitado por ela — baixa de algo reconhecido.
--
-- ----------------------------------------------------------------- PARTE 2
-- FRETE DE VENDA NAO VIRA RECEITA
--
-- `sincronizar_eventos_financeiros_venda` e de 02/08 e nunca foi redefinida.
-- Monta receita por `vendaproduto.sub_total` e deducao pelo desconto, e nao
-- conhece frete algum — mas `venda.valor_frete` existe desde a 20260729160000,
-- tres dias ANTES dela, e `vendaproduto.valor_frete` desde a 20260815115000.
--
-- O lado da OS teve o mesmo defeito e foi corrigido em 09/08, com a origem
-- FRETE e o mapeamento FRETE:RECEITA -> 1.3. A venda ficou de fora: a mesma
-- assimetria que a 20260802200000 eliminou foi recriada, agora invertida.
--
-- Na venda #63 do Demir o cliente pagou R$ 6.198,39 e a DRE enxerga R$ 6.000,00.
--
-- A formula fica `bruto - desconto + frete = valortotal`, a mesma da OS.
-- Conferida contra todas as vendas reconhecidas do Demir e do Demonstracao
-- antes de escrever isto: nenhuma foge dela.
--
-- ---------------------------------------------------------------- PARTE 2b
-- ITEM REMOVIDO DA VENDA DEIXA O EVENTO PARA TRAS
--
-- Achado ao testar a parte 2, e ele estava escondendo justamente o defeito do
-- frete. `sincronizar_eventos_financeiros_venda` faz upsert dos itens que
-- existem e nunca encerra o evento de um item que saiu da venda — ao contrario
-- do lado da OS, onde `reconciliar` monta o conjunto desejado e cancela o que
-- sobra. O gatilho de `vendaproduto` chama a sincronizacao no AFTER DELETE,
-- mas a funcao nao tinha o que fazer com a informacao.
--
-- Na venda #56 do Demir sobrou um evento de R$ 180,00 de um produto que nao
-- esta mais na venda. Como o frete dela tambem e R$ 180,00, os dois erros se
-- anulavam e a venda parecia fechar. Corrigir so o frete teria transformado um
-- acerto por acaso em divergencia visivel — e e por isso que os dois andam
-- juntos nesta migration.
--
-- ----------------------------------------------------------------- PARTE 3
-- DESCONTO SUBTRAIDO DUAS VEZES EM OS ANTIGA
--
-- Nao e defeito de codigo — o codigo atual esta certo. Ate a 20260802200000 o
-- evento de receita da OS guardava o valor LIQUIDO e nao havia evento de
-- desconto. Depois dela o evento guarda o valor de TABELA e o desconto vira
-- evento proprio. Quando a 20260809120000 passou a emitir DESCONTO calculado
-- sobre o bruto dos itens, os eventos antigos — que ja tinham o desconto
-- embutido — passaram a receber o desconto uma segunda vez:
--
--   OS #151   itens a preco de tabela   R$ 3.800,00
--             evento de receita         R$ 3.610,00   <- liquido, versao antiga
--             evento de desconto        R$   190,00   <- calculado sobre o bruto
--             liquido na DRE            R$ 3.420,00   <- deveria ser 3.610,00
--
-- Nenhuma migration reescreve evento existente, por decisao explicita da
-- 20260811210000. Aqui a reescrita e o objetivo, entao ela e feita pela unica
-- via segura: `reconciliar_eventos_financeiros_os`, que reconstroi o conjunto
-- com o codigo atual e ja sabe preservar CONVERTIDO.
--
-- So morde OS com desconto — 4 em toda a frota (Demir #151 e #152,
-- Demonstracao #65, AlphaGarage #19). O bloco procura pelo sintoma, nao pelos
-- ids, para valer em qualquer banco.

BEGIN;

-- =========================================================== PARTE 1
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

  -- Liquidacao de algo ja reconhecido, compra que vira estoque, saldo de
  -- abertura trazido de outro sistema, ou antecipacao de recebiveis: nao e
  -- resultado novo. Se ja existir evento (a transacao foi religada), encerra.
  --
  -- `eh_adiantamento` e a antecipacao em si: operacao de credito sobre titulos
  -- cuja receita ja foi reconhecida na OS ou na venda. `adiantamento_id` e o
  -- titulo quitado por ela — baixa, nao fato novo. Sem os dois, a antecipacao
  -- entrava como AVULSO:RECEITA e o mesmo dinheiro contava duas vezes.
  if v_tx.is_deleted
     or v_tx.evento_financeiro_id is not null
     or v_tx.ordemservicoid is not null
     or v_tx.vendaid is not null
     or v_tx.entrada_id is not null
     or v_tx.usoconsumo_entrada_id is not null
     or v_tx.origem = 'ORIGEM_MIGRACAO'
     or coalesce(v_tx.eh_adiantamento, false)
     or v_tx.adiantamento_id is not null then
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

  -- DEPOSITO e dinheiro entrando; SAQUE e dinheiro saindo. Ate aqui a regra era
  -- "RECEITA e entrada, todo o resto e saida", e um deposito virava despesa.
  -- Passou despercebido porque todo DEPOSITO/SAQUE do Demir cai em
  -- "Movimentacoes nao operacionais", que e excluido do resultado antes de
  -- chegar aqui. A primeira excecao — um rendimento de aplicacao lancado como
  -- DEPOSITO na conta "Rendimentos financeiros" — entrou como DESPESA dentro da
  -- linha 10.1 Receitas financeiras.
  v_natureza := case
    when upper(v_tx.tipo::text) in ('RECEITA', 'DEPOSITO') then 'RECEITA'
    else 'DESPESA'
  end;

  select dl.natureza_dre into v_natureza_dre
    from public.dre_linha dl where dl.id = v_linha_id;

  v_natureza_dre := coalesce(v_natureza_dre,
    case when v_natureza = 'RECEITA' then 'RECEITA' else 'DESPESA' end);

  -- `natureza` faz parte da chave do `on conflict`, e `idx_eventos_financeiros_
  -- transacao` garante no maximo um evento por transacao. Se a natureza mudou —
  -- foi o que aconteceu com os DEPOSITO acima —, o upsert nao reconheceria a
  -- linha existente e tentaria inserir uma segunda, batendo naquele indice.
  -- Realinhar antes deixa o upsert seguir pelo caminho normal.
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
  'Evento de resultado de uma transacao avulsa. Ignora o que e liquidacao de algo ja reconhecido (OS, venda, evento), compra que vira estoque, saldo de abertura migrado e antecipacao de recebiveis.';

-- Encerra os eventos que a versao anterior ja criou. Passa pela propria funcao
-- em vez de um UPDATE direto: se algum dia a regra mudar, o backfill acompanha.
DO $antecipacao$
DECLARE
  v_id bigint;
  v_encerrados int := 0;
BEGIN
  FOR v_id IN
    SELECT DISTINCT t.id
      FROM public.transacao t
      JOIN public.eventos_financeiros e
        ON e.source_type = 'TRANSACAO' AND e.source_id = t.id AND e.status = 'ATIVO'
     WHERE coalesce(t.eh_adiantamento, false) OR t.adiantamento_id IS NOT NULL
  LOOP
    PERFORM public.sincronizar_eventos_financeiros_transacao(v_id);
    v_encerrados := v_encerrados + 1;
  END LOOP;

  RAISE NOTICE 'Parte 1: % transacao(oes) de antecipacao reprocessada(s).', v_encerrados;
END $antecipacao$;

-- Reprocessa os DEPOSITO/SAQUE que chegaram a gerar evento, para que a natureza
-- corrigida acima valha tambem para o que ja esta gravado. Quem cai em grupo
-- excluido do resultado nunca gerou evento e nao aparece aqui.
DO $deposito$
DECLARE
  v_id bigint;
  v_n int := 0;
BEGIN
  FOR v_id IN
    SELECT DISTINCT t.id
      FROM public.transacao t
      JOIN public.eventos_financeiros e
        ON e.source_type = 'TRANSACAO' AND e.source_id = t.id AND e.status = 'ATIVO'
     WHERE upper(t.tipo::text) IN ('DEPOSITO', 'SAQUE')
  LOOP
    PERFORM public.sincronizar_eventos_financeiros_transacao(v_id);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'Parte 1b: % DEPOSITO/SAQUE com evento reprocessado(s).', v_n;
END $deposito$;

-- =========================================================== PARTE 1c
-- EXCLUIR A TRANSACAO NAO TIRAVA O LANCAMENTO DA DRE
--
-- `trg_eventos_financeiros_transacao` e AFTER INSERT OR UPDATE — sem DELETE. A
-- exclusao pela tela do financeiro e fisica (`DELETE`, nao `is_deleted`), e a FK
-- `eventos_financeiros.transacaoid` e ON DELETE SET NULL: a transacao some, o
-- evento fica ATIVO, continua somando na linha, e o drill-down passa a apontar
-- para um registro que nao existe mais.
--
-- Verificado no Demir: 2 eventos nessa situacao, R$ 13,35, um deles em
-- 6.3 Despesas com pessoal. Valor pequeno, mecanismo permanente.
--
-- A mesma recriacao acrescenta `eh_adiantamento` e `adiantamento_id` a lista de
-- colunas observadas. Sem elas, a regra da parte 1 nao reagia quando o vinculo
-- era criado *depois* — e e exatamente assim que funciona a baixa por
-- antecipacao, que carimba `adiantamento_id` num titulo que ja existia.

CREATE OR REPLACE FUNCTION public.tg_eventos_financeiros_transacao_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  -- Encerra, nao apaga: o livro guarda o que existiu. CONVERTIDO fica de fora
  -- pela mesma razao de sempre — virou transacao e cabe ao financeiro estornar.
  update public.eventos_financeiros
     set status = 'CANCELADO', updated_at = now()
   where source_type = 'TRANSACAO'
     and source_id = old.id
     and status = 'ATIVO';

  return old;
end;
$function$;

DROP TRIGGER IF EXISTS trg_eventos_financeiros_transacao_delete ON public.transacao;
CREATE TRIGGER trg_eventos_financeiros_transacao_delete
AFTER DELETE ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_transacao_delete();

DROP TRIGGER IF EXISTS trg_eventos_financeiros_transacao ON public.transacao;
CREATE TRIGGER trg_eventos_financeiros_transacao
AFTER INSERT OR UPDATE OF
  valor, tipo, competencia_em, data, plano_de_conta_id, centro_custo_id,
  is_deleted, descricao, origem, pagamento_multiplo_id,
  eh_adiantamento, adiantamento_id
ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_transacao();

-- Encerra os que ja ficaram orfaos antes de o gatilho existir.
DO $orfaos$
DECLARE v_n int;
BEGIN
  UPDATE public.eventos_financeiros e
     SET status = 'CANCELADO', updated_at = now()
   WHERE e.source_type = 'TRANSACAO'
     AND e.status = 'ATIVO'
     AND NOT EXISTS (SELECT 1 FROM public.transacao t WHERE t.id = e.source_id);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Parte 1c: % evento(s) de transacao excluida encerrado(s).', v_n;
END $orfaos$;

-- =========================================================== PARTE 2
CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_venda(p_vendaid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_venda public.venda%ROWTYPE;
  v_competencia timestamptz;
  v_desconto numeric(14,2);
  v_frete numeric(14,2);
begin
  select * into v_venda from public.venda where id = p_vendaid;
  if not found then return; end if;

  -- Venda que deixou de ser reconhecida (cancelada, revertida a orcamento):
  -- encerra os eventos em vez de apaga-los. CONVERTIDO e preservado — virou
  -- transacao e cabe ao financeiro estornar.
  if not public.venda_reconhece_receita(v_venda.status::text) then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'VENDA' and source_id = p_vendaid and status = 'ATIVO';
    return;
  end if;

  v_competencia := coalesce(v_venda.datavenda, v_venda.createdat, now());

  -- Receita bruta por item, pelo valor de tabela.
  insert into public.eventos_financeiros
    (ordemservicoid, source_type, source_id, source_item_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, produtoid, quantidade_snapshot,
     valor_unitario_snapshot, competencia_em, dados_snapshot, pode_gerar_transacao)
  select null, 'VENDA', p_vendaid, vp.id, 'PRODUTO', 'RECEITA', 'RECEITA',
         vp.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || vp.produtoid),
         vp.quantidade || ' unidade(s)',
         round(coalesce(vp.sub_total, 0), 2),
         vp.produtoid, vp.quantidade,
         case when coalesce(vp.quantidade, 0) > 0
              then round(coalesce(vp.sub_total, 0) / vp.quantidade, 4) else 0 end,
         v_competencia,
         jsonb_build_object('venda_item_id', vp.id, 'valor_liquido_item', vp.valor_total),
         false
    from public.vendaproduto vp
    join public.produto p on p.id = vp.produtoid
   where vp.venda_id = p_vendaid
  on conflict (source_type, source_id, origem, chave_origem, natureza)
    where ordemservicoid is null
  do update set valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                quantidade_snapshot = excluded.quantidade_snapshot,
                valor_unitario_snapshot = excluded.valor_unitario_snapshot,
                competencia_em = excluded.competencia_em,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  where public.eventos_financeiros.status <> 'CONVERTIDO';

  -- Custo da mercadoria vendida, pelo custo congelado na venda.
  insert into public.eventos_financeiros
    (ordemservicoid, source_type, source_id, source_item_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, produtoid, quantidade_snapshot,
     valor_unitario_snapshot, competencia_em, dados_snapshot, pode_gerar_transacao)
  select null, 'VENDA', p_vendaid, vp.id, 'PRODUTO', 'DESPESA', 'CUSTO',
         vp.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || vp.produtoid),
         case when coalesce(vp.custo_unitario_aplicado, 0) = 0
              then 'Custo nao informado — margem superestimada'
              else 'Custo registrado na venda' end,
         round(coalesce(vp.custo_unitario_aplicado, 0) * coalesce(vp.quantidade, 0), 2),
         vp.produtoid, vp.quantidade, coalesce(vp.custo_unitario_aplicado, 0),
         v_competencia,
         -- Zero conta como nao informado: tratar isso como custo real produziria
         -- 100% de margem em produto. A tela de pendencias usa esta flag.
         jsonb_build_object('custo_nao_informado', coalesce(vp.custo_unitario_aplicado, 0) = 0),
         false
    from public.vendaproduto vp
    join public.produto p on p.id = vp.produtoid
   where vp.venda_id = p_vendaid
  on conflict (source_type, source_id, origem, chave_origem, natureza)
    where ordemservicoid is null
  do update set valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                quantidade_snapshot = excluded.quantidade_snapshot,
                valor_unitario_snapshot = excluded.valor_unitario_snapshot,
                competencia_em = excluded.competencia_em,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  where public.eventos_financeiros.status <> 'CONVERTIDO';

  -- Item que saiu da venda: encerra o evento em vez de deixa-lo para sempre.
  -- Os dois upserts acima so alcancam o que existe hoje; sem isto, remover um
  -- item da venda mantinha a receita e o custo dele no livro. CONVERTIDO fica —
  -- virou transacao e cabe ao financeiro estornar.
  update public.eventos_financeiros e
     set status = 'CANCELADO', updated_at = now()
   where e.source_type = 'VENDA'
     and e.source_id = p_vendaid
     and e.origem = 'PRODUTO'
     and e.status = 'ATIVO'
     and not exists (
       select 1 from public.vendaproduto vp
        where vp.venda_id = p_vendaid
          and vp.produtoid::text = e.chave_origem);

  -- Frete: receita da atividade, igual ao lado da OS. Soma o cobrado na venda
  -- com o atribuido item a item — sao campos distintos e podem coexistir.
  -- Sem isto, `bruto - desconto` da o total da venda MENOS o frete, e o que o
  -- cliente pagou de frete nao existe em lugar nenhum do livro.
  select round(coalesce(sum(coalesce(vp.valor_frete, 0)), 0), 2)
    into v_frete
    from public.vendaproduto vp
   where vp.venda_id = p_vendaid;

  v_frete := v_frete + round(coalesce(v_venda.valor_frete, 0), 2);

  if v_frete > 0 then
    insert into public.eventos_financeiros
      (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
       chave_origem, descricao, detalhe, valor, competencia_em, dados_snapshot, pode_gerar_transacao)
    values
      (null, 'VENDA', p_vendaid, 'FRETE', 'RECEITA',
       public.natureza_dre_de_evento('FRETE', 'RECEITA'),
       'FRETE', 'Frete - venda #' || p_vendaid,
       'Receita de frete da venda', v_frete, v_competencia,
       jsonb_build_object('frete_venda', round(coalesce(v_venda.valor_frete, 0), 2),
                          'frete_itens', v_frete - round(coalesce(v_venda.valor_frete, 0), 2)),
       false)
    on conflict (source_type, source_id, origem, chave_origem, natureza)
      where ordemservicoid is null
    do update set valor = excluded.valor,
                  natureza_dre = excluded.natureza_dre,
                  competencia_em = excluded.competencia_em,
                  dados_snapshot = excluded.dados_snapshot,
                  status = 'ATIVO',
                  updated_at = now()
    where public.eventos_financeiros.status <> 'CONVERTIDO';
  else
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'VENDA' and source_id = p_vendaid
       and origem = 'FRETE' and status = 'ATIVO';
  end if;

  -- Desconto: soma o concedido item a item com o concedido na venda.
  select round(coalesce(sum(coalesce(vp.valor_desconto, 0)), 0), 2)
    into v_desconto
    from public.vendaproduto vp
   where vp.venda_id = p_vendaid;

  v_desconto := v_desconto + round(coalesce(v_venda.desconto_valor, 0), 2);

  if v_desconto > 0 then
    insert into public.eventos_financeiros
      (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
       chave_origem, descricao, detalhe, valor, competencia_em, dados_snapshot, pode_gerar_transacao)
    values
      (null, 'VENDA', p_vendaid, 'DESCONTO', 'DESPESA', 'DEDUCAO',
       'DESCONTO', 'Desconto concedido - venda #' || p_vendaid,
       'Deducao da receita bruta', v_desconto, v_competencia,
       jsonb_build_object('desconto_venda', v_venda.desconto_valor), false)
    on conflict (source_type, source_id, origem, chave_origem, natureza)
      where ordemservicoid is null
    do update set valor = excluded.valor,
                  competencia_em = excluded.competencia_em,
                  dados_snapshot = excluded.dados_snapshot,
                  status = 'ATIVO',
                  updated_at = now()
    where public.eventos_financeiros.status <> 'CONVERTIDO';
  else
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'VENDA' and source_id = p_vendaid
       and origem = 'DESCONTO' and status = 'ATIVO';
  end if;
end;
$function$;

COMMENT ON FUNCTION public.sincronizar_eventos_financeiros_venda(bigint) IS
  'Eventos de resultado de uma venda: receita bruta e custo por item, frete como receita da atividade e desconto como deducao. Fecha em bruto - desconto + frete = valortotal.';

-- O gatilho nao acordava quando so o frete mudava.
CREATE OR REPLACE FUNCTION public.tg_eventos_financeiros_venda()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then
    if public.venda_reconhece_receita(new.status::text) then
      perform public.sincronizar_eventos_financeiros_venda(new.id);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.valortotal is distinct from old.valortotal
     or new.desconto_valor is distinct from old.desconto_valor
     or new.valor_frete is distinct from old.valor_frete
     or new.datavenda is distinct from old.datavenda then
    perform public.sincronizar_eventos_financeiros_venda(new.id);
  end if;

  return new;
end;
$function$;

-- O mapeamento FRETE:RECEITA -> 1.3 ja veio com a 20260809120000, pelo lado da
-- OS. Repetido aqui porque a venda passa a depender dele e um banco onde
-- aquela insercao nao tenha pegado deixaria o frete fora de toda linha.
WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1)
INSERT INTO public.dre_mapeamento
  (template_id, linha_id, origem_tipo, origem_valor, percentual, observacao)
SELECT t.id, dl.id, 'EVENTO_ORIGEM', 'FRETE:RECEITA', 100,
       'Receita de frete cobrada em ordem de servico ou venda.'
  FROM t JOIN public.dre_linha dl ON dl.template_id = t.id AND dl.codigo = '1.3'
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento x
    WHERE x.template_id = t.id AND x.origem_tipo = 'EVENTO_ORIGEM'
      AND x.origem_valor = 'FRETE:RECEITA'
 );

-- Backfill de TODAS as vendas reconhecidas, nao so as que tem frete: o evento
-- orfao da parte 2b pode estar em qualquer uma, e so a sincronizacao completa
-- o encontra. Reprocessar e barato e idempotente.
DO $frete_venda$
DECLARE
  v_id bigint;
  v_n int := 0;
  v_frete int := 0;
  v_orfaos int := 0;
BEGIN
  SELECT count(*) INTO v_orfaos
    FROM public.eventos_financeiros e
   WHERE e.source_type = 'VENDA' AND e.origem = 'PRODUTO' AND e.status = 'ATIVO'
     AND NOT EXISTS (SELECT 1 FROM public.vendaproduto vp
                      WHERE vp.venda_id = e.source_id
                        AND vp.produtoid::text = e.chave_origem);

  FOR v_id IN
    SELECT v.id FROM public.venda v
     WHERE public.venda_reconhece_receita(v.status::text)
     ORDER BY v.id
  LOOP
    PERFORM public.sincronizar_eventos_financeiros_venda(v_id);
    v_n := v_n + 1;
  END LOOP;

  SELECT count(*) INTO v_frete
    FROM public.eventos_financeiros
   WHERE source_type = 'VENDA' AND origem = 'FRETE' AND status = 'ATIVO';

  RAISE NOTICE 'Parte 2: % venda(s) reprocessada(s), % com evento de frete.', v_n, v_frete;
  RAISE NOTICE 'Parte 2b: % evento(s) de item removido encerrado(s).', v_orfaos;
END $frete_venda$;

-- =========================================================== PARTE 3
DO $os_defasada$
DECLARE
  v_os record;
  v_ok int := 0;
  v_pulou int := 0;
BEGIN
  FOR v_os IN
    SELECT o.id,
           round(coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                             FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
               + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                             FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
               + coalesce((SELECT sum(coalesce(osv.precounitario, 0) * coalesce(osv.quantidade, 0))
                             FROM public.osservico osv WHERE osv.ordemservicoid = o.id), 0), 2) AS bruto_itens,
           round(coalesce(sum(e.valor) FILTER (
                   WHERE e.natureza = 'RECEITA' AND e.origem <> 'FRETE'), 0), 2) AS bruto_evt
      FROM public.ordemservico o
      JOIN public.eventos_financeiros e ON e.ordemservicoid = o.id
                                       AND e.status IN ('ATIVO', 'CONVERTIDO')
     WHERE coalesce(o.is_deleted, false) = false
       -- Fora dessas situacoes a ausencia ou o encolhimento da receita e o
       -- comportamento correto, e reconciliar reintroduziria o que foi retirado
       -- de proposito (20260802170000 e 20260806250000).
       AND o.status::text IN ('ORCAMENTO_APROVADO', 'EM_ANDAMENTO', 'PAGAMENTO', 'CONCLUIDO')
     GROUP BY o.id
    HAVING round(coalesce(sum(e.valor) FILTER (
                   WHERE e.natureza = 'RECEITA' AND e.origem <> 'FRETE'), 0), 2)
        <> round(coalesce((SELECT sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                             FROM public.osproduto op WHERE op.ordemservicoid = o.id), 0)
               + coalesce((SELECT sum(coalesce(opa.precounitario, 0) * coalesce(opa.quantidade, 0))
                             FROM public.osproduto_avulso opa WHERE opa.ordemservicoid = o.id), 0)
               + coalesce((SELECT sum(coalesce(osv.precounitario, 0) * coalesce(osv.quantidade, 0))
                             FROM public.osservico osv WHERE osv.ordemservicoid = o.id), 0), 2)
     ORDER BY o.id
  LOOP
    BEGIN
      PERFORM public.reconciliar_eventos_financeiros_os(v_os.id);
      v_ok := v_ok + 1;
      RAISE NOTICE '  OS #%: receita % -> % (preco de tabela).',
        v_os.id, v_os.bruto_evt, v_os.bruto_itens;
    EXCEPTION WHEN OTHERS THEN
      -- A reconciliacao recusa OS com evento CONVERTIDO divergente: a despesa
      -- ja virou transacao e mexer nela por aqui deixaria os dois lados
      -- desencontrados. Fica para correcao manual, com o estorno antes.
      v_pulou := v_pulou + 1;
      RAISE NOTICE '  OS #% PULADA: %', v_os.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Parte 3: % OS reconciliada(s), % pulada(s).', v_ok, v_pulou;
END $os_defasada$;

COMMIT;
