-- Permite marcar servicos que nao geram comissao para o realizador.
--
-- Onde a flag mora: a intencao original era pendura-la em `tiposervico`, mas
-- essa tabela (e a `categoriaservico` da qual ela depende por FK NOT NULL) esta
-- vazia, sem rota de API e sem tela de cadastro — todos os servicos tem
-- `tiposervicoid` nulo. A flag em `servico` e alcancavel pelo cadastro que ja
-- existe e nao obriga a adotar uma taxonomia de dois niveis nunca usada.
--
-- Default `true`: o comportamento atual (todo servico gera comissao conforme o
-- percentual do usuario) fica inalterado ate alguem desmarcar um servico.
--
-- Tres pontos passam a respeitar a flag:
--   1. tg_set_comissao_percent_aplicada — carimba percentual 0 no vinculo novo;
--   2. recalcular_comissao_osservico    — zera valor_comissao em qualquer
--      recalculo, mantendo os relatorios de comissao alinhados com a flag atual
--      mesmo que o vinculo tenha sido criado antes de desmarcar o servico;
--   3. sincronizar/reconciliar_eventos_financeiros_os — nao criam o evento
--      COMISSAO/DESPESA, em vez de criar um lancamento de R$ 0,00.
--
-- OS ja concluidas nao sao reprocessadas: o snapshot de comissao e historico e
-- so muda se algo disparar o recalculo daquele item.
BEGIN;

ALTER TABLE public.servico
  ADD COLUMN IF NOT EXISTS gera_comissao boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.servico.gera_comissao IS
  'Quando false, realizadores deste servico ficam com percentual e comissao zerados e nenhum evento financeiro de comissao e gerado.';

-- 1) Snapshot do percentual no vinculo realizador <-> servico da OS.
CREATE OR REPLACE FUNCTION public.tg_set_comissao_percent_aplicada()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if new.comissao_percent_aplicada is null then
    if exists (
      select 1 from public.servico s
      where s.id = new.servicoid and s.gera_comissao is false
    ) then
      new.comissao_percent_aplicada := 0;
    else
      select coalesce(u.comissao_percent, 0)
        into new.comissao_percent_aplicada
      from public.usuario u
      where u.id = new.usuarioid;
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$function$;

