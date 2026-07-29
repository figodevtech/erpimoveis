-- Propaga o usuario autenticado da aplicacao para operacoes executadas com
-- service_role. O cabecalho so e aceito quando o JWT assinado e realmente da
-- service_role; clientes anon/authenticated nao podem atribuir eventos a outro
-- usuario apenas enviando x-audit-user-id.
alter table public.auditoria_evento
  add column if not exists ator_nome text;

alter table public.auditoria_evento
  drop constraint if exists auditoria_evento_origem_check;
alter table public.auditoria_evento
  add constraint auditoria_evento_origem_check
  check (origem in ('usuario', 'sistema', 'cliente'));

-- Antes desta correcao, INSERT em osservico_realizador confundia o usuario
-- atribuido com o autor da atribuicao. Como o autor historico real nao pode ser
-- reconstruido com seguranca, esses eventos deixam de acusar a pessoa designada.
update public.auditoria_evento
set
  usuario_id = null,
  origem = 'sistema',
  ator_nome = 'Autor não identificado (atribuição anterior à correção)'
where tabela = 'osservico_realizador'
  and operacao = 'INSERT'
  and id <= 10178
  and usuario_id is not null
  and usuario_id = public.auditoria_try_uuid(dados_novos ->> 'usuarioid');

create or replace function public.auditoria_usuario_requisicao()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  claims_raw text := nullif(current_setting('request.jwt.claims', true), '');
  headers_raw text := nullif(current_setting('request.headers', true), '');
  role_requisicao text;
begin
  if claims_raw is null or headers_raw is null then
    return null;
  end if;

  role_requisicao := claims_raw::jsonb ->> 'role';
  if role_requisicao <> 'service_role' then
    return null;
  end if;

  return public.auditoria_try_uuid(headers_raw::jsonb ->> 'x-audit-user-id');
exception when others then
  return null;
end;
$$;

revoke all on function public.auditoria_usuario_requisicao()
  from public, anon, authenticated;
grant execute on function public.auditoria_usuario_requisicao()
  to service_role;

create or replace function public.auditoria_contexto_externo_requisicao()
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  claims_raw text := nullif(current_setting('request.jwt.claims', true), '');
  headers_raw text := nullif(current_setting('request.headers', true), '');
  headers_json jsonb;
  tipo text;
  nome text;
begin
  if claims_raw is null or headers_raw is null then
    return null;
  end if;
  if claims_raw::jsonb ->> 'role' <> 'service_role' then
    return null;
  end if;

  headers_json := headers_raw::jsonb;
  tipo := lower(coalesce(headers_json ->> 'x-audit-actor-type', ''));
  if tipo <> 'cliente' then
    return null;
  end if;

  nome := left(nullif(btrim(headers_json ->> 'x-audit-actor-name'), ''), 120);
  return jsonb_build_object(
    'origem', tipo,
    'nome', coalesce(nome, 'Cliente via link de aprovacao')
  );
exception when others then
  return null;
end;
$$;

revoke all on function public.auditoria_contexto_externo_requisicao()
  from public, anon, authenticated;
grant execute on function public.auditoria_contexto_externo_requisicao()
  to service_role;

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  anterior jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  novo jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  anterior_alterado jsonb;
  novo_alterado jsonb;
  campos text[] := '{}'::text[];
  linha_referencia jsonb;
  ator uuid;
  contexto_externo jsonb;
  id_registro text;
begin
  if tg_op = 'UPDATE' and anterior = novo then
    return new;
  end if;

  linha_referencia := coalesce(novo, anterior);

  if tg_op = 'UPDATE' then
    select
      coalesce(jsonb_object_agg(chave, anterior -> chave), '{}'::jsonb),
      coalesce(jsonb_object_agg(chave, novo -> chave), '{}'::jsonb),
      coalesce(array_agg(chave order by chave), '{}'::text[])
    into anterior_alterado, novo_alterado, campos
    from (
      select chave
      from jsonb_object_keys(anterior || novo) as chaves(chave)
      where (anterior -> chave) is distinct from (novo -> chave)
    ) alteracoes;
  elsif tg_op = 'INSERT' then
    novo_alterado := novo;
    select coalesce(array_agg(chave order by chave), '{}'::text[])
      into campos
    from jsonb_object_keys(novo) as chaves(chave);
  else
    anterior_alterado := anterior;
    select coalesce(array_agg(chave order by chave), '{}'::text[])
      into campos
    from jsonb_object_keys(anterior) as chaves(chave);
  end if;

  ator := coalesce(
    public.auditoria_try_uuid(current_setting('app.audit_user_id', true)),
    auth.uid(),
    public.auditoria_usuario_requisicao()
  );
  contexto_externo := case
    when ator is null then public.auditoria_contexto_externo_requisicao()
    else null
  end;

  if ator is null and tg_op = 'INSERT' then
    ator := coalesce(
      public.auditoria_try_uuid(novo ->> 'created_by'),
      public.auditoria_try_uuid(novo ->> 'createdby'),
      public.auditoria_try_uuid(novo ->> 'usuariocriadorid')
    );
  elsif ator is null and tg_op = 'UPDATE' then
    ator := coalesce(
      public.auditoria_try_uuid(novo ->> 'updated_by'),
      public.auditoria_try_uuid(novo ->> 'updatedby'),
      public.auditoria_try_uuid(novo ->> 'usuarioalteracaoid')
    );
  elsif ator is null and tg_op = 'DELETE' then
    ator := coalesce(
      public.auditoria_try_uuid(anterior ->> 'deleted_by'),
      public.auditoria_try_uuid(anterior ->> 'updated_by'),
      public.auditoria_try_uuid(anterior ->> 'updatedby'),
      public.auditoria_try_uuid(anterior ->> 'usuarioalteracaoid')
    );
  end if;

  if ator is not null and not exists (select 1 from public.usuario where id = ator) then
    ator := null;
  end if;

  id_registro := coalesce(
    linha_referencia ->> 'id',
    linha_referencia ->> 'uuid',
    linha_referencia ->> 'ordemservicoid',
    linha_referencia ->> 'vendaid',
    linha_referencia ->> 'produtoid',
    linha_referencia ->> 'clienteid',
    nullif(concat_ws(':', linha_referencia ->> 'perfilid', linha_referencia ->> 'permissaoid'), '')
  );

  insert into public.auditoria_evento (
    operacao,
    modulo,
    tabela,
    registro_id,
    usuario_id,
    ator_nome,
    dados_anteriores,
    dados_novos,
    campos_alterados,
    origem
  ) values (
    tg_op,
    public.auditoria_modulo_tabela(tg_table_name),
    tg_table_name,
    id_registro,
    ator,
    contexto_externo ->> 'nome',
    public.auditoria_json_seguro(anterior_alterado),
    public.auditoria_json_seguro(novo_alterado),
    campos,
    case
      when ator is not null then 'usuario'
      when contexto_externo ->> 'origem' = 'cliente' then 'cliente'
      else 'sistema'
    end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
exception when others then
  raise warning 'Falha ao auditar %.%: %', tg_table_schema, tg_table_name, sqlerrm;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.auditoria_usuario_requisicao() is
  'Retorna o usuario da sessao da aplicacao propagado por uma chamada service_role.';
comment on function public.auditoria_contexto_externo_requisicao() is
  'Identifica atores externos confiaveis propagados por uma chamada service_role.';
