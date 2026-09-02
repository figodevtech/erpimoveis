begin;

create table if not exists public.system_notification (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  category text not null default 'SYSTEM',
  priority text not null default 'INFO',
  title text not null,
  message text not null,
  href text,
  source text not null,
  source_event_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint system_notification_category_check check (
    category in ('MARKETPLACE', 'SALES', 'STOCK', 'FINANCIAL', 'SYSTEM')
  ),
  constraint system_notification_priority_check check (
    priority in ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL')
  ),
  constraint system_notification_title_check check (length(btrim(title)) between 1 and 160),
  constraint system_notification_message_check check (length(btrim(message)) between 1 and 1000),
  constraint system_notification_source_check check (length(btrim(source)) between 1 and 80),
  constraint system_notification_source_event_check check (length(btrim(source_event_id)) between 1 and 240),
  constraint system_notification_user_event_key unique (usuario_id, source, source_event_id)
);

create index if not exists system_notification_user_created_idx
  on public.system_notification(usuario_id, created_at desc, id desc);

create index if not exists system_notification_user_unread_idx
  on public.system_notification(usuario_id, created_at desc, id desc)
  where read_at is null;

comment on table public.system_notification is
  'Central de notificacoes interna. Cada destinatario possui leitura independente.';

alter table public.system_notification enable row level security;
alter table public.system_notification no force row level security;

revoke all on table public.system_notification from public, anon, authenticated;
grant all on table public.system_notification to service_role;
grant usage, select on sequence public.system_notification_id_seq to service_role;

commit;
