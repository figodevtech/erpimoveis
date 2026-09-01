begin;

create table if not exists public.checklist_documento (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid(),
  codigo text not null,
  token_verificacao uuid not null default gen_random_uuid(),
  ordemservico_id bigint not null references public.ordemservico(id) on delete cascade,
  tipo text not null check (tipo in ('ENTRADA', 'SAIDA')),
  versao integer not null check (versao > 0),
  versao_anterior_id bigint references public.checklist_documento(id) on delete restrict,
  schema_version integer not null default 1 check (schema_version > 0),
  snapshot jsonb not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  conteudo_hash text not null check (conteudo_hash ~ '^[0-9a-f]{64}$'),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  mudancas_resumo jsonb not null default '{}'::jsonb,
  criado_por uuid references public.usuario(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint checklist_documento_public_id_unique unique (public_id),
  constraint checklist_documento_codigo_unique unique (codigo),
  constraint checklist_documento_token_unique unique (token_verificacao),
  constraint checklist_documento_os_tipo_versao_unique unique (ordemservico_id, tipo, versao)
);

create index if not exists checklist_documento_os_tipo_idx
  on public.checklist_documento (ordemservico_id, tipo, versao desc);
create index if not exists checklist_documento_conteudo_hash_idx
  on public.checklist_documento (ordemservico_id, tipo, conteudo_hash);

create table if not exists public.checklist_documento_assinatura (
  id bigint generated always as identity primary key,
  documento_id bigint not null references public.checklist_documento(id) on delete cascade,
  signatario_nome text not null,
  signatario_documento text not null check (signatario_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  signatario_qualidade text not null check (signatario_qualidade in ('CLIENTE', 'PROPRIETARIO', 'RECEBEDOR', 'OUTRO')),
  qualidade_outro text,
  declaracao text not null,
  declaracao_hash text not null check (declaracao_hash ~ '^[0-9a-f]{64}$'),
  metodo text not null default 'PRESENCIAL_DESENHADA' check (metodo = 'PRESENCIAL_DESENHADA'),
  assinatura_path text not null,
  assinatura_hash text not null check (assinatura_hash ~ '^[0-9a-f]{64}$'),
  assinatura_vinculo_hash text not null check (assinatura_vinculo_hash ~ '^[0-9a-f]{64}$'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  operador_usuario_id uuid references public.usuario(id) on delete set null,
  request_ip inet,
  user_agent text,
  assinado_em timestamptz not null,
  constraint checklist_documento_assinatura_documento_unique unique (documento_id),
  constraint checklist_documento_assinatura_outro_check check (
    signatario_qualidade <> 'OUTRO' or nullif(btrim(qualidade_outro), '') is not null
  )
);

create table if not exists public.checklist_documento_arquivo (
  id bigint generated always as identity primary key,
  documento_id bigint not null references public.checklist_documento(id) on delete cascade,
  storage_path text not null,
  pdf_hash text not null check (pdf_hash ~ '^[0-9a-f]{64}$'),
  tamanho_bytes bigint not null check (tamanho_bytes > 0),
  gerador_versao text not null,
  criado_em timestamptz not null default now(),
  constraint checklist_documento_arquivo_documento_unique unique (documento_id),
  constraint checklist_documento_arquivo_path_unique unique (storage_path)
);

create table if not exists public.checklist_documento_evento (
  id bigint generated always as identity primary key,
  documento_id bigint not null references public.checklist_documento(id) on delete cascade,
  tipo text not null,
  usuario_id uuid references public.usuario(id) on delete set null,
  request_ip inet,
  user_agent text,
  metadados jsonb not null default '{}'::jsonb,
  ocorrido_em timestamptz not null default now()
);

create or replace function public.validar_assinatura_ultima_versao_checklist()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  doc public.checklist_documento%rowtype;
begin
  select * into doc
  from public.checklist_documento
  where id = new.documento_id;

  if not found then
    raise exception 'Documento de checklist nao encontrado.' using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.checklist_documento posterior
    where posterior.ordemservico_id = doc.ordemservico_id
      and posterior.tipo = doc.tipo
      and posterior.versao > doc.versao
  ) then
    raise exception 'Somente a versao mais recente do checklist pode ser assinada.' using errcode = '55000';
  end if;

  if new.snapshot_hash is distinct from doc.snapshot_hash then
    raise exception 'A assinatura nao corresponde ao snapshot armazenado.' using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists validar_assinatura_ultima_versao_checklist on public.checklist_documento_assinatura;
create trigger validar_assinatura_ultima_versao_checklist
before insert on public.checklist_documento_assinatura
for each row execute function public.validar_assinatura_ultima_versao_checklist();

create index if not exists checklist_documento_evento_documento_idx
  on public.checklist_documento_evento (documento_id, ocorrido_em, id);

alter table public.checklist_documento enable row level security;
alter table public.checklist_documento_assinatura enable row level security;
alter table public.checklist_documento_arquivo enable row level security;
alter table public.checklist_documento_evento enable row level security;
alter table public.checklist_documento no force row level security;
alter table public.checklist_documento_assinatura no force row level security;
alter table public.checklist_documento_arquivo no force row level security;
alter table public.checklist_documento_evento no force row level security;

revoke all on public.checklist_documento from public, anon, authenticated;
revoke all on public.checklist_documento_assinatura from public, anon, authenticated;
revoke all on public.checklist_documento_arquivo from public, anon, authenticated;
revoke all on public.checklist_documento_evento from public, anon, authenticated;
grant select, insert on public.checklist_documento to service_role;
grant select, insert on public.checklist_documento_assinatura to service_role;
grant select, insert on public.checklist_documento_arquivo to service_role;
grant select, insert on public.checklist_documento_evento to service_role;
grant usage, select on sequence public.checklist_documento_id_seq to service_role;
grant usage, select on sequence public.checklist_documento_assinatura_id_seq to service_role;
grant usage, select on sequence public.checklist_documento_arquivo_id_seq to service_role;
grant usage, select on sequence public.checklist_documento_evento_id_seq to service_role;

create or replace function public.proteger_checklist_documento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Versoes de checklist sao imutaveis.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.checklist_documento_assinatura a where a.documento_id = old.id
  ) then
    raise exception 'Documento assinado nao pode ser excluido.' using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists proteger_checklist_documento on public.checklist_documento;
create trigger proteger_checklist_documento
before update or delete on public.checklist_documento
for each row execute function public.proteger_checklist_documento();

create or replace function public.proteger_registro_documental_assinado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Registro documental imutavel.' using errcode = '55000';
end;
$$;

drop trigger if exists proteger_checklist_documento_assinatura on public.checklist_documento_assinatura;
create trigger proteger_checklist_documento_assinatura
before update or delete on public.checklist_documento_assinatura
for each row execute function public.proteger_registro_documental_assinado();

drop trigger if exists proteger_checklist_documento_arquivo on public.checklist_documento_arquivo;
create trigger proteger_checklist_documento_arquivo
before update or delete on public.checklist_documento_arquivo
for each row execute function public.proteger_registro_documental_assinado();

create or replace function public.proteger_checklist_documento_evento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Eventos documentais sao imutaveis.' using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists proteger_checklist_documento_evento on public.checklist_documento_evento;
create trigger proteger_checklist_documento_evento
before update on public.checklist_documento_evento
for each row execute function public.proteger_checklist_documento_evento();

do $$
begin
  if to_regprocedure('public.habilitar_auditoria_tabela(regclass)') is not null then
    perform public.habilitar_auditoria_tabela('public.checklist_documento'::regclass);
    perform public.habilitar_auditoria_tabela('public.checklist_documento_assinatura'::regclass);
    perform public.habilitar_auditoria_tabela('public.checklist_documento_arquivo'::regclass);
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checklist_documentos',
  'checklist_documentos',
  false,
  52428800,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
