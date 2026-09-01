begin;

do $$
declare
  v_itens integer;
  v_produtos integer;
  v_servicos integer;
  v_produtos_valor numeric;
  v_servicos_valor numeric;
  v_os_sem_itens integer;
  v_aceite record;
begin
  select count(*)::integer,
         count(*) filter (where tipo = 'PRODUTO')::integer,
         count(*) filter (where tipo = 'SERVICO')::integer,
         coalesce(sum(subtotal) filter (where tipo = 'PRODUTO'), 0),
         coalesce(sum(subtotal) filter (where tipo = 'SERVICO'), 0)
    into v_itens, v_produtos, v_servicos, v_produtos_valor, v_servicos_valor
    from public.ositem_historico
   where origem = 'GARAGE_PREMIUM_ORCAMENTOS';

  if (v_itens, v_produtos, v_servicos) <> (15429, 12167, 3262) then
    raise exception 'Contagens inesperadas: %, %, %', v_itens, v_produtos, v_servicos;
  end if;
  if round(v_produtos_valor, 2) <> 6264636.86
     or round(v_servicos_valor, 2) <> 1476675.40 then
    raise exception 'Totais por tipo inesperados: %, %', v_produtos_valor, v_servicos_valor;
  end if;

  select count(*)::integer
    into v_os_sem_itens
    from public.ordemservico os
   where os.migracao_referencia like 'LEGADO_OS_EXPORTACAO:%'
     and not exists (
       select 1 from public.ositem_historico item where item.ordemservicoid = os.id
     );
  if v_os_sem_itens <> 4 then
    raise exception 'OS sem itens inesperadas: %', v_os_sem_itens;
  end if;

  select os.id, os.subtotal, os.desconto, os.orcamentototal,
         count(item.id)::integer itens,
         count(item.id) filter (where item.tipo = 'PRODUTO')::integer produtos,
         count(item.id) filter (where item.tipo = 'SERVICO')::integer servicos,
         coalesce(sum(item.subtotal) filter (where item.tipo = 'PRODUTO'), 0) produtos_valor,
         coalesce(sum(item.subtotal) filter (where item.tipo = 'SERVICO'), 0) servicos_valor
    into v_aceite
    from public.ordemservico os
    left join public.ositem_historico item on item.ordemservicoid = os.id
   where os.migracao_referencia = 'LEGADO_OS_EXPORTACAO:4611'
   group by os.id;

  if v_aceite.itens <> 8 or v_aceite.produtos <> 5 or v_aceite.servicos <> 3
     or round(v_aceite.produtos_valor, 2) <> 2060.00
     or round(v_aceite.servicos_valor, 2) <> 820.00
     or round(v_aceite.subtotal, 2) <> 2880.00
     or round(v_aceite.desconto, 2) <> 439.00
     or round(v_aceite.orcamentototal, 2) <> 2441.00 then
    raise exception 'OS 4611 divergente: %', row_to_json(v_aceite);
  end if;

  if exists (
    select 1 from public.osproduto item join public.ordemservico os on os.id = item.ordemservicoid
     where os.migracao_referencia is not null
    union all
    select 1 from public.osservico item join public.ordemservico os on os.id = item.ordemservicoid
     where os.migracao_referencia is not null
    union all
    select 1 from public.transacao item join public.ordemservico os on os.id = item.ordemservicoid
     where os.migracao_referencia is not null
    union all
    select 1 from public.pagamento item join public.ordemservico os on os.id = item.ordemservicoid
     where os.migracao_referencia is not null
    union all
    select 1 from public.eventos_financeiros item join public.ordemservico os on os.id = item.ordemservicoid
     where os.migracao_referencia is not null
  ) then
    raise exception 'Foi encontrado efeito operacional em OS migrada.';
  end if;

  begin
    update public.ositem_historico
       set descricao = descricao
     where id = (select min(id) from public.ositem_historico);
    raise exception 'A protecao de somente leitura nao bloqueou UPDATE.';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    insert into public.ositem_historico (
      ordemservicoid, origem, linha_origem, tipo, codigo_legado, descricao,
      unidade, quantidade, preco_unitario, subtotal
    )
    select ordemservicoid, origem, linha_origem, tipo, codigo_legado, descricao,
           unidade, quantidade, preco_unitario, subtotal
      from public.ositem_historico
     order by id
     limit 1;
    raise exception 'A unicidade da linha de origem nao bloqueou duplicacao.';
  exception when unique_violation then
    null;
  end;

  raise notice 'OS 4611: id %, 8 itens, produtos 2060, servicos 820, total 2441.', v_aceite.id;
  raise notice 'Carga auditada: 15429 itens em 2304 OS; 4 OS sem itens.';
end;
$$;

rollback;
