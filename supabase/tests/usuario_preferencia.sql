-- Verifica o contrato da tabela de preferencias sem manter alteracoes no banco.

begin;

do $$
declare
  v_usuario_id uuid;
  v_radio_habilitado boolean;
begin
  if to_regclass('public.usuario_preferencia') is null then
    raise exception 'A tabela usuario_preferencia nao existe.';
  end if;

  if has_table_privilege('authenticated', 'public.usuario_preferencia', 'SELECT') then
    raise exception 'A role authenticated nao deve acessar preferencias diretamente.';
  end if;

  if not has_table_privilege('service_role', 'public.usuario_preferencia', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'A role service_role nao possui os privilegios esperados.';
  end if;

  select id into v_usuario_id from public.usuario limit 1;
  if v_usuario_id is null then
    raise exception 'Nenhum usuario disponivel para o teste.';
  end if;

  insert into public.usuario_preferencia (usuario_id, radio_habilitado)
  values (v_usuario_id, false)
  on conflict (usuario_id) do update
  set radio_habilitado = excluded.radio_habilitado;

  select radio_habilitado into v_radio_habilitado
  from public.usuario_preferencia
  where usuario_id = v_usuario_id;

  if v_radio_habilitado is distinct from false then
    raise exception 'A preferencia de radio nao foi persistida corretamente.';
  end if;

  raise notice 'OK: schema, privilegios e persistencia de usuario_preferencia validados.';
end;
$$;

rollback;
