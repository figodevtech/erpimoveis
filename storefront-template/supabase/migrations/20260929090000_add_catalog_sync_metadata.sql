-- Compatibilidade para uma base de loja existente antes da separacao.
alter table if exists public.produto
  add column if not exists visible boolean not null default true,
  add column if not exists erp_updated_at timestamptz,
  add column if not exists synced_at timestamptz not null default now();
