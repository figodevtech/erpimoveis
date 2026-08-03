-- DRE — Fase 1: vendas passam a alimentar o livro de resultado.
--
-- RECONHECIMENTO
-- Receita de venda e reconhecida quando a venda esta concluida, independente de
-- ter sido recebida. Status considerados: PAGAMENTO, FINALIZADA, PAGO e
-- AUTORIZADO. `PAGAMENTO` entra porque, nas palavras do usuario, significa que a
-- operacao terminou e foi paga — o que falta e o registro da baixa, nao o fato
-- economico. Ficam de fora ORCAMENTO, ABERTA, PENDENTE, CANCELADA e CANCELADO.
--
-- COMPETENCIA = `venda.datavenda`. Diferente da OS, cuja entrega tem data
-- propria (`execucao_fim_em`), a venda de balcao se conclui no ato.
--
-- RECEITA BRUTA + DEDUCAO, e nao receita liquida
-- Os eventos de OS registram receita ja liquida do desconto da ordem (o `fator`
-- em sincronizar_eventos_financeiros_os). Para venda foi adotado o caminho
-- contabil correto: receita bruta pelo valor de tabela e o desconto como
-- DEDUCAO na linha 2.5. Isso torna visivel quanto a empresa concede em desconto,
-- que a versao liquida esconde.
--
-- Isso cria uma assimetria temporaria com o lado da OS, registrada em
-- docs/dre.md e a ser resolvida na Fase 2, quando as funcoes de OS forem
-- revisitadas. Ate la, a linha 2.5 reflete apenas descontos de venda.
--
-- CMV usa `vendaproduto.custo_unitario_aplicado`, o custo congelado no momento
-- da venda. Nunca o custo atual do cadastro: isso recalcularia periodos
-- fechados a cada alteracao de preco de compra.
BEGIN;

-- `DESCONTO` e uma origem nova. Sem ampliar o CHECK, a primeira venda com
-- desconto falharia — e o defeito ficaria escondido enquanto ninguem desse
-- desconto, que e exatamente o caso do Demir hoje.
ALTER TABLE public.eventos_financeiros
  DROP CONSTRAINT IF EXISTS eventos_financeiros_origem_check;
ALTER TABLE public.eventos_financeiros
  ADD CONSTRAINT eventos_financeiros_origem_check
  CHECK (origem = ANY (ARRAY['PRODUTO', 'SERVICO', 'COMISSAO', 'AVULSO', 'DESCONTO']));

CREATE OR REPLACE FUNCTION public.venda_reconhece_receita(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT upper(coalesce(p_status, '')) IN ('PAGAMENTO', 'FINALIZADA', 'PAGO', 'AUTORIZADO');
$function$;

COMMENT ON FUNCTION public.venda_reconhece_receita(text) IS
  'Status de venda que representam operacao concluida. Centraliza a regra para a DRE e qualquer relatorio futuro.';

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
         -- Zero conta como nao informado: no Demir o campo esta preenchido com
         -- zero em 12 dos 13 itens, e tratar isso como custo real produziria
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
     or new.datavenda is distinct from old.datavenda then
    perform public.sincronizar_eventos_financeiros_venda(new.id);
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_eventos_financeiros_venda ON public.venda;
CREATE TRIGGER trg_eventos_financeiros_venda
AFTER INSERT OR UPDATE ON public.venda
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_venda();

-- Itens alterados depois da venda reconhecida tambem refazem os eventos.
CREATE OR REPLACE FUNCTION public.tg_eventos_financeiros_vendaproduto()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  perform public.sincronizar_eventos_financeiros_venda(coalesce(new.venda_id, old.venda_id));
  return coalesce(new, old);
end;
$function$;

DROP TRIGGER IF EXISTS trg_eventos_financeiros_vendaproduto ON public.vendaproduto;
CREATE TRIGGER trg_eventos_financeiros_vendaproduto
AFTER INSERT OR UPDATE OR DELETE ON public.vendaproduto
FOR EACH ROW EXECUTE FUNCTION public.tg_eventos_financeiros_vendaproduto();

-- Backfill das vendas ja reconhecidas.
DO $backfill$
DECLARE v_id bigint;
BEGIN
  FOR v_id IN
    SELECT id FROM public.venda WHERE public.venda_reconhece_receita(status::text) ORDER BY id
  LOOP
    PERFORM public.sincronizar_eventos_financeiros_venda(v_id);
  END LOOP;
END
$backfill$;

COMMIT;
