alter table public.config_geral
add column if not exists impressao_cor_primaria text not null default '#2563eb',
add column if not exists impressao_cor_secundaria text not null default '#0891b2';

alter table public.config_geral
drop constraint if exists config_geral_impressao_cor_primaria_chk;

alter table public.config_geral
add constraint config_geral_impressao_cor_primaria_chk
check (impressao_cor_primaria ~ '^#[0-9A-Fa-f]{6}$');

alter table public.config_geral
drop constraint if exists config_geral_impressao_cor_secundaria_chk;

alter table public.config_geral
add constraint config_geral_impressao_cor_secundaria_chk
check (impressao_cor_secundaria ~ '^#[0-9A-Fa-f]{6}$');
