alter table public.empresa drop constraint if exists empresa_regimetributario_check;
alter table public.empresa add constraint empresa_regimetributario_check
  check (regimetributario::text = any (array['1','2','3','4']));

alter table public.nfse
  add column if not exists modelo_emissao text not null default 'MUNICIPAL';
alter table public.nfse drop constraint if exists nfse_modelo_emissao_check;
alter table public.nfse add constraint nfse_modelo_emissao_check
  check (modelo_emissao in ('MUNICIPAL', 'NACIONAL'));

comment on column public.nfse.modelo_emissao is
  'MUNICIPAL usa /v2/nfse; NACIONAL usa /v2/nfsen para emitente MEI (CRT 4).';
