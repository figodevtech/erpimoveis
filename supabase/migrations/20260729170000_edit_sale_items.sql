begin;

create or replace function public.fn_editar_venda_com_itens(
  p_venda_id integer,
  p_itens jsonb,
  p_sub_total numeric,
  p_valor_total numeric,
  p_desconto_tipo text default null,
  p_desconto_valor numeric default 0,
  p_valor_frete numeric default 0,
  p_updated_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_tinha_baixa boolean;
  v_item jsonb;
  v_produto_id integer;
  v_quantidade integer;
  v_sub_total numeric(14,2);
  v_valor_total numeric(14,2);
  v_valor_desconto numeric(14,2);
  v_tipo_desconto public.enum_tipo_desconto_venda;
  v_ids_solicitados integer;
  v_ids_encontrados integer;
  v_soma_itens numeric(14,2);
begin
  select status::text
    into v_status
    from public.venda
   where id = p_venda_id
   for update;

  if v_status is null then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_status in ('PAGO', 'FINALIZADA', 'CANCELADA', 'CANCELADO') then
    raise exception 'Os itens não podem ser alterados em uma venda paga, finalizada ou cancelada.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.nfe where vendaid = p_venda_id) then
    raise exception 'Exclua a NF-e em rascunho antes de alterar os itens da venda.'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'A venda deve possuir ao menos um item.' using errcode = 'P0001';
  end if;

  select count(distinct (value->>'produtoId')::integer)
    into v_ids_solicitados
    from jsonb_array_elements(p_itens);

  select count(*)
    into v_ids_encontrados
    from public.produto
   where id in (
     select distinct (value->>'produtoId')::integer
       from jsonb_array_elements(p_itens)
   );

  if v_ids_solicitados <> v_ids_encontrados then
    raise exception 'Um ou mais produtos não existem.' using errcode = 'P0001';
  end if;

  perform 1
    from public.produto
   where id in (
     select distinct (value->>'produtoId')::integer
       from jsonb_array_elements(p_itens)
   )
   order by id
   for update;

  select round(coalesce(sum((value->>'subTotal')::numeric), 0), 2)
    into v_soma_itens
    from jsonb_array_elements(p_itens);

  if v_soma_itens <> round(coalesce(p_sub_total, 0), 2) then
    raise exception 'O subtotal da venda não corresponde à soma dos itens.' using errcode = 'P0001';
  end if;

  if coalesce(p_sub_total, 0) < 0 or coalesce(p_valor_total, 0) < 0
     or coalesce(p_desconto_valor, 0) < 0 or coalesce(p_valor_frete, 0) < 0 then
    raise exception 'Os valores financeiros da venda não podem ser negativos.' using errcode = 'P0001';
  end if;

  v_tinha_baixa := exists (
    select 1 from public.vendaproduto_baixa where venda_id = p_venda_id
  );

  if v_tinha_baixa then
    perform public.fn_estornar_estoque_venda(p_venda_id);
  end if;

  delete from public.vendaproduto where venda_id = p_venda_id;

  for v_item in select value from jsonb_array_elements(p_itens) loop
    v_produto_id := (v_item->>'produtoId')::integer;
    v_quantidade := (v_item->>'quantidade')::integer;
    v_sub_total := round((v_item->>'subTotal')::numeric, 2);
    v_valor_total := round((v_item->>'valorTotal')::numeric, 2);
    v_valor_desconto := round(coalesce(nullif(v_item->>'valorDesconto', '')::numeric, 0), 2);
    v_tipo_desconto := nullif(v_item->>'tipoDesconto', '')::public.enum_tipo_desconto_venda;

    if v_produto_id is null or v_quantidade is null or v_quantidade <= 0
       or v_sub_total < 0 or v_valor_total < 0 or v_valor_desconto < 0
       or v_valor_total > v_sub_total then
      raise exception 'Dados inválidos em um dos itens da venda.' using errcode = 'P0001';
    end if;

    insert into public.vendaproduto (
      venda_id, produtoid, quantidade, sub_total, valor_total, valor_desconto, tipo_desconto
    ) values (
      p_venda_id, v_produto_id, v_quantidade, v_sub_total, v_valor_total,
      v_valor_desconto, v_tipo_desconto
    );
  end loop;

  update public.venda
     set sub_total = round(p_sub_total, 2),
         valortotal = round(p_valor_total, 2),
         desconto_tipo = nullif(p_desconto_tipo, '')::public.enum_tipo_desconto_venda,
         desconto_valor = round(coalesce(p_desconto_valor, 0), 2),
         valor_frete = round(coalesce(p_valor_frete, 0), 2),
         updated_by = coalesce(p_updated_by, updated_by),
         updatedat = now()
   where id = p_venda_id;

  if v_tinha_baixa then
    perform public.fn_baixar_estoque_venda(p_venda_id);
  end if;
end;
$$;

revoke all on function public.fn_editar_venda_com_itens(integer, jsonb, numeric, numeric, text, numeric, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_editar_venda_com_itens(integer, jsonb, numeric, numeric, text, numeric, numeric, uuid)
  to service_role;

commit;
