begin;

-- Chamada pela API, `salvar_os_termos_impressao` falhava com "DELETE requires a
-- WHERE clause" (SQLSTATE 21000): o Supabase carrega o pg_safeupdate nas
-- sessões do PostgREST, e ele barra DELETE sem WHERE até dentro de função.
-- O teste SQL não pegou porque roda como postgres, fora do PostgREST.
-- O `WHERE true` só existe para satisfazer a extensão; a lista inteira
-- continua sendo trocada numa transação só.
create or replace function public.salvar_os_termos_impressao(p_termos jsonb)
returns setof public.os_termo_impressao
language plpgsql security definer set search_path = public as $fn$
begin
  if p_termos is null or jsonb_typeof(p_termos) <> 'array' then
    raise exception 'Os dizeres devem vir como uma lista.' using errcode = '22023';
  end if;

  delete from public.os_termo_impressao where true;

  return query
  with inseridos as (
    insert into public.os_termo_impressao (titulo, intro, itens, status, alvos, ordem)
    select
      btrim(termo->>'titulo'),
      coalesce(btrim(termo->>'intro'), ''),
      case when jsonb_typeof(termo->'itens') = 'array' then termo->'itens' else '[]'::jsonb end,
      array(select jsonb_array_elements_text(termo->'status'))::public.enum_status_os[],
      array(select jsonb_array_elements_text(termo->'alvos')),
      (posicao - 1) * 10
    from jsonb_array_elements(p_termos) with ordinality as entrada(termo, posicao)
    returning *
  )
  select * from inseridos order by ordem, id;
end;
$fn$;

revoke all on function public.salvar_os_termos_impressao(jsonb) from public, anon, authenticated;
grant execute on function public.salvar_os_termos_impressao(jsonb) to service_role;

commit;
