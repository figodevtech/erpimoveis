begin;

create index if not exists auth_login_rate_limit_updated_at_idx
  on public.auth_login_rate_limit (updated_at);

-- Limites distintos evitam que cinco erros compartilhados por um NAT bloqueiem
-- todo o escritório e acrescentam um disjuntor global antes do Supabase Auth.
create or replace function public.auth_login_rate_limit_register_failure(p_keys text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_row public.auth_login_rate_limit%rowtype;
  v_now timestamptz := clock_timestamp();
  v_retry integer := 0;
  v_current_retry integer;
  v_limit integer;
  v_window interval;
  v_block_duration interval;
begin
  foreach v_key in array coalesce(p_keys, array[]::text[]) loop
    if v_key is null or length(v_key) < 4 or length(v_key) > 80 then
      continue;
    end if;

    if v_key like 'identifier:%' then
      v_limit := 5;
      v_window := interval '15 minutes';
      v_block_duration := interval '15 minutes';
    elsif v_key like 'ip:%' then
      v_limit := 30;
      v_window := interval '15 minutes';
      v_block_duration := interval '15 minutes';
    elsif v_key like 'login-global:%' then
      v_limit := 100;
      v_window := interval '5 minutes';
      v_block_duration := interval '5 minutes';
    else
      -- Mantém o contrato dos fluxos públicos que já usam estas funções.
      v_limit := 5;
      v_window := interval '15 minutes';
      v_block_duration := interval '15 minutes';
    end if;

    insert into public.auth_login_rate_limit (key_hash)
    values (v_key)
    on conflict (key_hash) do nothing;

    select * into v_row
    from public.auth_login_rate_limit
    where key_hash = v_key
    for update;

    if v_row.window_started_at <= v_now - v_window then
      v_row.failed_count := 0;
      v_row.window_started_at := v_now;
      v_row.blocked_until := null;
    end if;

    v_row.failed_count := v_row.failed_count + 1;

    if v_row.failed_count >= v_limit then
      v_row.blocked_until := v_now + v_block_duration;
    end if;

    update public.auth_login_rate_limit
    set failed_count = v_row.failed_count,
        window_started_at = v_row.window_started_at,
        blocked_until = v_row.blocked_until,
        updated_at = v_now
    where key_hash = v_key;

    if v_row.blocked_until > v_now then
      v_current_retry := ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer;
      v_retry := greatest(v_retry, v_current_retry);
    end if;
  end loop;

  -- Limpeza oportunista e indexada: evita crescimento permanente sem exigir
  -- pg_cron em todos os bancos dos clientes.
  if random() < 0.01 then
    delete from public.auth_login_rate_limit
    where updated_at < v_now - interval '7 days';
  end if;

  return v_retry;
end;
$$;

delete from public.auth_login_rate_limit
where updated_at < clock_timestamp() - interval '7 days';

revoke all on function public.auth_login_rate_limit_register_failure(text[])
  from public, anon, authenticated;
grant execute on function public.auth_login_rate_limit_register_failure(text[])
  to service_role;

commit;
