create table public.checklist_video (
 id uuid primary key,
 ordemservicoid integer not null references public.ordemservico(id),
 kind text not null check(kind in ('entrada','saida')),
 item_id bigint not null,
 created_by uuid not null,
 created_at timestamptz not null default now()
);
alter table public.checklist_video enable row level security;
revoke all on public.checklist_video from anon,authenticated;
grant all on public.checklist_video to service_role;
create index checklist_video_os on public.checklist_video(ordemservicoid);
