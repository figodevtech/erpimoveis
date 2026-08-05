alter table public.ordemservico
  add column if not exists pagamento_concluido_em timestamptz;

-- Antes desta mudanca, datasaida era preenchida quando o pagamento terminava.
-- Preservamos esse instante como conclusao financeira para os registros existentes.
update public.ordemservico
set pagamento_concluido_em = datasaida
where status::text = 'CONCLUIDO'
  and pagamento_concluido_em is null
  and datasaida is not null;

create table if not exists public.os_saida (
  id bigint generated always as identity primary key,
  ordemservico_id bigint not null references public.ordemservico(id) on delete cascade,
  saida_em timestamptz not null default now(),
  retirado_por text,
  documento_observacao text,
  checklist_modelo_id bigint references public.checklist_modelo(id) on delete set null,
  registrado_por uuid not null references public.usuario(id),
  created_by uuid not null references public.usuario(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_saida_ordemservico_unique unique (ordemservico_id)
);

create table if not exists public.os_saida_checklist_item (
  id bigint generated always as identity primary key,
  os_saida_id bigint not null references public.os_saida(id) on delete cascade,
  modelo_item_id bigint references public.checklist_modelo_item(id) on delete set null,
  titulo text not null,
  descricao text,
  categoria text,
  status public.enum_status_checklist not null,
  observacao text,
  ordem integer not null default 0,
  created_by uuid not null references public.usuario(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_saida_checklist_item_unique unique (os_saida_id, titulo)
);

create index if not exists os_saida_checklist_item_saida_idx
  on public.os_saida_checklist_item(os_saida_id);

alter table public.os_saida enable row level security;
alter table public.os_saida_checklist_item enable row level security;
alter table public.os_saida no force row level security;
alter table public.os_saida_checklist_item no force row level security;

grant select, insert, update, delete on public.os_saida to authenticated, service_role;
grant select, insert, update, delete on public.os_saida_checklist_item to authenticated, service_role;
grant usage, select on sequence public.os_saida_id_seq to authenticated, service_role;
grant usage, select on sequence public.os_saida_checklist_item_id_seq to authenticated, service_role;

-- Regra de seguranca central: concluir ou finalizar sem cobranca nunca equivale
-- a registrar a retirada fisica. A data de saida so e aceita quando os_saida existe.
create or replace function public.separar_conclusao_financeira_da_saida_os()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status::text = 'CONCLUIDO'
     and old.status::text is distinct from 'CONCLUIDO' then
    new.pagamento_concluido_em := coalesce(new.pagamento_concluido_em, new.datasaida, now());
  end if;
  if old.status::text = 'CONCLUIDO' and new.status::text = 'PAGAMENTO' then
    new.pagamento_concluido_em := null;
  end if;

  if new.datasaida is distinct from old.datasaida
     and not exists (
       select 1 from public.os_saida s where s.ordemservico_id = old.id
     ) then
    new.datasaida := old.datasaida;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_separar_conclusao_financeira_saida on public.ordemservico;
create trigger trg_separar_conclusao_financeira_saida
before update on public.ordemservico
for each row execute function public.separar_conclusao_financeira_da_saida_os();

do $$
begin
  if to_regprocedure('public.habilitar_auditoria_tabela(regclass)') is not null then
    perform public.habilitar_auditoria_tabela('public.os_saida'::regclass);
    perform public.habilitar_auditoria_tabela('public.os_saida_checklist_item'::regclass);
  end if;
end;
$$;
