begin;

create table if not exists public.checklist_documento_convite_assinatura (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid(),
  documento_id bigint not null references public.checklist_documento(id) on delete cascade,
  cpf_hmac text not null check (cpf_hmac ~ '^[0-9a-f]{64}$'),
  cpf_cifrado text not null,
  senha_hash text not null,
  senha_salt text not null,
  senha_parametros jsonb not null,
  expira_em timestamptz not null,
  criado_por uuid references public.usuario(id) on delete set null,
  criado_em timestamptz not null default now(),
  revogado_em timestamptz,
  revogado_por uuid references public.usuario(id) on delete set null,
  motivo_revogacao text check (
    motivo_revogacao is null or motivo_revogacao in (
      'MANUAL',
      'REEMITIDO',
      'SUPERADO',
      'ASSINADO_PRESENCIALMENTE'
    )
  ),
  consumido_em timestamptz,
  ultimo_acesso_em timestamptz,
  constraint checklist_documento_convite_public_id_unique unique (public_id),
  constraint checklist_documento_convite_datas_check check (
    expira_em > criado_em
    and not (revogado_em is not null and consumido_em is not null)
  )
);

create index if not exists checklist_documento_convite_documento_idx
  on public.checklist_documento_convite_assinatura (documento_id, criado_em desc, id desc);

create unique index if not exists checklist_documento_convite_um_aberto_idx
  on public.checklist_documento_convite_assinatura (documento_id)
  where revogado_em is null and consumido_em is null;

alter table public.checklist_documento_assinatura
  drop constraint if exists checklist_documento_assinatura_metodo_check;
alter table public.checklist_documento_assinatura
  add constraint checklist_documento_assinatura_metodo_check
  check (metodo in ('PRESENCIAL_DESENHADA', 'REMOTA_DESENHADA'));
alter table public.checklist_documento_assinatura
  add column if not exists convite_assinatura_id bigint
    references public.checklist_documento_convite_assinatura(id)
    on delete no action deferrable initially deferred;
create unique index if not exists checklist_documento_assinatura_convite_unique
  on public.checklist_documento_assinatura (convite_assinatura_id)
  where convite_assinatura_id is not null;
alter table public.checklist_documento_assinatura
  drop constraint if exists checklist_documento_assinatura_convite_metodo_check;
alter table public.checklist_documento_assinatura
  add constraint checklist_documento_assinatura_convite_metodo_check check (
    (metodo = 'PRESENCIAL_DESENHADA' and convite_assinatura_id is null)
    or (metodo = 'REMOTA_DESENHADA' and convite_assinatura_id is not null)
  );

alter table public.checklist_documento_convite_assinatura enable row level security;
alter table public.checklist_documento_convite_assinatura no force row level security;
revoke all on public.checklist_documento_convite_assinatura from public, anon, authenticated;
grant select, insert, update on public.checklist_documento_convite_assinatura to service_role;
grant usage, select on sequence public.checklist_documento_convite_assinatura_id_seq to service_role;

create or replace function public.proteger_credenciais_convite_checklist()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.public_id is distinct from old.public_id
    or new.documento_id is distinct from old.documento_id
    or new.cpf_hmac is distinct from old.cpf_hmac
    or new.cpf_cifrado is distinct from old.cpf_cifrado
    or new.senha_hash is distinct from old.senha_hash
    or new.senha_salt is distinct from old.senha_salt
    or new.senha_parametros is distinct from old.senha_parametros
    or new.expira_em is distinct from old.expira_em
    or new.criado_por is distinct from old.criado_por
    or new.criado_em is distinct from old.criado_em then
    raise exception 'As credenciais do convite de assinatura sao imutaveis.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_credenciais_convite_checklist
  on public.checklist_documento_convite_assinatura;
create trigger proteger_credenciais_convite_checklist
before update on public.checklist_documento_convite_assinatura
for each row execute function public.proteger_credenciais_convite_checklist();

