create or replace function public.consumir_estoque_os(p_os_id integer)
returns void
language plpgsql
as $$
declare
  r record;
  q_baixada int;
  delta int;
begin
  for r in
    select p.produtoid, coalesce(p.quantidade, 0)::int as quantidade
      from public.osproduto p
     where p.ordemservicoid = p_os_id
  loop
    select b.quantidade
      into q_baixada
      from public.osproduto_baixa b
     where b.ordemservicoid = p_os_id
       and b.produtoid = r.produtoid;

    if q_baixada is null then
      delta := r.quantidade;
    else
      delta := r.quantidade - q_baixada;
    end if;

    if delta > 0 then
      update public.produto
         set estoque = estoque - delta
       where id = r.produtoid
         and estoque >= delta;

      if not found then
        raise exception 'Estoque insuficiente para o produto % (necessario: %, OS %)', r.produtoid, delta, p_os_id
          using errcode = 'P0001';
      end if;

      insert into public.osproduto_baixa (ordemservicoid, produtoid, quantidade)
      values (p_os_id, r.produtoid, r.quantidade)
      on conflict (ordemservicoid, produtoid) do update
        set quantidade = excluded.quantidade;
    elsif delta < 0 then
      update public.produto
         set estoque = estoque + (-delta)
       where id = r.produtoid;

      insert into public.osproduto_baixa (ordemservicoid, produtoid, quantidade)
      values (p_os_id, r.produtoid, r.quantidade)
      on conflict (ordemservicoid, produtoid) do update
        set quantidade = excluded.quantidade;
    end if;
  end loop;

  for r in
    select b.produtoid, b.quantidade
      from public.osproduto_baixa b
     where b.ordemservicoid = p_os_id
       and not exists (
         select 1
           from public.osproduto p
          where p.ordemservicoid = p_os_id
            and p.produtoid = b.produtoid
       )
  loop
    update public.produto
       set estoque = estoque + r.quantidade
     where id = r.produtoid;

    delete from public.osproduto_baixa
     where ordemservicoid = p_os_id
       and produtoid = r.produtoid;
  end loop;
end;
$$;

grant all on function public.consumir_estoque_os(integer) to anon;
grant all on function public.consumir_estoque_os(integer) to authenticated;
grant all on function public.consumir_estoque_os(integer) to service_role;
