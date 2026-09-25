create table public.entity_video (
  id uuid primary key,
  ordemservico_id integer references public.ordemservico(id),
  produto_id integer references public.produto(id),
  venda_id integer references public.venda(id),
  category text check (category is null or length(category) between 1 and 80),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint entity_video_one_parent check (num_nonnulls(ordemservico_id,produto_id,venda_id) = 1)
);
alter table public.entity_video enable row level security;
revoke all on public.entity_video from anon, authenticated;
grant all on public.entity_video to service_role;
create index entity_video_os on public.entity_video(ordemservico_id);
create index entity_video_product on public.entity_video(produto_id);
create index entity_video_sale on public.entity_video(venda_id);
