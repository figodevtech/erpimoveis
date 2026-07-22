alter table public.nfse drop constraint if exists nfse_modelo_emissao_check;
alter table public.nfse add constraint nfse_modelo_emissao_check
  check (modelo_emissao in ('MUNICIPAL', 'MUNICIPAL_JOAO_PESSOA', 'MUNICIPAL_CABEDELO', 'NACIONAL'));

comment on column public.nfse.modelo_emissao is
  'Estratégia Focus: municipal legado/João Pessoa/Cabedelo ou NFS-e Nacional.';
