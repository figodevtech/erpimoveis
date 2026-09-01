alter table public.mercadolivre_account
  add column if not exists quantity_pricing_default_enabled boolean not null default false,
  add column if not exists quantity_pricing_default_tiers jsonb not null default '[{"quantity":2,"percentage":5},{"quantity":5,"percentage":10},{"quantity":10,"percentage":15}]'::jsonb;

alter table public.mercadolivre_account
  drop constraint if exists mercadolivre_account_quantity_pricing_default_tiers_check;

alter table public.mercadolivre_account
  add constraint mercadolivre_account_quantity_pricing_default_tiers_check
  check (
    jsonb_typeof(quantity_pricing_default_tiers) = 'array'
    and jsonb_array_length(quantity_pricing_default_tiers) <= 5
  );

comment on column public.mercadolivre_account.quantity_pricing_default_enabled is
  'Quando ativo, o ERP preenche as faixas padrão ao configurar um anúncio sem preço por quantidade; não publica descontos automaticamente.';

comment on column public.mercadolivre_account.quantity_pricing_default_tiers is
  'Modelo de quantidades mínimas e percentuais usado como sugestão inicial por anúncio.';
