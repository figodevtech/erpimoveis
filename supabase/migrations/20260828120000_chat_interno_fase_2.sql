begin;

-- =====================================================================
-- Chat interno - fase 2
-- Mensagens de voz, resposta citada, reacoes, edicao, exclusao e Web Push.
-- Migracao incremental: nenhuma estrutura da fase 1 e recriada e as
-- mensagens existentes permanecem validas como tipo TEXT.
-- =====================================================================

alter table public.chat_mensagem
  add column if not exists tipo text not null default 'TEXT',
  add column if not exists reply_to_message_id uuid,
  add column if not exists reply_snapshot_tipo text,
  add column if not exists reply_snapshot_conteudo text,
  add column if not exists reply_snapshot_remetente_nome text,
  add column if not exists editada_em timestamptz,
  add column if not exists excluida_para_todos_em timestamptz,
  add column if not exists excluida_para_todos_por uuid,
  add column if not exists audio_path text,
  add column if not exists audio_mime text,
  add column if not exists audio_bytes integer,
  add column if not exists audio_duracao_ms integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_mensagem'::regclass
      and conname = 'chat_mensagem_reply_fkey'
  ) then
    alter table public.chat_mensagem
      add constraint chat_mensagem_reply_fkey
      foreign key (reply_to_message_id)
      references public.chat_mensagem(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_mensagem'::regclass
      and conname = 'chat_mensagem_excluida_por_fkey'
  ) then
    alter table public.chat_mensagem
      add constraint chat_mensagem_excluida_por_fkey
      foreign key (excluida_para_todos_por)
      references public.usuario(id)
      on delete restrict;
  end if;
end;
$$;

-- O check da fase 1 exigia conteudo entre 1 e 5000 sempre. Voz e exclusao
-- logica precisam de conteudo vazio, entao ele e substituido por um check
-- por tipo/estado. Mensagens antigas continuam validas como TEXT.
alter table public.chat_mensagem
  drop constraint if exists chat_mensagem_conteudo_check;

alter table public.chat_mensagem
  drop constraint if exists chat_mensagem_conteudo_por_tipo_check;
alter table public.chat_mensagem
  add constraint chat_mensagem_conteudo_por_tipo_check check (
    case
      when excluida_para_todos_em is not null then length(conteudo) = 0
      when tipo = 'TEXT' then length(btrim(conteudo)) between 1 and 5000
      when tipo = 'VOICE' then length(conteudo) = 0
      else false
    end
  );

alter table public.chat_mensagem
  drop constraint if exists chat_mensagem_tipo_check;
alter table public.chat_mensagem
  add constraint chat_mensagem_tipo_check check (tipo in ('TEXT', 'VOICE'));

alter table public.chat_mensagem
  drop constraint if exists chat_mensagem_audio_check;
alter table public.chat_mensagem
  add constraint chat_mensagem_audio_check check (
    case
      when tipo = 'VOICE' and excluida_para_todos_em is null then
        audio_path is not null
        and btrim(audio_path) <> ''
        and audio_mime is not null
        and audio_bytes between 1 and 10485760
        and audio_duracao_ms between 1 and 300000
      when tipo = 'TEXT' then
        audio_path is null
        and audio_mime is null
        and audio_bytes is null
        and audio_duracao_ms is null
      else true
    end
  );

alter table public.chat_mensagem
  drop constraint if exists chat_mensagem_exclusao_check;
alter table public.chat_mensagem
  add constraint chat_mensagem_exclusao_check check (
    (excluida_para_todos_em is null) = (excluida_para_todos_por is null)
  );

alter table public.chat_mensagem
  drop constraint if exists chat_mensagem_reply_snapshot_check;
alter table public.chat_mensagem
  add constraint chat_mensagem_reply_snapshot_check check (
    reply_snapshot_tipo is null or reply_snapshot_tipo in ('TEXT', 'VOICE')
  );

create index if not exists chat_mensagem_reply_idx
  on public.chat_mensagem(reply_to_message_id)
  where reply_to_message_id is not null;

create index if not exists chat_mensagem_audio_path_idx
  on public.chat_mensagem(audio_path)
  where audio_path is not null;

comment on column public.chat_mensagem.tipo is
  'TEXT ou VOICE. Mensagens anteriores a fase 2 recebem TEXT pelo default.';
