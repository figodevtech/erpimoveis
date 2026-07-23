-- Mantem os eventos economicos da OS coerentes com o orcamento e o financeiro.

create or replace function public.reconciliar_eventos_financeiros_os(
  p_ordemservicoid integer,
  p_incluir_comissoes boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
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
    where r.ordemservicoid = p_ordemservicoid;
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
$$;

create or replace function public.tg_reconciliar_eventos_ao_finalizar_os()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status::text in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO')
     and old.status is distinct from new.status then
    perform public.reconciliar_eventos_financeiros_os(new.id, true);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reconciliar_eventos_ao_finalizar_os on public.ordemservico;
create trigger trg_reconciliar_eventos_ao_finalizar_os
before update of status on public.ordemservico
for each row execute function public.tg_reconciliar_eventos_ao_finalizar_os();

create or replace function public.tg_restaurar_evento_apos_excluir_transacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.evento_financeiro_id is not null then
    update public.eventos_financeiros
       set status = 'ATIVO', transacaoid = null, updated_at = now()
     where id = old.evento_financeiro_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_restaurar_evento_apos_excluir_transacao on public.transacao;
create trigger trg_restaurar_evento_apos_excluir_transacao
after delete on public.transacao
for each row execute function public.tg_restaurar_evento_apos_excluir_transacao();

create or replace function public.tg_vincular_transacao_evento_financeiro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_evento public.eventos_financeiros%rowtype;
begin
  if new.evento_financeiro_id is null then return new; end if;
  select * into v_evento from public.eventos_financeiros where id = new.evento_financeiro_id for update;
  if not found then raise exception 'Evento financeiro nao encontrado.'; end if;
  if v_evento.status <> 'ATIVO' or v_evento.transacaoid is not null then
    raise exception 'Este evento ja foi convertido ou cancelado.';
  end if;
  if not v_evento.pode_gerar_transacao or v_evento.origem not in ('AVULSO', 'COMISSAO') then
    raise exception 'Este evento nao pode gerar uma transacao.';
  end if;
  if v_evento.ordemservicoid <> new.ordemservicoid or v_evento.natureza <> new.tipo::text then
    raise exception 'A transacao nao corresponde a OS ou a natureza do evento financeiro.';
  end if;
  if round(v_evento.valor, 2) <> round(new.valor, 2) then
    raise exception 'O valor da transacao deve ser igual ao valor do evento financeiro.';
  end if;
  return new;
end;
$$;

grant execute on function public.reconciliar_eventos_financeiros_os(integer, boolean) to service_role;
