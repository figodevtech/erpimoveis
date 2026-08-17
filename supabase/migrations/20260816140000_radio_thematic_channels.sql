-- Canais tematicos reutilizam radio_station e o player existente. As fontes
-- ficam normalizadas para permitir fallback sem expor essa complexidade ao UI.

alter table public.radio_station
  add column if not exists channel_type text not null default 'RADIO';

alter table public.radio_station
  drop constraint if exists radio_station_channel_type_check;
alter table public.radio_station
  add constraint radio_station_channel_type_check
  check (channel_type in ('RADIO', 'THEMATIC'));

-- Um canal tematico pode permanecer ativo e visivel mesmo quando todas as
-- fontes estao offline. Nesse caso o contrato retorna stream_url nulo.
alter table public.radio_station
  drop constraint if exists radio_station_source_check;
alter table public.radio_station
  add constraint radio_station_source_check
  check (
    not active
    or channel_type = 'THEMATIC'
    or stream_url is not null
    or playlist_url is not null
  );

create index if not exists radio_station_channel_type_idx
  on public.radio_station (channel_type, company_id, active, name);

create table if not exists public.radio_stream_source (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.radio_station(id) on delete cascade,
  source_url text not null check (btrim(source_url) <> ''),
  label text,
  priority integer not null default 1 check (priority > 0),
  resolved_stream_url text,
  playlist_format text check (playlist_format is null or playlist_format in ('M3U', 'M3U8', 'PLS')),
  stream_type text check (stream_type is null or stream_type in ('DIRECT_STREAM', 'HLS')),
  codec text,
  bitrate integer check (bitrate is null or bitrate > 0),
  stream_status text not null default 'UNKNOWN'
    check (stream_status in ('ONLINE', 'OFFLINE', 'UNKNOWN', 'INVALID', 'PLAYLIST_FOUND', 'RESOLVING')),
  last_checked_at timestamptz,
  last_online_at timestamptz,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint radio_stream_source_station_priority_uidx unique (station_id, priority),
  constraint radio_stream_source_station_url_uidx unique (station_id, source_url)
);

create index if not exists radio_stream_source_selection_idx
  on public.radio_stream_source (station_id, active, priority);

create index if not exists radio_stream_source_health_idx
  on public.radio_stream_source (active, stream_status, last_checked_at);

create or replace function public.set_radio_stream_source_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_radio_stream_source_updated_at on public.radio_stream_source;
create trigger trg_radio_stream_source_updated_at
before update on public.radio_stream_source
for each row execute function public.set_radio_stream_source_updated_at();

alter table public.radio_stream_source enable row level security;
alter table public.radio_stream_source no force row level security;

revoke all on table public.radio_stream_source from public, anon, authenticated;
grant select, insert, update, delete on table public.radio_stream_source to service_role;
revoke all on function public.set_radio_stream_source_updated_at() from public, anon, authenticated;

comment on column public.radio_station.channel_type is
  'RADIO para emissoras e THEMATIC para canais musicais continuos por genero.';
comment on table public.radio_stream_source is
  'Fontes priorizadas dos canais tematicos. O frontend recebe somente a melhor fonte online pelo contrato de radio_station.';
