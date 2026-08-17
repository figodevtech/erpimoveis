-- Valida modelagem temática e o reaproveitamento dos favoritos sem manter dados.

begin;

do $$
declare
  v_station_id uuid;
  v_user_id uuid;
  v_slug text := 'teste-tematico-' || txid_current()::text;
  v_count integer;
begin
  if to_regclass('public.radio_stream_source') is null then
    raise exception 'A tabela radio_stream_source nao existe.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'radio_station'
      and column_name = 'channel_type'
  ) then
    raise exception 'A coluna radio_station.channel_type nao existe.';
  end if;

  if has_table_privilege('authenticated', 'public.radio_stream_source', 'SELECT') then
    raise exception 'A role authenticated nao deve consultar fontes diretamente.';
  end if;

  insert into public.radio_station (
    name, slug, channel_type, description, genres, active, system_default, company_id
  ) values (
    'Canal tematico de teste', v_slug, 'THEMATIC', 'Teste transacional',
    array['Teste'], true, true, null
  ) returning id into v_station_id;

  insert into public.radio_stream_source (
    station_id, source_url, priority, stream_status, last_checked_at, active
  ) values
    (v_station_id, 'https://radio.test/principal', 1, 'OFFLINE', now(), true),
    (v_station_id, 'https://radio.test/fallback', 2, 'ONLINE', now(), true);

  begin
    insert into public.radio_stream_source (
      station_id, source_url, priority, stream_status, active
    ) values (
      v_station_id, 'https://radio.test/duplicada', 2, 'UNKNOWN', true
    );
    raise exception 'Prioridade duplicada foi aceita.';
  exception when unique_violation then
    null;
  end;

  select id into v_user_id from public.usuario limit 1;
  if v_user_id is null then
    raise exception 'Nenhum usuario disponivel para validar favoritos.';
  end if;

  insert into public.radio_favorite (user_id, station_id)
  values (v_user_id, v_station_id)
  on conflict do nothing;

  select count(*) into v_count
  from public.radio_favorite
  where user_id = v_user_id and station_id = v_station_id;
  if v_count <> 1 then
    raise exception 'Canal tematico nao foi aceito pelos favoritos existentes.';
  end if;

  if exists (
    select 1 from public.radio_station
    where channel_type not in ('RADIO', 'THEMATIC')
  ) then
    raise exception 'Foi encontrado channel_type invalido.';
  end if;

  select count(*) into v_count
  from public.radio_station
  where channel_type = 'THEMATIC'
    and system_default = true
    and company_id is null
    and id <> v_station_id;
  if v_count <> 19 then
    raise exception 'Esperados 19 canais tematicos globais apos o import; encontrados %.', v_count;
  end if;

  select count(*) into v_count
  from public.radio_stream_source fonte
  join public.radio_station canal on canal.id = fonte.station_id
  where canal.channel_type = 'THEMATIC'
    and canal.system_default = true
    and canal.company_id is null
    and canal.id <> v_station_id;
  if v_count <> 27 then
    raise exception 'Esperadas 27 fontes tematicas apos import idempotente; encontradas %.', v_count;
  end if;

  select count(*) into v_count
  from public.radio_station
  where channel_type = 'RADIO' and system_default = true and company_id is null;
  if v_count <> 22 then
    raise exception 'As 22 radios globais existentes nao foram preservadas; encontradas %.', v_count;
  end if;

  raise notice 'OK: 22 radios, 19 canais, 27 fontes, prioridades e favoritos validados.';
end;
$$;

rollback;