create or replace function public.criar_convite_assinatura_checklist(
  p_documento_public_id uuid,
  p_convite_public_id uuid,
  p_cpf_hmac text,
  p_cpf_cifrado text,
  p_senha_hash text,
  p_senha_salt text,
  p_senha_parametros jsonb,
  p_expira_em timestamptz,
  p_criado_por uuid,
  p_request_ip text default null,
  p_user_agent text default null
)
returns table (
  convite_id bigint,
  convite_public_id uuid,
  documento_id bigint,
  criado_em timestamptz,
  expira_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.checklist_documento%rowtype;
  novo public.checklist_documento_convite_assinatura%rowtype;
begin
  select * into doc
  from public.checklist_documento
  where public_id = p_documento_public_id
  for update;

  if not found then
    raise exception 'Versao do checklist nao encontrada.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.checklist_documento posterior
    where posterior.ordemservico_id = doc.ordemservico_id
      and posterior.tipo = doc.tipo
      and posterior.versao > doc.versao
  ) then
    raise exception 'Somente a versao mais recente pode receber convite.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.checklist_documento_assinatura assinatura
    where assinatura.documento_id = doc.id
  ) then
    raise exception 'Esta versao ja foi assinada.' using errcode = '55000';
  end if;
  if p_expira_em <= now() then
    raise exception 'A validade do convite deve estar no futuro.' using errcode = '22023';
  end if;

  update public.checklist_documento_convite_assinatura convite
     set revogado_em = now(),
         revogado_por = p_criado_por,
         motivo_revogacao = 'REEMITIDO'
   where convite.documento_id = doc.id
     and convite.revogado_em is null
     and convite.consumido_em is null;

  insert into public.checklist_documento_convite_assinatura (
    public_id,
    documento_id,
    cpf_hmac,
    cpf_cifrado,
    senha_hash,
    senha_salt,
    senha_parametros,
    expira_em,
    criado_por
  ) values (
    p_convite_public_id,
    doc.id,
    p_cpf_hmac,
    p_cpf_cifrado,
    p_senha_hash,
    p_senha_salt,
    p_senha_parametros,
    p_expira_em,
    p_criado_por
  ) returning * into novo;

  insert into public.checklist_documento_evento (
    documento_id, tipo, usuario_id, request_ip, user_agent, metadados
  ) values (
    doc.id,
    'CONVITE_ASSINATURA_CRIADO',
    p_criado_por,
    case when p_request_ip is null then null else p_request_ip::inet end,
    left(p_user_agent, 1000),
    jsonb_build_object(
      'convitePublicId', novo.public_id,
      'expiraEm', novo.expira_em
    )
  );

  convite_id := novo.id;
  convite_public_id := novo.public_id;
  documento_id := novo.documento_id;
  criado_em := novo.criado_em;
  expira_em := novo.expira_em;
  return next;
end;
$$;

create or replace function public.revogar_convite_assinatura_checklist(
  p_documento_public_id uuid,
  p_revogado_por uuid,
  p_request_ip text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  doc_id bigint;
  convite_id bigint;
begin
  select id into doc_id
  from public.checklist_documento
  where public_id = p_documento_public_id;
  if not found then
    raise exception 'Versao do checklist nao encontrada.' using errcode = 'P0002';
  end if;

  select id into convite_id
  from public.checklist_documento_convite_assinatura
  where documento_id = doc_id
    and revogado_em is null
    and consumido_em is null
  order by criado_em desc, id desc
  limit 1
  for update;

  if convite_id is null then return false; end if;

  update public.checklist_documento_convite_assinatura
     set revogado_em = now(),
         revogado_por = p_revogado_por,
         motivo_revogacao = 'MANUAL'
   where id = convite_id;

  insert into public.checklist_documento_evento (
    documento_id, tipo, usuario_id, request_ip, user_agent, metadados
  ) values (
    doc_id,
    'CONVITE_ASSINATURA_REVOGADO',
    p_revogado_por,
    case when p_request_ip is null then null else p_request_ip::inet end,
    left(p_user_agent, 1000),
    jsonb_build_object('conviteId', convite_id, 'motivo', 'MANUAL')
  );
  return true;
end;
$$;

create or replace function public.assinar_checklist_remotamente(
  p_convite_public_id uuid,
  p_snapshot_hash text,
  p_signatario_nome text,
  p_signatario_documento text,
  p_signatario_qualidade text,
  p_qualidade_outro text,
  p_declaracao text,
  p_declaracao_hash text,
  p_assinatura_path text,
  p_assinatura_hash text,
  p_assinatura_vinculo_hash text,
  p_request_ip text default null,
  p_user_agent text default null
)
returns table (assinatura_id bigint, documento_id bigint, assinado_em timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  convite public.checklist_documento_convite_assinatura%rowtype;
  doc public.checklist_documento%rowtype;
  nova_assinatura public.checklist_documento_assinatura%rowtype;
  v_documento_id bigint;
begin
  -- Mantem a mesma ordem de bloqueio da criacao de convite (documento ->
  -- convite), evitando deadlock entre uma reemissao e uma assinatura.
  select convite_base.documento_id into v_documento_id
  from public.checklist_documento_convite_assinatura convite_base
  where convite_base.public_id = p_convite_public_id;
  if not found then
    raise exception 'Convite invalido ou indisponivel.' using errcode = 'P0002';
  end if;

  select * into doc
  from public.checklist_documento
  where id = v_documento_id
  for update;

  select * into convite
  from public.checklist_documento_convite_assinatura
  where public_id = p_convite_public_id
    and documento_id = doc.id
  for update;
  if not found then
    raise exception 'Convite invalido ou indisponivel.' using errcode = 'P0002';
  end if;

  if convite.revogado_em is not null
    or convite.consumido_em is not null
    or convite.expira_em <= now() then
    raise exception 'Convite invalido ou indisponivel.' using errcode = '55000';
  end if;
  if p_snapshot_hash is distinct from doc.snapshot_hash then
    raise exception 'O snapshot do checklist foi alterado.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.checklist_documento posterior
    where posterior.ordemservico_id = doc.ordemservico_id
      and posterior.tipo = doc.tipo
      and posterior.versao > doc.versao
  ) then
    raise exception 'Existe uma versao posterior deste checklist.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.checklist_documento_assinatura assinatura
    where assinatura.documento_id = doc.id
  ) then
    raise exception 'Esta versao ja foi assinada.' using errcode = '23505';
  end if;

  insert into public.checklist_documento_assinatura (
    documento_id,
    signatario_nome,
    signatario_documento,
    signatario_qualidade,
    qualidade_outro,
    declaracao,
    declaracao_hash,
    metodo,
    assinatura_path,
    assinatura_hash,
    assinatura_vinculo_hash,
    snapshot_hash,
    operador_usuario_id,
    request_ip,
    user_agent,
    assinado_em,
    convite_assinatura_id
  ) values (
    doc.id,
    p_signatario_nome,
    p_signatario_documento,
    p_signatario_qualidade,
    p_qualidade_outro,
    p_declaracao,
    p_declaracao_hash,
    'REMOTA_DESENHADA',
    p_assinatura_path,
    p_assinatura_hash,
    p_assinatura_vinculo_hash,
    doc.snapshot_hash,
    null,
    case when p_request_ip is null then null else p_request_ip::inet end,
    left(p_user_agent, 1000),
    now(),
    convite.id
  ) returning * into nova_assinatura;

  update public.checklist_documento_convite_assinatura
     set consumido_em = nova_assinatura.assinado_em,
         ultimo_acesso_em = coalesce(ultimo_acesso_em, nova_assinatura.assinado_em)
   where id = convite.id;

  insert into public.checklist_documento_evento (
    documento_id, tipo, request_ip, user_agent, metadados
  ) values (
    doc.id,
    'ASSINATURA_REMOTA_REGISTRADA',
    case when p_request_ip is null then null else p_request_ip::inet end,
    left(p_user_agent, 1000),
    jsonb_build_object(
      'convitePublicId', convite.public_id,
      'metodo', 'REMOTA_DESENHADA',
      'autenticacao', 'LINK_CPF_SENHA',
      'assinaturaHash', p_assinatura_hash,
      'assinaturaVinculoHash', p_assinatura_vinculo_hash
    )
  );

  assinatura_id := nova_assinatura.id;
  documento_id := doc.id;
  assinado_em := nova_assinatura.assinado_em;
  return next;