-- 2) Rateio do subtotal entre realizadores e calculo da comissao.
CREATE OR REPLACE FUNCTION public.recalcular_comissao_osservico(
  p_ordemservicoid integer,
  p_servicoid integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
declare
  v_subtotal numeric;
  v_qtd int;
  v_gera_comissao boolean;
begin
  select coalesce(s.subtotal, 0)
    into v_subtotal
  from public.osservico s
  where s.ordemservicoid = p_ordemservicoid
    and s.servicoid = p_servicoid;

  -- Servico ausente (item removido do cadastro) mantem o comportamento antigo.
  select coalesce(sv.gera_comissao, true)
    into v_gera_comissao
  from public.servico sv
  where sv.id = p_servicoid;

  select count(*)
    into v_qtd
  from public.osservico_realizador r
  where r.ordemservicoid = p_ordemservicoid
    and r.servicoid = p_servicoid;

  if v_qtd <= 0 then
    return;
  end if;

  update public.osservico_realizador r
  set
    valor_base = round(v_subtotal / v_qtd, 2),
    valor_comissao = case
      when coalesce(v_gera_comissao, true)
        then round((v_subtotal / v_qtd) * coalesce(r.comissao_percent_aplicada, 0) / 100.0, 2)
      else 0
    end,
    updated_at = now()
  where r.ordemservicoid = p_ordemservicoid
    and r.servicoid = p_servicoid;
end;
$function$;

-- 3a) Geracao dos eventos financeiros (OS aprovada / iniciada).
CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_os(
  p_ordemservicoid integer,
  p_incluir_comissoes boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_total_itens numeric := 0;
  v_total_os numeric := 0;
  v_fator numeric := 1;
begin
  select coalesce(o.orcamentototal, 0),
         coalesce((select sum(coalesce(op.subtotal, 0)) from public.osproduto op where op.ordemservicoid = o.id), 0)
           + coalesce((select sum(coalesce(os.subtotal, 0)) from public.osservico os where os.ordemservicoid = o.id), 0)
    into v_total_os, v_total_itens
  from public.ordemservico o
  where o.id = p_ordemservicoid;

  if not found then return; end if;
  if v_total_itens > 0 then v_fator := v_total_os / v_total_itens; end if;

  insert into public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     produtoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  select p_ordemservicoid, 'PRODUTO', 'RECEITA', op.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         op.quantidade || ' unidade(s)', round(coalesce(op.subtotal, 0) * v_fator, 2),
         op.produtoid, op.quantidade, op.precounitario,
         jsonb_build_object('subtotal', op.subtotal, 'fator_desconto_os', v_fator)
  from public.osproduto op join public.produto p on p.id = op.produtoid
  where op.ordemservicoid = p_ordemservicoid
  on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;

  insert into public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     produtoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  select p_ordemservicoid, 'PRODUTO', 'DESPESA', op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         case when op.custo_unitario_aplicado is null then 'Ultimo valor de compra no momento da aprovacao' else 'Custo registrado na OS' end,
         round(coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, op.quantidade, coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0),
         jsonb_build_object('custo_nao_informado', op.custo_unitario_aplicado is null and p.ultimovalordecompra is null,
                            'custo_estimado', op.custo_unitario_aplicado is null and p.ultimovalordecompra is not null)
  from public.osproduto op join public.produto p on p.id = op.produtoid
  where op.ordemservicoid = p_ordemservicoid
  on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;

  insert into public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     servicoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  select p_ordemservicoid, 'SERVICO', 'RECEITA', os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)', round(coalesce(os.subtotal, 0) * v_fator, 2),
         os.servicoid, os.quantidade, os.precounitario,
         jsonb_build_object('subtotal', os.subtotal, 'fator_desconto_os', v_fator)
  from public.osservico os join public.servico s on s.id = os.servicoid
  where os.ordemservicoid = p_ordemservicoid
  on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;

  if p_incluir_comissoes then
    insert into public.eventos_financeiros
      (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
       servicoid, usuarioid, percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao)
    select p_ordemservicoid, 'COMISSAO', 'DESPESA', r.servicoid || ':' || r.usuarioid,
           'Comissao - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid),
           coalesce(u.nome, 'Realizador'), coalesce(r.valor_comissao, 0),
           r.servicoid, r.usuarioid, r.comissao_percent_aplicada, r.valor_base,
           jsonb_build_object('realizador_nome', u.nome), true
    from public.osservico_realizador r
    join public.osservico os on os.ordemservicoid = r.ordemservicoid and os.servicoid = r.servicoid
    join public.servico s on s.id = r.servicoid
    left join public.usuario u on u.id = r.usuarioid
    where r.ordemservicoid = p_ordemservicoid
      and s.gera_comissao          -- << servico marcado como sem comissao nao gera evento
    on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;
  end if;
end;
$function$;

