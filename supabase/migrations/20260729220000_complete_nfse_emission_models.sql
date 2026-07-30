alter table public.empresa
  drop constraint if exists empresa_regimetributario_check;

alter table public.empresa
  add constraint empresa_regimetributario_check
  check (regimetributario::text = any (array['1', '2', '3', '4']));

alter table public.nfse
  add column if not exists modelo_emissao text,
  add column if not exists servico_ids integer[],
  add column if not exists itens jsonb,
  add column if not exists informacoes_complementares text;

update public.nfse
set modelo_emissao = 'MUNICIPAL'
where modelo_emissao is null;

update public.nfse
set servico_ids = array[
  ((regexp_match(referencia, '^OS_[0-9]+_SRV_([0-9]+)_'))[1])::integer
]
where servico_ids is null
  and referencia ~ '^OS_[0-9]+_SRV_[0-9]+_';

update public.nfse
set servico_ids = '{}'::integer[]
where servico_ids is null;

update public.nfse
set itens = '[]'::jsonb
where itens is null;

alter table public.nfse
  alter column modelo_emissao set not null,
  alter column modelo_emissao drop default,
  alter column servico_ids set not null,
  alter column servico_ids drop default,
  alter column itens set not null,
  alter column itens drop default;

alter table public.nfse
  drop constraint if exists nfse_modelo_emissao_check;

alter table public.nfse
  add constraint nfse_modelo_emissao_check
  check (modelo_emissao in (
    'MUNICIPAL',
    'MUNICIPAL_JOAO_PESSOA',
    'MUNICIPAL_CABEDELO',
    'NACIONAL'
  ));

alter table public.nfse
  drop constraint if exists nfse_itens_array_check;

alter table public.nfse
  add constraint nfse_itens_array_check
  check (jsonb_typeof(itens) = 'array');

alter table public.nfse
  drop constraint if exists nfse_informacoes_complementares_length_check;

alter table public.nfse
  add constraint nfse_informacoes_complementares_length_check
  check (
    informacoes_complementares is null
    or char_length(informacoes_complementares) <= 2000
  );

create index if not exists idx_nfse_servico_ids
  on public.nfse using gin (servico_ids);

comment on column public.nfse.modelo_emissao is
  'Estratégia Focus usada na emissão, consulta e cancelamento da NFS-e.';

comment on column public.nfse.servico_ids is
  'IDs dos serviços da OS consolidados nesta NFS-e.';

comment on column public.nfse.itens is
  'Snapshot dos serviços e valores efetivamente informados na emissão.';

comment on column public.nfse.informacoes_complementares is
  'Texto livre informado pelo contribuinte durante a emissão.';
