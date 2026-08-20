begin;

-- Dados de usuarios sao acessados apenas pelas APIs do servidor. O papel
-- anonimo nao pode listar credenciais de login nem dados trabalhistas.
alter table public.usuario enable row level security;
alter table public.usuario no force row level security;

revoke all on table public.usuario from public, anon, authenticated;
grant all on table public.usuario to service_role;

create table if not exists public.auth_login_rate_limit (
  key_hash text primary key,
  failed_count integer not null default 0 check (failed_count >= 0),
  window_started_at timestamptz not null default clock_timestamp(),
  blocked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.auth_login_rate_limit enable row level security;
alter table public.auth_login_rate_limit no force row level security;
revoke all on table public.auth_login_rate_limit from public, anon, authenticated;
grant all on table public.auth_login_rate_limit to service_role;

create or replace function public.auth_login_rate_limit_check(p_keys text[])
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(
    ceil(max(extract(epoch from (blocked_until - clock_timestamp()))))::integer,
    0
  )
  from public.auth_login_rate_limit
  where key_hash = any(coalesce(p_keys, array[]::text[]))
    and blocked_until > clock_timestamp();
$$;

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
begin
  foreach v_key in array coalesce(p_keys, array[]::text[]) loop
    if v_key is null or length(v_key) < 4 or length(v_key) > 80 then
      continue;
    end if;

    insert into public.auth_login_rate_limit (key_hash)
    values (v_key)
    on conflict (key_hash) do nothing;

    select * into v_row
    from public.auth_login_rate_limit
    where key_hash = v_key
    for update;

    if v_row.window_started_at <= v_now - interval '15 minutes' then
      v_row.failed_count := 0;
      v_row.window_started_at := v_now;
      v_row.blocked_until := null;
    end if;

    v_row.failed_count := v_row.failed_count + 1;

    if v_row.failed_count >= 5 then
      v_row.blocked_until := v_now + interval '15 minutes';
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

  return v_retry;
end;
$$;

create or replace function public.auth_login_rate_limit_clear(p_keys text[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.auth_login_rate_limit
  where key_hash = any(coalesce(p_keys, array[]::text[]));
$$;

revoke all on function public.auth_login_rate_limit_check(text[]) from public, anon, authenticated;
revoke all on function public.auth_login_rate_limit_register_failure(text[]) from public, anon, authenticated;
revoke all on function public.auth_login_rate_limit_clear(text[]) from public, anon, authenticated;

grant execute on function public.auth_login_rate_limit_check(text[]) to service_role;
grant execute on function public.auth_login_rate_limit_register_failure(text[]) to service_role;
grant execute on function public.auth_login_rate_limit_clear(text[]) to service_role;

commit;

