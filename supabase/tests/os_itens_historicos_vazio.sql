begin;

do $$
declare
  v_total integer;
begin
  select count(*)::integer into v_total from public.ositem_historico;
  if v_total <> 0 then
    raise exception 'Este banco deveria conter somente a estrutura, mas possui % itens historicos.', v_total;
  end if;
  raise notice 'Estrutura presente e sem dados historicos.';
end;
$$;

rollback;
