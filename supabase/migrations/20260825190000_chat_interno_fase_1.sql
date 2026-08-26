begin;

-- IF NOT EXISTS permite reconciliar a Demonstração caso o schema tenha sido
-- criado por uma validação transacional interrompida antes do registro no
-- histórico. Os bancos novos continuam seguindo exatamente o mesmo caminho.
create table if not exists public.chat_conversa (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'DIRECT',
  direct_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_message_at timestamptz,
  constraint chat_conversa_tipo_check check (tipo = 'DIRECT'),
  constraint chat_conversa_direct_key_check check (
    direct_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(direct_key, ':', 1) < split_part(direct_key, ':', 2)
  ),
  constraint chat_conversa_direct_key_key unique (direct_key)
);

create table if not exists public.chat_participante (
  conversa_id uuid not null references public.chat_conversa(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete restrict,
  joined_at timestamptz not null default clock_timestamp(),
  last_read_message_id uuid,
  last_read_at timestamptz,
  primary key (conversa_id, usuario_id)
);

create table if not exists public.chat_mensagem (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversa(id) on delete cascade,
  remetente_id uuid not null references public.usuario(id) on delete restrict,
  conteudo text not null,
  client_message_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint chat_mensagem_conteudo_check check (
    length(btrim(conteudo)) between 1 and 5000
  ),
  constraint chat_mensagem_idempotencia_key unique (
    conversa_id,
    remetente_id,
    client_message_id
  ),
  constraint chat_mensagem_participante_fkey foreign key (conversa_id, remetente_id)
    references public.chat_participante(conversa_id, usuario_id) on delete restrict
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_participante'::regclass
      and conname = 'chat_participante_last_read_message_fkey'
  ) then
    alter table public.chat_participante
      add constraint chat_participante_last_read_message_fkey
      foreign key (last_read_message_id)
      references public.chat_mensagem(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists chat_participante_usuario_conversa_idx
  on public.chat_participante(usuario_id, conversa_id);

create index if not exists chat_conversa_atividade_idx
  on public.chat_conversa(last_message_at desc nulls last, created_at desc, id desc);

create index if not exists chat_mensagem_conversa_cursor_idx
  on public.chat_mensagem(conversa_id, created_at desc, id desc);

create index if not exists chat_mensagem_nao_lida_idx
  on public.chat_mensagem(conversa_id, remetente_id, created_at, id);

comment on table public.chat_conversa is
  'Conversas do chat interno. Na fase 1 somente conversas DIRECT sao permitidas.';
comment on column public.chat_conversa.direct_key is
  'Chave deterministica menorUsuarioId:maiorUsuarioId, calculada no servidor.';
comment on column public.chat_mensagem.client_message_id is
  'UUID criado no navegador e preservado nas tentativas para garantir idempotencia.';
comment on column public.chat_participante.last_read_message_id is
  'Cursor de leitura do participante; evita atualizar cada mensagem individualmente.';

alter table public.chat_conversa enable row level security;
alter table public.chat_conversa no force row level security;
alter table public.chat_participante enable row level security;
alter table public.chat_participante no force row level security;
alter table public.chat_mensagem enable row level security;
alter table public.chat_mensagem no force row level security;

revoke all on table public.chat_conversa from public, anon, authenticated;
revoke all on table public.chat_participante from public, anon, authenticated;
revoke all on table public.chat_mensagem from public, anon, authenticated;
grant all on table public.chat_conversa to service_role;
grant all on table public.chat_participante to service_role;
grant all on table public.chat_mensagem to service_role;

create or replace function public.chat_direct_key(
  p_usuario_a uuid,
  p_usuario_b uuid
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select case
    when p_usuario_a::text < p_usuario_b::text
      then p_usuario_a::text || ':' || p_usuario_b::text
    else p_usuario_b::text || ':' || p_usuario_a::text
  end;
$$;

create or replace function public.chat_enforce_direct_participants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversa_id uuid;
  v_direct_key text;
  v_total integer;
begin
  v_conversa_id := case when tg_op = 'DELETE' then old.conversa_id else new.conversa_id end;
  select c.direct_key into v_direct_key
  from public.chat_conversa c
  where c.id = v_conversa_id;

  -- A conversa ja nao existe durante um cascade de exclusao.
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*)::integer into v_total
  from public.chat_participante p
  where p.conversa_id = v_conversa_id
    and p.usuario_id::text in (
      split_part(v_direct_key, ':', 1),
      split_part(v_direct_key, ':', 2)
    );

  if v_total <> 2 or (
    select count(*) from public.chat_participante p where p.conversa_id = v_conversa_id
  ) <> 2 then
    raise exception using errcode = '23514', message = 'CHAT_DIRECT_REQUIRES_TWO_PARTICIPANTS';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists chat_direct_two_participants on public.chat_participante;
create constraint trigger chat_direct_two_participants
after insert or update or delete on public.chat_participante
deferrable initially deferred
for each row execute function public.chat_enforce_direct_participants();

create or replace function public.chat_get_or_create_direct(
  p_usuario_atual uuid,
  p_destinatario uuid
)
returns table (
  conversa_id uuid,
  criada boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversa_id uuid;
  v_criada boolean := false;
  v_direct_key text;
begin
  if p_usuario_atual is null or p_destinatario is null or p_usuario_atual = p_destinatario then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_RECIPIENT';
  end if;

  if not exists (
    select 1 from public.usuario
    where id = p_usuario_atual and ativo = true
  ) then
    raise exception using errcode = '42501', message = 'INACTIVE_USER';
  end if;

  if not exists (
    select 1 from public.usuario
    where id = p_destinatario and ativo = true
  ) then
    raise exception using errcode = '22023', message = 'CHAT_RECIPIENT_UNAVAILABLE';
  end if;

  v_direct_key := public.chat_direct_key(p_usuario_atual, p_destinatario);

  insert into public.chat_conversa(tipo, direct_key)
  values ('DIRECT', v_direct_key)
  on conflict (direct_key) do nothing
  returning id into v_conversa_id;

  if v_conversa_id is null then
    select id into strict v_conversa_id
    from public.chat_conversa
    where direct_key = v_direct_key;
  else
    v_criada := true;
  end if;

  insert into public.chat_participante(conversa_id, usuario_id)
  values
    (v_conversa_id, p_usuario_atual),
    (v_conversa_id, p_destinatario)
  on conflict on constraint chat_participante_pkey do nothing;

  -- O payload e apenas uma invalidacao. Dados do chat continuam restritos as APIs.
  perform realtime.send(
    jsonb_build_object('kind', 'conversation', 'conversationId', v_conversa_id),
    'chat_changed',
    'chat:user:' || p_usuario_atual::text,
    true
  );
  perform realtime.send(
    jsonb_build_object('kind', 'conversation', 'conversationId', v_conversa_id),
    'chat_changed',
    'chat:user:' || p_destinatario::text,
    true
  );

  return query select v_conversa_id, v_criada;
end;
$$;

create or replace function public.chat_send_message(
  p_conversa_id uuid,
  p_remetente_id uuid,
  p_conteudo text,
  p_client_message_id uuid
)
returns table (
  mensagem_id uuid,
  conversa_id uuid,
  remetente_id uuid,
  conteudo text,
  client_message_id uuid,
  created_at timestamptz,
  criada boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mensagem public.chat_mensagem%rowtype;
  v_criada boolean := false;
begin
  if p_conteudo is null or length(btrim(p_conteudo)) = 0 then
    raise exception using errcode = '22023', message = 'CHAT_EMPTY_MESSAGE';
  end if;
  if length(btrim(p_conteudo)) > 5000 then
    raise exception using errcode = '22001', message = 'CHAT_MESSAGE_TOO_LONG';
  end if;
  if p_client_message_id is null then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_CLIENT_MESSAGE_ID';
  end if;

  if not exists (
    select 1 from public.usuario
    where id = p_remetente_id and ativo = true
  ) then
    raise exception using errcode = '42501', message = 'INACTIVE_USER';
  end if;

  if not exists (
    select 1 from public.chat_participante participante
    where participante.conversa_id = p_conversa_id
      and participante.usuario_id = p_remetente_id
  ) then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;

  insert into public.chat_mensagem(
    conversa_id,
    remetente_id,
    conteudo,
    client_message_id
  ) values (
    p_conversa_id,
    p_remetente_id,
    btrim(p_conteudo),
    p_client_message_id
  )
  on conflict on constraint chat_mensagem_idempotencia_key do nothing
  returning * into v_mensagem;

  if v_mensagem.id is null then
    select * into strict v_mensagem
    from public.chat_mensagem
    where chat_mensagem.conversa_id = p_conversa_id
      and chat_mensagem.remetente_id = p_remetente_id
      and chat_mensagem.client_message_id = p_client_message_id;
  else
    v_criada := true;
    update public.chat_conversa
    set last_message_at = v_mensagem.created_at,
        updated_at = v_mensagem.created_at
    where id = p_conversa_id;
  end if;

  return query
  select
    v_mensagem.id,
    v_mensagem.conversa_id,
    v_mensagem.remetente_id,
    v_mensagem.conteudo,
    v_mensagem.client_message_id,
    v_mensagem.created_at,
    v_criada;
end;
$$;

create or replace function public.chat_list_conversations(p_usuario_id uuid)
returns table (
  conversa_id uuid,
  participante_id uuid,
  participante_nome text,
  participante_username text,
  participante_setor_id integer,
  participante_setor_nome text,
  ultima_mensagem_id uuid,
  ultima_mensagem_conteudo text,
  ultima_mensagem_remetente_id uuid,
  ultima_mensagem_created_at timestamptz,
  nao_lidas bigint,
  last_message_at timestamptz,
  last_read_message_id uuid
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.usuario where id = p_usuario_id and ativo = true
  ) then
    raise exception using errcode = '42501', message = 'INACTIVE_USER';
  end if;

  return query
  with minhas as (
    select p.conversa_id, p.last_read_message_id
    from public.chat_participante p
    where p.usuario_id = p_usuario_id
  ),
  cursores as (
    select m.conversa_id,
           m.last_read_message_id,
           lida.created_at as lida_created_at,
           lida.id as lida_id
    from minhas m
    left join public.chat_mensagem lida on lida.id = m.last_read_message_id
  ),
  ultimas as (
    select distinct on (msg.conversa_id)
      msg.conversa_id,
      msg.id,
      msg.conteudo,
      msg.remetente_id,
      msg.created_at
    from public.chat_mensagem msg
    join minhas m on m.conversa_id = msg.conversa_id
    order by msg.conversa_id, msg.created_at desc, msg.id desc
  ),
  contadores as (
    select msg.conversa_id, count(*)::bigint as total
    from public.chat_mensagem msg
    join cursores c on c.conversa_id = msg.conversa_id
    where msg.remetente_id <> p_usuario_id
      and (
        c.lida_id is null
        or (msg.created_at, msg.id) > (c.lida_created_at, c.lida_id)
      )
    group by msg.conversa_id
  )
  select
    c.id,
    outro.usuario_id,
    u.nome::text,
    u.username::text,
    s.id,
    s.nome::text,
    ult.id,
    ult.conteudo,
    ult.remetente_id,
    ult.created_at,
    coalesce(cnt.total, 0)::bigint,
    c.last_message_at,
    minhas.last_read_message_id
  from minhas
  join public.chat_conversa c on c.id = minhas.conversa_id and c.tipo = 'DIRECT'
  join public.chat_participante outro
    on outro.conversa_id = c.id and outro.usuario_id <> p_usuario_id
  join public.usuario u on u.id = outro.usuario_id
  left join public.setor s on s.id = u.setorid
  left join ultimas ult on ult.conversa_id = c.id
  left join contadores cnt on cnt.conversa_id = c.id
  order by c.last_message_at desc nulls last, c.created_at desc, c.id desc;
end;
$$;

create or replace function public.chat_list_messages(
  p_usuario_id uuid,
  p_conversa_id uuid,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 31
)
returns table (
  mensagem_id uuid,
  remetente_id uuid,
  conteudo text,
  client_message_id uuid,
  created_at timestamptz,
  nao_lida boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_last_read_id uuid;
  v_last_read_at timestamptz;
begin
  if p_limit < 1 or p_limit > 101 then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_LIMIT';
  end if;
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_CURSOR';
  end if;

  select p.last_read_message_id, lida.created_at
  into v_last_read_id, v_last_read_at
  from public.chat_participante p
  left join public.chat_mensagem lida on lida.id = p.last_read_message_id
  where p.conversa_id = p_conversa_id and p.usuario_id = p_usuario_id;

  if not found then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;

  return query
  select
    msg.id,
    msg.remetente_id,
    msg.conteudo,
    msg.client_message_id,
    msg.created_at,
    (
      msg.remetente_id <> p_usuario_id
      and (
        v_last_read_id is null
        or (msg.created_at, msg.id) > (v_last_read_at, v_last_read_id)
      )
    ) as nao_lida
  from public.chat_mensagem msg
  where msg.conversa_id = p_conversa_id
    and (
      p_before_at is null
      or (msg.created_at, msg.id) < (p_before_at, p_before_id)
    )
  order by msg.created_at desc, msg.id desc
  limit p_limit;
end;
$$;

create or replace function public.chat_unread_count(p_usuario_id uuid)
returns bigint
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with cursores as (
    select p.conversa_id,
           p.last_read_message_id,
           lida.created_at as lida_created_at,
           lida.id as lida_id
    from public.chat_participante p
    left join public.chat_mensagem lida on lida.id = p.last_read_message_id
    where p.usuario_id = p_usuario_id
  )
  select count(*)::bigint
  from public.chat_mensagem msg
  join cursores c on c.conversa_id = msg.conversa_id
  where msg.remetente_id <> p_usuario_id
    and (
      c.lida_id is null
      or (msg.created_at, msg.id) > (c.lida_created_at, c.lida_id)
    );
$$;

create or replace function public.chat_mark_read(
  p_usuario_id uuid,
  p_conversa_id uuid,
  p_last_message_id uuid
)
returns table (
  last_read_message_id uuid,
  last_read_at timestamptz,
  alterada boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_atual_id uuid;
  v_atual_at timestamptz;
  v_alvo_at timestamptz;
  v_read_at timestamptz;
  v_alterada boolean := false;
begin
  select p.last_read_message_id, p.last_read_at, atual.created_at
  into v_atual_id, v_read_at, v_atual_at
  from public.chat_participante p
  left join public.chat_mensagem atual on atual.id = p.last_read_message_id
  where p.conversa_id = p_conversa_id and p.usuario_id = p_usuario_id
  for update of p;

  if not found then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;

  select msg.created_at into v_alvo_at
  from public.chat_mensagem msg
  where msg.id = p_last_message_id and msg.conversa_id = p_conversa_id;

  if not found then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_READ_MESSAGE';
  end if;

  if v_atual_id is null or (v_alvo_at, p_last_message_id) > (v_atual_at, v_atual_id) then
    v_read_at := clock_timestamp();
    update public.chat_participante participante
    set last_read_message_id = p_last_message_id,
        last_read_at = v_read_at
    where participante.conversa_id = p_conversa_id
      and participante.usuario_id = p_usuario_id;
    v_atual_id := p_last_message_id;
    v_alterada := true;
  end if;

  return query select v_atual_id, v_read_at, v_alterada;
end;
$$;

create or replace function public.chat_broadcast_message_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_participante uuid;
begin
  for v_participante in
    select usuario_id
    from public.chat_participante
    where conversa_id = new.conversa_id
  loop
    perform realtime.send(
      jsonb_build_object(
        'kind', 'message',
        'conversationId', new.conversa_id,
        'messageId', new.id,
        'senderId', new.remetente_id,
        'clientMessageId', new.client_message_id
      ),
      'chat_changed',
      'chat:user:' || v_participante::text,
      true
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists chat_mensagem_broadcast_after_insert on public.chat_mensagem;
create trigger chat_mensagem_broadcast_after_insert
after insert on public.chat_mensagem
for each row execute function public.chat_broadcast_message_change();

create or replace function public.chat_broadcast_read_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_participante uuid;
begin
  if new.last_read_message_id is not distinct from old.last_read_message_id then
    return new;
  end if;

  for v_participante in
    select usuario_id
    from public.chat_participante
    where conversa_id = new.conversa_id
  loop
    perform realtime.send(
      jsonb_build_object(
        'kind', 'read',
        'conversationId', new.conversa_id,
        'readerId', new.usuario_id,
        'lastReadMessageId', new.last_read_message_id
      ),
      'chat_changed',
      'chat:user:' || v_participante::text,
      true
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists chat_participante_broadcast_after_read on public.chat_participante;
create trigger chat_participante_broadcast_after_read
after update of last_read_message_id on public.chat_participante
for each row execute function public.chat_broadcast_read_change();

-- Realtime usa um JWT curto emitido pela API a partir da sessao NextAuth. Esta
-- funcao e a unica superficie publica auxiliar e devolve apenas um booleano.
create or replace function public.chat_realtime_topic_allowed(p_topic text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.usuario u
    where u.id = auth.uid()
      and u.ativo = true
      and (
        p_topic = 'chat:presence'
        or p_topic = 'chat:user:' || u.id::text
        or (
          p_topic like 'chat:conversation:%'
          and exists (
            select 1
            from public.chat_participante p
            where p.usuario_id = u.id
              and p.conversa_id::text = substring(p_topic from 19)
          )
        )
      )
  );
$$;

drop policy if exists chat_realtime_receive on realtime.messages;
create policy chat_realtime_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.chat_realtime_topic_allowed((select realtime.topic()))
);

drop policy if exists chat_realtime_presence_track on realtime.messages;
create policy chat_realtime_presence_track
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and (select realtime.topic()) = 'chat:presence'
  and public.chat_realtime_topic_allowed((select realtime.topic()))
);

revoke all on function public.chat_direct_key(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_enforce_direct_participants() from public, anon, authenticated;
revoke all on function public.chat_get_or_create_direct(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_send_message(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.chat_list_conversations(uuid) from public, anon, authenticated;
revoke all on function public.chat_list_messages(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.chat_unread_count(uuid) from public, anon, authenticated;
revoke all on function public.chat_mark_read(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_broadcast_message_change() from public, anon, authenticated;
revoke all on function public.chat_broadcast_read_change() from public, anon, authenticated;
revoke all on function public.chat_realtime_topic_allowed(text) from public, anon;

grant execute on function public.chat_direct_key(uuid, uuid) to service_role;
grant execute on function public.chat_get_or_create_direct(uuid, uuid) to service_role;
grant execute on function public.chat_send_message(uuid, uuid, text, uuid) to service_role;
grant execute on function public.chat_list_conversations(uuid) to service_role;
grant execute on function public.chat_list_messages(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.chat_unread_count(uuid) to service_role;
grant execute on function public.chat_mark_read(uuid, uuid, uuid) to service_role;
grant execute on function public.chat_realtime_topic_allowed(text) to authenticated, service_role;

commit;
