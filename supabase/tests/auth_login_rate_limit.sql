-- Valida os limites por tipo de chave sem manter alterações no banco.

begin;

do $$
declare
  v_retry integer;
  v_i integer;
begin
  for v_i in 1..4 loop
    v_retry := public.auth_login_rate_limit_register_failure(array['identifier:test-rate-limit']);
    if v_retry <> 0 then
      raise exception 'Identificador bloqueou antes da quinta falha.';
    end if;
  end loop;

  v_retry := public.auth_login_rate_limit_register_failure(array['identifier:test-rate-limit']);
  if v_retry <= 0 then
    raise exception 'Identificador não bloqueou na quinta falha.';
  end if;

  for v_i in 1..29 loop
    v_retry := public.auth_login_rate_limit_register_failure(array['ip:test-rate-limit']);
    if v_retry <> 0 then
      raise exception 'IP bloqueou antes da trigésima falha.';
    end if;
  end loop;

  v_retry := public.auth_login_rate_limit_register_failure(array['ip:test-rate-limit']);
  if v_retry <= 0 then
    raise exception 'IP não bloqueou na trigésima falha.';
  end if;

  for v_i in 1..99 loop
    v_retry := public.auth_login_rate_limit_register_failure(array['login-global:test-rate-limit']);
    if v_retry <> 0 then
      raise exception 'Limite global bloqueou antes da centésima tentativa.';
    end if;
  end loop;

  v_retry := public.auth_login_rate_limit_register_failure(array['login-global:test-rate-limit']);
  if v_retry <= 0 then
    raise exception 'Limite global não bloqueou na centésima tentativa.';
  end if;

  raise notice 'OK: limites por conta, IP e global validados.';
end;
$$;

rollback;
