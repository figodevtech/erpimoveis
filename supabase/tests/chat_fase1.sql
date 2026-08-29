begin;

do $$
declare
  v_a constant uuid := 'ca000000-0000-4000-8000-000000000001';
  v_b constant uuid := 'ca000000-0000-4000-8000-000000000002';
  v_c constant uuid := 'ca000000-0000-4000-8000-000000000003';
  v_inativo constant uuid := 'ca000000-0000-4000-8000-000000000004';
  v_conversa uuid;
  v_conversa_repetida uuid;
  v_mensagem uuid;
  v_mensagem_repetida uuid;
  v_primeira_pagina uuid[];
  v_segunda_pagina uuid[];
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_total bigint;
  v_leitura_a uuid;
  v_leitura_b uuid;
begin
  if to_regclass('public.chat_conversa') is null
     or to_regclass('public.chat_participante') is null
     or to_regclass('public.chat_mensagem') is null then
    raise exception 'As tabelas do chat nao foram criadas';
  end if;

  insert into auth.users(id, email, raw_user_meta_data)
  values
    (v_a, 'chat-fase1-a@example.invalid', '{"nome":"Chat Teste A"}'::jsonb),
    (v_b, 'chat-fase1-b@example.invalid', '{"nome":"Chat Teste B"}'::jsonb),
    (v_c, 'chat-fase1-c@example.invalid', '{"nome":"Chat Teste C"}'::jsonb),
    (v_inativo, 'chat-fase1-inativo@example.invalid', '{"nome":"Chat Teste Inativo"}'::jsonb);

  update public.usuario set ativo = false where id = v_inativo;

  select conversa_id into v_conversa
  from public.chat_get_or_create_direct(v_a, v_b);

  select conversa_id into v_conversa_repetida
  from public.chat_get_or_create_direct(v_b, v_a);

  if v_conversa <> v_conversa_repetida then
    raise exception 'A conversa direta foi duplicada';
  end if;
  if (select count(*) from public.chat_conversa where direct_key = public.chat_direct_key(v_a, v_b)) <> 1 then
    raise exception 'A direct_key nao impediu duplicidade';
  end if;
  if (select count(*) from public.chat_participante where conversa_id = v_conversa) <> 2 then
    raise exception 'A conversa direta nao possui exatamente dois participantes';
  end if;
  set constraints chat_direct_two_participants immediate;
  set constraints chat_direct_two_participants deferred;

  begin
    perform public.chat_get_or_create_direct(v_inativo, v_a);
    raise exception 'Usuario inativo iniciou conversa';
  exception when insufficient_privilege then
    if sqlerrm <> 'INACTIVE_USER' then raise; end if;
  end;

  begin
    perform public.chat_send_message(v_conversa, v_c, 'Nao autorizado', gen_random_uuid());
    raise exception 'Nao participante enviou mensagem';
  exception when insufficient_privilege then
    if sqlerrm <> 'CHAT_FORBIDDEN' then raise; end if;
  end;

  begin
    perform public.chat_list_messages(v_c, v_conversa, null, null, 31);
    raise exception 'Nao participante leu a conversa';
  exception when insufficient_privilege then
    if sqlerrm <> 'CHAT_FORBIDDEN' then raise; end if;
  end;

  begin
    perform public.chat_send_message(v_conversa, v_a, '   ', gen_random_uuid());
    raise exception 'Mensagem vazia foi aceita';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_EMPTY_MESSAGE' then raise; end if;
  end;

  begin
    perform public.chat_send_message(v_conversa, v_a, repeat('x', 5001), gen_random_uuid());
    raise exception 'Mensagem acima do limite foi aceita';
  exception when string_data_right_truncation then
    if sqlerrm <> 'CHAT_MESSAGE_TOO_LONG' then raise; end if;
  end;

  select mensagem_id into v_mensagem
  from public.chat_send_message(
    v_conversa,
    v_a,
    'Mensagem idempotente',
    'cb000000-0000-4000-8000-000000000001'
  );
  select mensagem_id into v_mensagem_repetida
  from public.chat_send_message(
    v_conversa,
    v_a,
    'Mensagem idempotente',
    'cb000000-0000-4000-8000-000000000001'
  );
  if v_mensagem <> v_mensagem_repetida then
    raise exception 'client_message_id duplicou mensagem';
  end if;

  for i in 1..65 loop
    perform public.chat_send_message(
      v_conversa,
      v_a,
      'Paginada ' || lpad(i::text, 2, '0'),
      ('cb000000-0000-4000-8' || lpad(i::text, 3, '0') || '-000000000000')::uuid
    );
  end loop;

  select array_agg(p.mensagem_id order by p.created_at desc, p.mensagem_id desc)
  into v_primeira_pagina
  from public.chat_list_messages(v_b, v_conversa, null, null, 30) p;

  select m.created_at, m.id into v_cursor_at, v_cursor_id
  from public.chat_mensagem m
  where m.id = v_primeira_pagina[array_length(v_primeira_pagina, 1)];

  select array_agg(p.mensagem_id order by p.created_at desc, p.mensagem_id desc)
  into v_segunda_pagina
  from public.chat_list_messages(v_b, v_conversa, v_cursor_at, v_cursor_id, 30) p;

  if array_length(v_primeira_pagina, 1) <> 30 or array_length(v_segunda_pagina, 1) <> 30 then
    raise exception 'Paginacao nao retornou paginas completas';
  end if;
  if exists (
    select 1 from unnest(v_primeira_pagina) a(id)
    join unnest(v_segunda_pagina) b(id) using (id)
  ) then
    raise exception 'Paginacao repetiu mensagens';
  end if;

  select public.chat_unread_count(v_b) into v_total;
  if v_total <> 66 then
    raise exception 'Contador nao lido incorreto: %', v_total;
  end if;

  select last_read_message_id into v_leitura_a
  from public.chat_participante where conversa_id = v_conversa and usuario_id = v_a;

  select id into v_mensagem
  from public.chat_mensagem
  where conversa_id = v_conversa
  order by created_at desc, id desc
  limit 1;

  perform public.chat_mark_read(v_b, v_conversa, v_mensagem);

  select last_read_message_id into v_leitura_b
  from public.chat_participante where conversa_id = v_conversa and usuario_id = v_b;
  if v_leitura_b <> v_mensagem then
    raise exception 'Leitura do participante B nao foi atualizada';
  end if;
  if (select last_read_message_id from public.chat_participante where conversa_id = v_conversa and usuario_id = v_a)
     is distinct from v_leitura_a then
    raise exception 'Leitura do participante A foi alterada indevidamente';
  end if;
  if public.chat_unread_count(v_b) <> 0 then
    raise exception 'Contador nao zerou depois da leitura';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  if not public.chat_realtime_topic_allowed('chat:user:' || v_a::text) then
    raise exception 'Topico Realtime proprio foi recusado';
  end if;
  if public.chat_realtime_topic_allowed('chat:user:' || v_b::text) then
    raise exception 'Topico Realtime de terceiro foi autorizado';
  end if;

  raise notice 'Chat fase 1: dois participantes, autorizacao, idempotencia, paginacao, leitura e contador validados.';
end;
$$;

rollback;
