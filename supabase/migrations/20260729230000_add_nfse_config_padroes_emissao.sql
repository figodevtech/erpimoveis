alter table public.nfse_config
  add column if not exists padroes_emissao jsonb not null default '{}'::jsonb;

alter table public.nfse_config
  drop constraint if exists nfse_config_padroes_emissao_object_check;

alter table public.nfse_config
  add constraint nfse_config_padroes_emissao_object_check
  check (jsonb_typeof(padroes_emissao) = 'object');

comment on column public.nfse_config.padroes_emissao is
  'Códigos fiscais padrão por modelo de emissão (chaves: MUNICIPAL_JOAO_PESSOA, MUNICIPAL_CABEDELO, NACIONAL), usados para pré-preencher o formulário de emissão da NFS-e.';
