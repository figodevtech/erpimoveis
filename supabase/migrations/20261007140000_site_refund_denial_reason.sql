begin;
alter table public.site_order_link add column if not exists refund_denial_reason text;
commit;