comment on column public.chat_mensagem.reply_snapshot_conteudo is
  'Recorte historico do conteudo citado; preserva a resposta apos edicao ou exclusao do original.';
comment on column public.chat_mensagem.audio_path is
  'Caminho no bucket privado chat_audio. Nunca e devolvido ao navegador.';

-- =====================================================================
-- Reacoes
-- =====================================================================

create table if not exists public.chat_reacao (
  id uuid primary key default gen_random_uuid(),
  mensagem_id uuid not null references public.chat_mensagem(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  reacao text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint chat_reacao_valor_check check (reacao in ('CORACAO', 'LEGAL', 'FELIZ', 'TRISTE')),
  constraint chat_reacao_unica_key unique (mensagem_id, usuario_id)
);

create index if not exists chat_reacao_mensagem_idx on public.chat_reacao(mensagem_id);

comment on table public.chat_reacao is
  'Uma reacao por usuario por mensagem. O conjunto permitido e validado no banco.';

-- =====================================================================
-- Historico de edicao
-- =====================================================================

create table if not exists public.chat_mensagem_edicao (
  id uuid primary key default gen_random_uuid(),
  mensagem_id uuid not null references public.chat_mensagem(id) on delete cascade,
  conteudo_anterior text not null,
  editado_por uuid not null references public.usuario(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists chat_mensagem_edicao_mensagem_idx
  on public.chat_mensagem_edicao(mensagem_id, created_at desc);

comment on table public.chat_mensagem_edicao is
  'Auditoria da edicao de mensagens. Nao possui tela nesta fase.';

-- =====================================================================
-- Exclusao somente para um participante
-- =====================================================================

create table if not exists public.chat_mensagem_oculta (
  mensagem_id uuid not null references public.chat_mensagem(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (mensagem_id, usuario_id)
);

create index if not exists chat_mensagem_oculta_usuario_idx
  on public.chat_mensagem_oculta(usuario_id, mensagem_id);

comment on table public.chat_mensagem_oculta is
  'Mensagens ocultas apenas na visao de um participante. O registro principal permanece.';

-- =====================================================================
-- Audios pendentes de remocao fisica
-- =====================================================================

create table if not exists public.chat_audio_pendente_remocao (
  path text primary key,
  conversa_id uuid,
  created_at timestamptz not null default clock_timestamp()
);

comment on table public.chat_audio_pendente_remocao is
  'Fila de objetos do Storage a remover apos exclusao para todos. A API apaga e limpa a linha; sobras ficam orfas e ja inacessiveis.';

-- =====================================================================
-- Assinaturas Web Push
-- =====================================================================

create table if not exists public.chat_push_subscription (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  endpoint text not null,
  endpoint_hash text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_label text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint chat_push_subscription_endpoint_hash_key unique (endpoint_hash)
);

create index if not exists chat_push_subscription_usuario_idx
  on public.chat_push_subscription(usuario_id)
  where revoked_at is null;

comment on table public.chat_push_subscription is
  'Uma linha por dispositivo/navegador. A unicidade usa o hash do endpoint; chaves nunca vao para log.';

-- =====================================================================
-- Foco do destinatario, usado para suprimir push desnecessario
-- =====================================================================

alter table public.chat_participante
  add column if not exists foco_ate timestamptz;

comment on column public.chat_participante.foco_ate is
  'Enquanto no futuro, o participante confirmou conversa aberta, aba visivel e Realtime conectado. Push e suprimido nessa janela.';

-- =====================================================================
-- Fechamento do schema publico para as novas tabelas
-- =====================================================================

alter table public.chat_reacao enable row level security;
alter table public.chat_reacao no force row level security;
alter table public.chat_mensagem_edicao enable row level security;
alter table public.chat_mensagem_edicao no force row level security;
alter table public.chat_mensagem_oculta enable row level security;
alter table public.chat_mensagem_oculta no force row level security;
alter table public.chat_audio_pendente_remocao enable row level security;
alter table public.chat_audio_pendente_remocao no force row level security;
alter table public.chat_push_subscription enable row level security;
alter table public.chat_push_subscription no force row level security;

revoke all on table public.chat_reacao from public, anon, authenticated;
revoke all on table public.chat_mensagem_edicao from public, anon, authenticated;
revoke all on table public.chat_mensagem_oculta from public, anon, authenticated;
revoke all on table public.chat_audio_pendente_remocao from public, anon, authenticated;
revoke all on table public.chat_push_subscription from public, anon, authenticated;

grant all on table public.chat_reacao to service_role;
grant all on table public.chat_mensagem_edicao to service_role;
grant all on table public.chat_mensagem_oculta to service_role;
grant all on table public.chat_audio_pendente_remocao to service_role;
grant all on table public.chat_push_subscription to service_role;

-- =====================================================================
-- Bucket privado de audio
-- =====================================================================

insert into storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types)
values (
  'chat_audio',
  'chat_audio',
  null,
  false,
  10485760,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- Utilitarios internos
-- =====================================================================

-- Broadcast minimo para os dois participantes da conversa.
create or replace function public.chat_broadcast_para_participantes(
  p_conversa_id uuid,
  p_payload jsonb,
  p_somente_usuario uuid default null
)
returns void
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
    where conversa_id = p_conversa_id
      and (p_somente_usuario is null or usuario_id = p_somente_usuario)
  loop
    perform realtime.send(
      p_payload,
      'chat_changed',
      'chat:user:' || v_participante::text,
      true
    );
  end loop;
end;
$$;

-- Agregado exibido abaixo do balao: contagem por reacao e a escolha do leitor.
create or replace function public.chat_reacoes_da_mensagem(
  p_mensagem_id uuid,
  p_usuario_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('reacao', t.reacao, 'total', t.total, 'own', t.own)
      order by t.primeira asc, t.reacao asc
    ),
    '[]'::jsonb
  )
  from (
    select r.reacao,
           count(*)::int as total,
           bool_or(r.usuario_id = p_usuario_id) as own,
           min(r.created_at) as primeira
    from public.chat_reacao r
    where r.mensagem_id = p_mensagem_id
    group by r.reacao
  ) t;
$$;

-- =====================================================================
-- Envio de mensagem: texto, voz e resposta citada
-- A assinatura de 4 argumentos da fase 1 e substituida. Nenhum chamador
-- externo existe: a funcao sempre foi restrita ao service_role.
-- =====================================================================

drop function if exists public.chat_send_message(uuid, uuid, text, uuid);

create or replace function public.chat_send_message(
  p_conversa_id uuid,
  p_remetente_id uuid,
  p_conteudo text,
  p_client_message_id uuid,
  p_tipo text default 'TEXT',
  p_reply_to_message_id uuid default null,
  p_audio_path text default null,
  p_audio_mime text default null,
  p_audio_bytes integer default null,
  p_audio_duracao_ms integer default null
)
returns table (
  mensagem_id uuid,
  conversa_id uuid,
  remetente_id uuid,
  tipo text,
  conteudo text,
  client_message_id uuid,
  created_at timestamptz,
  editada_em timestamptz,
  excluida_para_todos_em timestamptz,
  reply_to_message_id uuid,
  reply_snapshot_tipo text,
  reply_snapshot_conteudo text,
  reply_snapshot_remetente_nome text,
  audio_mime text,
  audio_bytes integer,
  audio_duracao_ms integer,
  criada boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mensagem public.chat_mensagem%rowtype;
  v_criada boolean := false;
  v_tipo text := coalesce(nullif(btrim(p_tipo), ''), 'TEXT');
  v_conteudo text := coalesce(btrim(p_conteudo), '');
  v_reply public.chat_mensagem%rowtype;
  v_reply_tipo text;
  v_reply_conteudo text;
  v_reply_nome text;
begin
  if v_tipo not in ('TEXT', 'VOICE') then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_MESSAGE_TYPE';
  end if;
  if p_client_message_id is null then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_CLIENT_MESSAGE_ID';
  end if;

  if v_tipo = 'TEXT' then
    if length(v_conteudo) = 0 then
      raise exception using errcode = '22023', message = 'CHAT_EMPTY_MESSAGE';
    end if;
    if length(v_conteudo) > 5000 then
      raise exception using errcode = '22001', message = 'CHAT_MESSAGE_TOO_LONG';
    end if;
  else
    v_conteudo := '';
    if p_audio_path is null or btrim(p_audio_path) = '' or p_audio_mime is null then
      raise exception using errcode = '22023', message = 'CHAT_INVALID_AUDIO';
    end if;
    if p_audio_bytes is null or p_audio_bytes < 1 or p_audio_bytes > 10485760 then
      raise exception using errcode = '22023', message = 'CHAT_AUDIO_TOO_LARGE';
    end if;
    if p_audio_duracao_ms is null or p_audio_duracao_ms < 1 or p_audio_duracao_ms > 300000 then
      raise exception using errcode = '22023', message = 'CHAT_AUDIO_TOO_LONG';
    end if;
  end if;

  if not exists (
    select 1 from public.usuario where id = p_remetente_id and ativo = true
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

  -- A citacao so pode apontar para uma mensagem viva da mesma conversa e
  -- visivel para quem responde. O recorte historico e montado aqui, no
  -- servidor: o navegador nunca informa autor nem conteudo citado.
  if p_reply_to_message_id is not null then
    select * into v_reply
    from public.chat_mensagem
    where id = p_reply_to_message_id;

    if not found or v_reply.conversa_id <> p_conversa_id then
      raise exception using errcode = '22023', message = 'CHAT_INVALID_REPLY_TARGET';
    end if;
    if v_reply.excluida_para_todos_em is not null then
      raise exception using errcode = '22023', message = 'CHAT_INVALID_REPLY_TARGET';
    end if;
    if exists (
      select 1 from public.chat_mensagem_oculta oculta
      where oculta.mensagem_id = v_reply.id and oculta.usuario_id = p_remetente_id
    ) then
      raise exception using errcode = '22023', message = 'CHAT_INVALID_REPLY_TARGET';
    end if;

    select u.nome::text into v_reply_nome
    from public.usuario u
    where u.id = v_reply.remetente_id;

    v_reply_tipo := v_reply.tipo;
    v_reply_conteudo := case
      when v_reply.tipo = 'VOICE' then ''
      else left(regexp_replace(v_reply.conteudo, '\s+', ' ', 'g'), 160)
    end;
  end if;

  insert into public.chat_mensagem(
    conversa_id,
    remetente_id,
    tipo,
    conteudo,
    client_message_id,
    reply_to_message_id,
    reply_snapshot_tipo,
    reply_snapshot_conteudo,
    reply_snapshot_remetente_nome,
    audio_path,
    audio_mime,
    audio_bytes,
    audio_duracao_ms
  ) values (
    p_conversa_id,
    p_remetente_id,
    v_tipo,
    v_conteudo,
    p_client_message_id,
    p_reply_to_message_id,
    v_reply_tipo,
    v_reply_conteudo,
    v_reply_nome,
    case when v_tipo = 'VOICE' then btrim(p_audio_path) end,
    case when v_tipo = 'VOICE' then p_audio_mime end,
    case when v_tipo = 'VOICE' then p_audio_bytes end,
    case when v_tipo = 'VOICE' then p_audio_duracao_ms end
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
    v_mensagem.tipo,
    v_mensagem.conteudo,
    v_mensagem.client_message_id,
    v_mensagem.created_at,
    v_mensagem.editada_em,
    v_mensagem.excluida_para_todos_em,
    v_mensagem.reply_to_message_id,
    v_mensagem.reply_snapshot_tipo,
    v_mensagem.reply_snapshot_conteudo,
    v_mensagem.reply_snapshot_remetente_nome,
    v_mensagem.audio_mime,
    v_mensagem.audio_bytes,
    v_mensagem.audio_duracao_ms,
    v_criada;
end;
$$;

-- =====================================================================
-- Historico paginado
-- =====================================================================

drop function if exists public.chat_list_messages(uuid, uuid, timestamptz, uuid, integer);

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
  tipo text,
  conteudo text,
  client_message_id uuid,
  created_at timestamptz,
  editada_em timestamptz,
  excluida_para_todos_em timestamptz,
  reply_to_message_id uuid,
  reply_snapshot_tipo text,
  reply_snapshot_conteudo text,
  reply_snapshot_remetente_nome text,
  audio_mime text,
  audio_bytes integer,
  audio_duracao_ms integer,
  reacoes jsonb,
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
    msg.tipo,
    msg.conteudo,
    msg.client_message_id,
    msg.created_at,
    msg.editada_em,
    msg.excluida_para_todos_em,
    msg.reply_to_message_id,
    msg.reply_snapshot_tipo,
    msg.reply_snapshot_conteudo,
    msg.reply_snapshot_remetente_nome,
    msg.audio_mime,
    msg.audio_bytes,
    msg.audio_duracao_ms,
    public.chat_reacoes_da_mensagem(msg.id, p_usuario_id),
    (
      msg.remetente_id <> p_usuario_id
      and msg.excluida_para_todos_em is null
      and (
        v_last_read_id is null
        or (msg.created_at, msg.id) > (v_last_read_at, v_last_read_id)
      )
    ) as nao_lida
  from public.chat_mensagem msg
  where msg.conversa_id = p_conversa_id
    and not exists (
      select 1 from public.chat_mensagem_oculta oculta
      where oculta.mensagem_id = msg.id and oculta.usuario_id = p_usuario_id
    )
    and (
      p_before_at is null
      or (msg.created_at, msg.id) < (p_before_at, p_before_id)
    )
  order by msg.created_at desc, msg.id desc
  limit p_limit;
end;
$$;

-- =====================================================================
-- Lista de conversas
-- =====================================================================

drop function if exists public.chat_list_conversations(uuid);

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
  ultima_mensagem_tipo text,
  ultima_mensagem_excluida boolean,
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
  visiveis as (
    select msg.*
    from public.chat_mensagem msg
    join minhas m on m.conversa_id = msg.conversa_id
    where not exists (
      select 1 from public.chat_mensagem_oculta oculta
      where oculta.mensagem_id = msg.id and oculta.usuario_id = p_usuario_id
    )
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
    select distinct on (v.conversa_id)
      v.conversa_id,
      v.id,
      v.conteudo,
      v.remetente_id,
      v.created_at,
      v.tipo,
      v.excluida_para_todos_em
    from visiveis v
    order by v.conversa_id, v.created_at desc, v.id desc
  ),
  contadores as (
    select v.conversa_id, count(*)::bigint as total
    from visiveis v
    join cursores c on c.conversa_id = v.conversa_id
    where v.remetente_id <> p_usuario_id
      and v.excluida_para_todos_em is null
      and (
        c.lida_id is null
        or (v.created_at, v.id) > (c.lida_created_at, c.lida_id)
      )
    group by v.conversa_id
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
    ult.tipo,
    (ult.excluida_para_todos_em is not null),
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

-- =====================================================================
-- Contador global
-- =====================================================================

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
    and msg.excluida_para_todos_em is null
    and not exists (
      select 1 from public.chat_mensagem_oculta oculta
      where oculta.mensagem_id = msg.id and oculta.usuario_id = p_usuario_id
    )
    and (
      c.lida_id is null
      or (msg.created_at, msg.id) > (c.lida_created_at, c.lida_id)
    );
$$;

-- =====================================================================
-- Edicao
-- =====================================================================

create or replace function public.chat_edit_message(
  p_usuario_id uuid,
  p_mensagem_id uuid,
  p_conteudo text,
  p_janela_segundos integer default 900
)
returns table (
  mensagem_id uuid,
  conversa_id uuid,
  conteudo text,
  editada_em timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mensagem public.chat_mensagem%rowtype;
  v_conteudo text := coalesce(btrim(p_conteudo), '');
  v_agora timestamptz := clock_timestamp();
begin
  if length(v_conteudo) = 0 then
    raise exception using errcode = '22023', message = 'CHAT_EMPTY_MESSAGE';
  end if;
  if length(v_conteudo) > 5000 then
    raise exception using errcode = '22001', message = 'CHAT_MESSAGE_TOO_LONG';
  end if;

  select * into v_mensagem
  from public.chat_mensagem
  where id = p_mensagem_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_NOT_FOUND';
  end if;
  if v_mensagem.remetente_id <> p_usuario_id then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;
  if v_mensagem.tipo <> 'TEXT' then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_NOT_EDITABLE';
  end if;
  if v_mensagem.excluida_para_todos_em is not null then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_NOT_EDITABLE';
  end if;
  if v_agora > v_mensagem.created_at + make_interval(secs => greatest(0, p_janela_segundos)) then
    raise exception using errcode = '22023', message = 'CHAT_EDIT_WINDOW_EXPIRED';
  end if;

  if v_mensagem.conteudo = v_conteudo then
    return query select v_mensagem.id, v_mensagem.conversa_id, v_mensagem.conteudo, v_mensagem.editada_em;
    return;
  end if;

  insert into public.chat_mensagem_edicao(mensagem_id, conteudo_anterior, editado_por)
  values (v_mensagem.id, v_mensagem.conteudo, p_usuario_id);

  -- created_at nao muda: a edicao nunca reordena a timeline nem move a
  -- conversa para o topo como se fosse mensagem nova.
  update public.chat_mensagem
  set conteudo = v_conteudo,
      editada_em = v_agora
  where id = v_mensagem.id
  returning * into v_mensagem;

  return query select v_mensagem.id, v_mensagem.conversa_id, v_mensagem.conteudo, v_mensagem.editada_em;
end;
$$;

-- =====================================================================
-- Exclusao apenas para o proprio usuario
-- =====================================================================

create or replace function public.chat_delete_message_for_me(
  p_usuario_id uuid,
  p_mensagem_id uuid
)
returns table (
  mensagem_id uuid,
  conversa_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversa_id uuid;
begin
  select msg.conversa_id into v_conversa_id
  from public.chat_mensagem msg
  where msg.id = p_mensagem_id;

  if not found then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.chat_participante p
    where p.conversa_id = v_conversa_id and p.usuario_id = p_usuario_id
  ) then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;

  insert into public.chat_mensagem_oculta(mensagem_id, usuario_id)
  values (p_mensagem_id, p_usuario_id)
  on conflict do nothing;

  -- Somente as sessoes do proprio usuario precisam saber.
  perform public.chat_broadcast_para_participantes(
    v_conversa_id,
    jsonb_build_object(
      'kind', 'message-updated',
      'conversationId', v_conversa_id,
      'messageId', p_mensagem_id
    ),
    p_usuario_id
  );

  return query select p_mensagem_id, v_conversa_id;
end;
$$;

-- =====================================================================
-- Exclusao para todos
-- =====================================================================

create or replace function public.chat_delete_message_for_everyone(
  p_usuario_id uuid,
  p_mensagem_id uuid,
  p_janela_segundos integer default 900
)
returns table (
  mensagem_id uuid,
  conversa_id uuid,
  excluida_para_todos_em timestamptz,
  audio_path text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mensagem public.chat_mensagem%rowtype;
  v_agora timestamptz := clock_timestamp();
  v_audio_path text;
begin
  select * into v_mensagem
  from public.chat_mensagem
  where id = p_mensagem_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_NOT_FOUND';
  end if;
  if v_mensagem.remetente_id <> p_usuario_id then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;
  if v_mensagem.excluida_para_todos_em is not null then
    return query
    select v_mensagem.id, v_mensagem.conversa_id, v_mensagem.excluida_para_todos_em, null::text;
    return;
  end if;
  if v_agora > v_mensagem.created_at + make_interval(secs => greatest(0, p_janela_segundos)) then
    raise exception using errcode = '22023', message = 'CHAT_DELETE_WINDOW_EXPIRED';
  end if;

  v_audio_path := v_mensagem.audio_path;

  if v_audio_path is not null then
    insert into public.chat_audio_pendente_remocao(path, conversa_id)
    values (v_audio_path, v_mensagem.conversa_id)
    on conflict (path) do nothing;
  end if;

  -- Exclusao logica: a linha continua para nao quebrar cursor de leitura,
  -- paginacao nem respostas que citem esta mensagem.
  update public.chat_mensagem
  set conteudo = '',
      excluida_para_todos_em = v_agora,
      excluida_para_todos_por = p_usuario_id,
      editada_em = null,
      reply_snapshot_tipo = null,
      reply_snapshot_conteudo = null,
      reply_snapshot_remetente_nome = null,
      audio_path = null,
      audio_mime = null,
      audio_bytes = null,
      audio_duracao_ms = null
  where id = v_mensagem.id
  returning * into v_mensagem;

  -- Decisao: as reacoes de uma mensagem excluida para todos sao removidas.
  delete from public.chat_reacao where chat_reacao.mensagem_id = v_mensagem.id;

  return query
  select v_mensagem.id, v_mensagem.conversa_id, v_mensagem.excluida_para_todos_em, v_audio_path;
end;
$$;

-- =====================================================================
-- Reacoes
-- =====================================================================

create or replace function public.chat_set_reaction(
  p_usuario_id uuid,
  p_mensagem_id uuid,
  p_reacao text
)
returns table (
  mensagem_id uuid,
  conversa_id uuid,
  reacoes jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mensagem public.chat_mensagem%rowtype;
  v_reacao text := upper(coalesce(btrim(p_reacao), ''));
begin
  if v_reacao not in ('CORACAO', 'LEGAL', 'FELIZ', 'TRISTE') then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_REACTION';
  end if;

  select * into v_mensagem from public.chat_mensagem where id = p_mensagem_id;
  if not found then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.chat_participante p
    where p.conversa_id = v_mensagem.conversa_id and p.usuario_id = p_usuario_id
  ) then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;

  if v_mensagem.excluida_para_todos_em is not null then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_UNAVAILABLE';
  end if;

  if exists (
    select 1 from public.chat_mensagem_oculta oculta
    where oculta.mensagem_id = p_mensagem_id and oculta.usuario_id = p_usuario_id
  ) then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_UNAVAILABLE';
  end if;

  insert into public.chat_reacao(mensagem_id, usuario_id, reacao)
  values (p_mensagem_id, p_usuario_id, v_reacao)
  on conflict on constraint chat_reacao_unica_key do update
  set reacao = excluded.reacao,
      updated_at = clock_timestamp();

  return query
  select p_mensagem_id,
         v_mensagem.conversa_id,
         public.chat_reacoes_da_mensagem(p_mensagem_id, p_usuario_id);
end;
$$;

create or replace function public.chat_clear_reaction(
  p_usuario_id uuid,
  p_mensagem_id uuid
)
returns table (
  mensagem_id uuid,
  conversa_id uuid,
  reacoes jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversa_id uuid;
begin
  select msg.conversa_id into v_conversa_id
  from public.chat_mensagem msg
  where msg.id = p_mensagem_id;

  if not found then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.chat_participante p
    where p.conversa_id = v_conversa_id and p.usuario_id = p_usuario_id
  ) then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;

  delete from public.chat_reacao
  where chat_reacao.mensagem_id = p_mensagem_id
    and chat_reacao.usuario_id = p_usuario_id;

  return query
  select p_mensagem_id,
         v_conversa_id,
         public.chat_reacoes_da_mensagem(p_mensagem_id, p_usuario_id);
end;
$$;

-- =====================================================================
-- Acesso ao audio
-- =====================================================================

create or replace function public.chat_audio_access(
  p_usuario_id uuid,
  p_mensagem_id uuid
)
returns table (
  conversa_id uuid,
  audio_path text,
  audio_mime text,
  audio_duracao_ms integer
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_mensagem public.chat_mensagem%rowtype;
begin
  select * into v_mensagem from public.chat_mensagem where id = p_mensagem_id;
  if not found then
    raise exception using errcode = '22023', message = 'CHAT_MESSAGE_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.chat_participante p
    where p.conversa_id = v_mensagem.conversa_id and p.usuario_id = p_usuario_id
  ) then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;

  if v_mensagem.excluida_para_todos_em is not null
    or v_mensagem.tipo <> 'VOICE'
    or v_mensagem.audio_path is null
    or exists (
      select 1 from public.chat_mensagem_oculta oculta
      where oculta.mensagem_id = p_mensagem_id and oculta.usuario_id = p_usuario_id
    )
  then
    raise exception using errcode = '22023', message = 'CHAT_AUDIO_UNAVAILABLE';
  end if;

  return query
  select v_mensagem.conversa_id,
         v_mensagem.audio_path,
         v_mensagem.audio_mime,
         v_mensagem.audio_duracao_ms;
end;
$$;

-- =====================================================================
-- Foco da conversa e alvo do push
-- =====================================================================

create or replace function public.chat_marcar_foco(
  p_usuario_id uuid,
  p_conversa_id uuid,
  p_segundos integer default 60
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.chat_participante
  set foco_ate = case
    when p_segundos <= 0 then null
    else clock_timestamp() + make_interval(secs => least(p_segundos, 300))
  end
  where conversa_id = p_conversa_id and usuario_id = p_usuario_id;

  if not found then
    raise exception using errcode = '42501', message = 'CHAT_FORBIDDEN';
  end if;
end;
$$;

-- Dados minimos para o Web Push, ja com a decisao de supressao tomada no
-- servidor. Nada aqui e exposto ao navegador do remetente.
create or replace function public.chat_push_target(p_mensagem_id uuid)
returns table (
  conversa_id uuid,
  destinatario_id uuid,
  remetente_id uuid,
  remetente_nome text,
  tipo text,
  conteudo text,
  suprimido boolean
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    msg.conversa_id,
    destino.usuario_id,
    msg.remetente_id,
    remetente.nome::text,
    msg.tipo,
    msg.conteudo,
    coalesce(destino.foco_ate > clock_timestamp(), false)
  from public.chat_mensagem msg
  join public.chat_participante destino
    on destino.conversa_id = msg.conversa_id
   and destino.usuario_id <> msg.remetente_id
  join public.usuario remetente on remetente.id = msg.remetente_id
  join public.usuario alvo on alvo.id = destino.usuario_id and alvo.ativo = true
  where msg.id = p_mensagem_id
    and msg.excluida_para_todos_em is null
    and not exists (
      select 1 from public.chat_mensagem_oculta oculta
      where oculta.mensagem_id = msg.id and oculta.usuario_id = destino.usuario_id
    );
$$;

-- =====================================================================
-- Broadcast das novidades da fase 2
-- =====================================================================

create or replace function public.chat_broadcast_message_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.chat_broadcast_para_participantes(
    new.conversa_id,
    jsonb_build_object(
      'kind', 'message',
      'conversationId', new.conversa_id,
      'messageId', new.id,
      'senderId', new.remetente_id,
      'clientMessageId', new.client_message_id,
      'messageType', new.tipo
    )
  );
  return new;
end;
$$;

create or replace function public.chat_broadcast_message_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.conteudo is not distinct from old.conteudo
    and new.editada_em is not distinct from old.editada_em
    and new.excluida_para_todos_em is not distinct from old.excluida_para_todos_em
  then
    return new;
  end if;

  perform public.chat_broadcast_para_participantes(
    new.conversa_id,
    jsonb_build_object(
      'kind', 'message-updated',
      'conversationId', new.conversa_id,
      'messageId', new.id,
      'senderId', new.remetente_id
    )
  );
  return new;
end;
$$;

drop trigger if exists chat_mensagem_broadcast_after_update on public.chat_mensagem;
create trigger chat_mensagem_broadcast_after_update
after update on public.chat_mensagem
for each row execute function public.chat_broadcast_message_update();

create or replace function public.chat_broadcast_reaction_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mensagem_id uuid := case when tg_op = 'DELETE' then old.mensagem_id else new.mensagem_id end;
  v_conversa_id uuid;
begin
  select msg.conversa_id into v_conversa_id
  from public.chat_mensagem msg
  where msg.id = v_mensagem_id;

  if found then
    perform public.chat_broadcast_para_participantes(
      v_conversa_id,
      jsonb_build_object(
        'kind', 'reaction',
        'conversationId', v_conversa_id,
        'messageId', v_mensagem_id
      )
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists chat_reacao_broadcast on public.chat_reacao;
create trigger chat_reacao_broadcast
after insert or update or delete on public.chat_reacao
for each row execute function public.chat_broadcast_reaction_change();

-- =====================================================================
-- Privilegios
-- =====================================================================

revoke all on function public.chat_broadcast_para_participantes(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.chat_reacoes_da_mensagem(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_send_message(uuid, uuid, text, uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.chat_list_messages(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.chat_list_conversations(uuid) from public, anon, authenticated;
revoke all on function public.chat_unread_count(uuid) from public, anon, authenticated;
revoke all on function public.chat_edit_message(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.chat_delete_message_for_me(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_delete_message_for_everyone(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.chat_set_reaction(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.chat_clear_reaction(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_audio_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_marcar_foco(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.chat_push_target(uuid) from public, anon, authenticated;
revoke all on function public.chat_broadcast_message_change() from public, anon, authenticated;
revoke all on function public.chat_broadcast_message_update() from public, anon, authenticated;
revoke all on function public.chat_broadcast_reaction_change() from public, anon, authenticated;

grant execute on function public.chat_send_message(uuid, uuid, text, uuid, text, uuid, text, text, integer, integer) to service_role;
grant execute on function public.chat_list_messages(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.chat_list_conversations(uuid) to service_role;
grant execute on function public.chat_unread_count(uuid) to service_role;
grant execute on function public.chat_edit_message(uuid, uuid, text, integer) to service_role;
grant execute on function public.chat_delete_message_for_me(uuid, uuid) to service_role;
grant execute on function public.chat_delete_message_for_everyone(uuid, uuid, integer) to service_role;
grant execute on function public.chat_set_reaction(uuid, uuid, text) to service_role;
grant execute on function public.chat_clear_reaction(uuid, uuid) to service_role;
grant execute on function public.chat_audio_access(uuid, uuid) to service_role;
grant execute on function public.chat_marcar_foco(uuid, uuid, integer) to service_role;
grant execute on function public.chat_push_target(uuid) to service_role;

commit;