end;
$$;

create or replace function public.invalidar_convites_checklist_por_nova_versao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  with revogados as (
    update public.checklist_documento_convite_assinatura convite
       set revogado_em = now(),
           motivo_revogacao = 'SUPERADO'
      from public.checklist_documento anterior
     where convite.documento_id = anterior.id
       and anterior.ordemservico_id = new.ordemservico_id
       and anterior.tipo = new.tipo
       and anterior.versao < new.versao
       and convite.revogado_em is null
       and convite.consumido_em is null
    returning convite.documento_id, convite.id
  )
  insert into public.checklist_documento_evento (documento_id, tipo, metadados)
  select documento_id, 'CONVITE_ASSINATURA_SUPERADO', jsonb_build_object(
    'conviteId', id,
    'novaVersao', new.versao,
    'novaVersaoPublicId', new.public_id
  ) from revogados;
  return new;
end;
$$;

drop trigger if exists invalidar_convites_checklist_por_nova_versao
  on public.checklist_documento;
create trigger invalidar_convites_checklist_por_nova_versao
after insert on public.checklist_documento
for each row execute function public.invalidar_convites_checklist_por_nova_versao();

create or replace function public.invalidar_convites_checklist_por_assinatura_presencial()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.metodo <> 'PRESENCIAL_DESENHADA' then return new; end if;
  with revogados as (
    update public.checklist_documento_convite_assinatura convite
       set revogado_em = now(),
           motivo_revogacao = 'ASSINADO_PRESENCIALMENTE'
     where convite.documento_id = new.documento_id
       and convite.revogado_em is null
       and convite.consumido_em is null
    returning convite.id
  )
  insert into public.checklist_documento_evento (documento_id, tipo, metadados)
  select new.documento_id, 'CONVITE_ASSINATURA_REVOGADO', jsonb_build_object(
    'conviteId', id,
    'motivo', 'ASSINADO_PRESENCIALMENTE'
  ) from revogados;
  return new;
end;
$$;

drop trigger if exists invalidar_convites_checklist_por_assinatura_presencial
  on public.checklist_documento_assinatura;
create trigger invalidar_convites_checklist_por_assinatura_presencial
after insert on public.checklist_documento_assinatura
for each row execute function public.invalidar_convites_checklist_por_assinatura_presencial();

revoke all on function public.criar_convite_assinatura_checklist(
  uuid, uuid, text, text, text, text, jsonb, timestamptz, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.revogar_convite_assinatura_checklist(
  uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.assinar_checklist_remotamente(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.criar_convite_assinatura_checklist(
  uuid, uuid, text, text, text, text, jsonb, timestamptz, uuid, text, text
) to service_role;
grant execute on function public.revogar_convite_assinatura_checklist(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.assinar_checklist_remotamente(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) to service_role;

do $$
begin
  if to_regprocedure('public.habilitar_auditoria_tabela(regclass)') is not null then
    perform public.habilitar_auditoria_tabela('public.checklist_documento_convite_assinatura'::regclass);
  end if;
end;
$$;

commit;
