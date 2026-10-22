begin;
alter table public.checkout_gateway_event add column next_attempt_at timestamptz not null default now();
create index checkout_gateway_event_retry_idx on public.checkout_gateway_event(next_attempt_at) where processed_at is null;
commit;
