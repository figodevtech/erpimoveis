-- Lease de renovação OAuth compartilhado entre instâncias. Acesso somente no servidor.
alter table public.mercadolivre_account
  add column if not exists refresh_lock_id uuid,
  add column if not exists refresh_lock_until timestamptz;
