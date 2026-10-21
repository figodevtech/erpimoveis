create table if not exists public.site_order_refund_request (
  order_id bigint primary key references public.venda(id),
  payment_id text not null unique,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.site_order_refund_request enable row level security;
revoke all on public.site_order_refund_request from anon, authenticated;
grant all on public.site_order_refund_request to service_role;
