begin;

-- `documento_id` tambem e uma coluna de retorno desta funcao e, por isso,
-- vira uma variavel implicita do PL/pgSQL. Qualificar as colunas do convite
-- evita o erro 42702 antes da insercao da assinatura.
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
  select convite_base.documento_id into v_documento_id
  from public.checklist_documento_convite_assinatura convite_base
  where convite_base.public_id = p_convite_public_id;
  if not found then
    raise exception 'Convite invalido ou indisponivel.' using errcode = 'P0002';
  end if;

  select documento.* into doc
  from public.checklist_documento documento
  where documento.id = v_documento_id
  for update;

  select convite_registro.* into convite
  from public.checklist_documento_convite_assinatura convite_registro
  where convite_registro.public_id = p_convite_public_id
    and convite_registro.documento_id = doc.id
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

  update public.checklist_documento_convite_assinatura convite_registro
     set consumido_em = nova_assinatura.assinado_em,
         ultimo_acesso_em = coalesce(convite_registro.ultimo_acesso_em, nova_assinatura.assinado_em)
   where convite_registro.id = convite.id;

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

revoke all on function public.assinar_checklist_remotamente(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.assinar_checklist_remotamente(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) to service_role;

commit;
