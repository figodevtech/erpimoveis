alter table public.mercadolivre_account
  add column if not exists default_listing_type_id text not null default 'gold_special';

alter table public.mercadolivre_account
  drop constraint if exists mercadolivre_account_default_listing_type_check;

alter table public.mercadolivre_account
  add constraint mercadolivre_account_default_listing_type_check
  check (default_listing_type_id in ('free', 'gold_special', 'gold_pro'));

comment on column public.mercadolivre_account.default_listing_type_id is
  'Tipo de publicação preferido pelo vendedor no ERP; a disponibilidade final depende da categoria e da conta no Mercado Livre.';
