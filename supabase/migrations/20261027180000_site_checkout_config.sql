begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
create table public.site_product_checkout_config (
  produto_id integer primary key references public.produto(id),
  policy jsonb not null default '{"maxInstallments":1,"minimumInstallment":5,"interestFreeInstallments":1,"monthlyInterestPercent":0,"shippingRates":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.site_product_checkout_config enable row level security;
revoke all on public.site_product_checkout_config from public,anon,authenticated;
grant all on public.site_product_checkout_config to service_role;
commit;