-- 3b) Reconciliacao dos eventos (OS concluida / sem cobranca / cancelada).
CREATE OR REPLACE FUNCTION public.reconciliar_eventos_financeiros_os(
  p_ordemservicoid integer,
  p_incluir_comissoes boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_total_itens numeric := 0;
  v_total_os numeric := 0;
  v_fator numeric := 1;
begin
  select coalesce(o.orcamentototal, 0),
         coalesce((select sum(coalesce(op.subtotal, 0)) from public.osproduto op where op.ordemservicoid = o.id), 0)
           + coalesce((select sum(coalesce(os.subtotal, 0)) from public.osservico os where os.ordemservicoid = o.id), 0)
    into v_total_os, v_total_itens
  from public.ordemservico o
  where o.id = p_ordemservicoid;

  if not found then raise exception 'OS nao encontrada.'; end if;
  if v_total_itens > 0 and v_total_os > 0 then v_fator := v_total_os / v_total_itens; end if;

  create temporary table if not exists pg_temp.eventos_os_desejados (
    origem text not null,
    natureza text not null,
    chave_origem text not null,
    descricao text not null,
    detalhe text,
    valor numeric(14,2) not null,
    produtoid integer,
    servicoid integer,
    usuarioid uuid,
    quantidade_snapshot numeric(14,4),
    valor_unitario_snapshot numeric(14,4),
    percentual_snapshot numeric(8,4),
    valor_base_snapshot numeric(14,2),
    dados_snapshot jsonb not null,
    pode_gerar_transacao boolean not null,
    primary key (origem, natureza, chave_origem)
  ) on commit drop;
  truncate pg_temp.eventos_os_desejados;

  insert into pg_temp.eventos_os_desejados
  select 'PRODUTO', 'RECEITA', op.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         op.quantidade || ' unidade(s)', round(coalesce(op.subtotal, 0) * v_fator, 2),
         op.produtoid, null, null, op.quantidade, op.precounitario, null, null,
         jsonb_build_object('subtotal', op.subtotal, 'fator_desconto_os', v_fator), false
  from public.osproduto op join public.produto p on p.id = op.produtoid
  where op.ordemservicoid = p_ordemservicoid;

  insert into pg_temp.eventos_os_desejados
  select 'PRODUTO', 'DESPESA', op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         case when op.custo_unitario_aplicado is null then 'Ultimo valor de compra no momento da reconciliacao' else 'Custo registrado na OS' end,
         round(coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade,
         coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0), null, null,
         jsonb_build_object('custo_nao_informado', op.custo_unitario_aplicado is null and p.ultimovalordecompra is null,
                            'custo_estimado', op.custo_unitario_aplicado is null and p.ultimovalordecompra is not null), false
  from public.osproduto op join public.produto p on p.id = op.produtoid
  where op.ordemservicoid = p_ordemservicoid;

  insert into pg_temp.eventos_os_desejados
  select 'SERVICO', 'RECEITA', os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)', round(coalesce(os.subtotal, 0) * v_fator, 2),
         null, os.servicoid, null, os.quantidade, os.precounitario, null, null,
         jsonb_build_object('subtotal', os.subtotal, 'fator_desconto_os', v_fator), false
  from public.osservico os join public.servico s on s.id = os.servicoid
  where os.ordemservicoid = p_ordemservicoid;

  if p_incluir_comissoes then
    insert into pg_temp.eventos_os_desejados
    select 'COMISSAO', 'DESPESA', r.servicoid || ':' || r.usuarioid,
           'Comissao - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid),
           coalesce(u.nome, 'Realizador'),
           round(coalesce(os.subtotal, 0) * coalesce(r.comissao_percent_aplicada, 0) / 100, 2),
           null, r.servicoid, r.usuarioid, null, null, r.comissao_percent_aplicada, os.subtotal,
           jsonb_build_object('realizador_nome', u.nome), true
    from public.osservico_realizador r
    join public.osservico os on os.ordemservicoid = r.ordemservicoid and os.servicoid = r.servicoid
    join public.servico s on s.id = r.servicoid
    left join public.usuario u on u.id = r.usuarioid
    where r.ordemservicoid = p_ordemservicoid
      and s.gera_comissao;         -- << servico marcado como sem comissao nao gera evento
  end if;

  if exists (
    select 1
    from public.eventos_financeiros e
    left join pg_temp.eventos_os_desejados d
      on d.origem = e.origem and d.natureza = e.natureza and d.chave_origem = e.chave_origem
    where e.ordemservicoid = p_ordemservicoid
      and e.origem <> 'AVULSO'
      and e.status = 'CONVERTIDO'
      and (d.chave_origem is null or e.valor <> d.valor)
  ) then
    raise exception 'Existem eventos convertidos divergentes. Exclua as transacoes vinculadas antes de alterar o orcamento.';
  end if;

  insert into public.eventos_financeiros (
    ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
    produtoid, servicoid, usuarioid, quantidade_snapshot, valor_unitario_snapshot,
    percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao, status, updated_at
  )
  select p_ordemservicoid, d.origem, d.natureza, d.chave_origem, d.descricao, d.detalhe, d.valor,
         d.produtoid, d.servicoid, d.usuarioid, d.quantidade_snapshot, d.valor_unitario_snapshot,
         d.percentual_snapshot, d.valor_base_snapshot, d.dados_snapshot, d.pode_gerar_transacao, 'ATIVO', now()
  from pg_temp.eventos_os_desejados d
  on conflict (ordemservicoid, origem, chave_origem, natureza) do update set
    descricao = excluded.descricao, detalhe = excluded.detalhe, valor = excluded.valor,
    produtoid = excluded.produtoid, servicoid = excluded.servicoid, usuarioid = excluded.usuarioid,
    quantidade_snapshot = excluded.quantidade_snapshot,
    valor_unitario_snapshot = excluded.valor_unitario_snapshot,
    percentual_snapshot = excluded.percentual_snapshot,
    valor_base_snapshot = excluded.valor_base_snapshot,
    dados_snapshot = excluded.dados_snapshot,
    pode_gerar_transacao = excluded.pode_gerar_transacao,
    status = 'ATIVO', updated_at = now()
  where eventos_financeiros.status <> 'CONVERTIDO';

  update public.eventos_financeiros e
     set status = 'CANCELADO', updated_at = now()
   where e.ordemservicoid = p_ordemservicoid
     and e.origem <> 'AVULSO'
     and e.status <> 'CONVERTIDO'
     and not exists (
       select 1 from pg_temp.eventos_os_desejados d
       where d.origem = e.origem and d.natureza = e.natureza and d.chave_origem = e.chave_origem
     );
end;
$function$;

COMMIT;
