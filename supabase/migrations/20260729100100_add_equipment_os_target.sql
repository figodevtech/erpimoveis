alter table public.ordemservico
  add column if not exists equipamento_nome text,
  add column if not exists equipamento_patrimonio text,
  add column if not exists equipamento_ano integer,
  add column if not exists equipamento_horimetro numeric(12, 1);

alter table public.ordemservico
  drop constraint if exists ordemservico_equipamento_nome_nao_vazio,
  drop constraint if exists ordemservico_equipamento_ano_valido,
  drop constraint if exists ordemservico_equipamento_horimetro_valido;

alter table public.ordemservico
  add constraint ordemservico_equipamento_nome_nao_vazio
  check (equipamento_nome is null or btrim(equipamento_nome) <> ''),
  add constraint ordemservico_equipamento_ano_valido
  check (equipamento_ano is null or equipamento_ano between 1900 and 3000),
  add constraint ordemservico_equipamento_horimetro_valido
  check (equipamento_horimetro is null or equipamento_horimetro >= 0);

alter table public.ordemservico
  drop constraint if exists ordemservico_alvo_consistente;

alter table public.ordemservico
  add constraint ordemservico_alvo_consistente
  check (
    (
      alvo_tipo = 'VEICULO'::public.enum_alvo_reparo
      and pecaid is null
      and equipamento_nome is null
    )
    or (
      alvo_tipo = 'PECA'::public.enum_alvo_reparo
      and pecaid is not null
      and veiculoid is null
      and equipamento_nome is null
    )
    or (
      alvo_tipo = 'EQUIPAMENTO'::public.enum_alvo_reparo
      and veiculoid is null
      and pecaid is null
      and equipamento_nome is not null
      and btrim(equipamento_nome) <> ''
    )
  );

comment on column public.ordemservico.equipamento_nome is
  'Snapshot do nome da máquina ou equipamento atendido.';

comment on column public.ordemservico.equipamento_patrimonio is
  'Snapshot do número de patrimônio ou código interno do equipamento.';

comment on column public.ordemservico.equipamento_ano is
  'Snapshot do ano do equipamento.';

comment on column public.ordemservico.equipamento_horimetro is
  'Snapshot das horas acumuladas do equipamento no atendimento.';
