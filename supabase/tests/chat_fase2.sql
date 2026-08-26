begin;

do $$
declare
  v_a constant uuid := 'cb000000-0000-4000-8000-000000000001';
  v_b constant uuid := 'cb000000-0000-4000-8000-000000000002';
  v_c constant uuid := 'cb000000-0000-4000-8000-000000000003';
  v_conversa uuid;
  v_conversa_ac uuid;
  v_m1 uuid;
  v_m2 uuid;
  v_m3 uuid;
  v_outra_conversa_msg uuid;
  v_voz uuid;
  v_audio_path text;
  v_texto text;
  v_nome text;
  v_tipo text;
  v_editada timestamptz;
  v_criada_em timestamptz;
  v_criada_depois timestamptz;
  v_total bigint;
  v_reacoes jsonb;
  v_destinatario uuid;
  v_suprimido boolean;
begin
  if to_regclass('public.chat_reacao') is null
     or to_regclass('public.chat_mensagem_oculta') is null
     or to_regclass('public.chat_mensagem_edicao') is null
     or to_regclass('public.chat_push_subscription') is null
     or to_regclass('public.chat_audio_pendente_remocao') is null then
    raise exception 'As tabelas da fase 2 nao foram criadas';
  end if;

  insert into auth.users(id, email, raw_user_meta_data)
  values
    (v_a, 'chat-fase2-a@example.invalid', '{"nome":"Chat Fase2 A"}'::jsonb),
    (v_b, 'chat-fase2-b@example.invalid', '{"nome":"Chat Fase2 B"}'::jsonb),
    (v_c, 'chat-fase2-c@example.invalid', '{"nome":"Chat Fase2 C"}'::jsonb);

  select conversa_id into v_conversa from public.chat_get_or_create_direct(v_a, v_b);
  select conversa_id into v_conversa_ac from public.chat_get_or_create_direct(v_a, v_c);

  -- ================================================================
  -- Mensagens antigas continuam validas como TEXT
  -- ================================================================
  select mensagem_id into v_m1
  from public.chat_send_message(v_conversa, v_a, 'A peca da OS chegou?', gen_random_uuid());

  if (select tipo from public.chat_mensagem where id = v_m1) <> 'TEXT' then
    raise exception 'Mensagem sem tipo explicito nao virou TEXT';
  end if;

  select mensagem_id into v_outra_conversa_msg
  from public.chat_send_message(v_conversa_ac, v_a, 'Outra conversa', gen_random_uuid());

  -- ================================================================
  -- Resposta citada
  -- ================================================================
  select mensagem_id into v_m2
  from public.chat_send_message(
    v_conversa, v_b, 'Chegou sim.', gen_random_uuid(), 'TEXT', v_m1
  );

  select reply_snapshot_conteudo, reply_snapshot_remetente_nome, reply_snapshot_tipo
  into v_texto, v_nome, v_tipo
  from public.chat_mensagem where id = v_m2;

  if v_texto <> 'A peca da OS chegou?' then
    raise exception 'Recorte historico da citacao esta incorreto: %', v_texto;
  end if;
  if v_nome is null or v_nome = '' then
    raise exception 'Citacao nao guardou o autor original';
  end if;
  if v_tipo <> 'TEXT' then
    raise exception 'Citacao nao guardou o tipo do original';
  end if;

  begin
    perform public.chat_send_message(
      v_conversa, v_b, 'Citando outra conversa', gen_random_uuid(), 'TEXT', v_outra_conversa_msg
    );
    raise exception 'Citacao aceitou mensagem de outra conversa';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_INVALID_REPLY_TARGET' then raise; end if;
  end;

  begin
    perform public.chat_send_message(
      v_conversa, v_b, 'Citando id inexistente', gen_random_uuid(), 'TEXT', gen_random_uuid()
    );
    raise exception 'Citacao aceitou id inexistente';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_INVALID_REPLY_TARGET' then raise; end if;
  end;

  -- ================================================================
  -- Reacoes
  -- ================================================================
  perform public.chat_set_reaction(v_b, v_m1, 'CORACAO');
  if (select count(*) from public.chat_reacao where mensagem_id = v_m1) <> 1 then
    raise exception 'Reacao valida nao foi registrada';
  end if;

  begin
    perform public.chat_set_reaction(v_b, v_m1, 'FOGUETE');
    raise exception 'Reacao fora do conjunto permitido foi aceita';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_INVALID_REACTION' then raise; end if;
  end;

  perform public.chat_set_reaction(v_b, v_m1, 'LEGAL');
  if (select count(*) from public.chat_reacao where mensagem_id = v_m1 and usuario_id = v_b) <> 1 then
    raise exception 'Trocar de reacao criou uma segunda linha';
  end if;
  if (select reacao from public.chat_reacao where mensagem_id = v_m1 and usuario_id = v_b) <> 'LEGAL' then
    raise exception 'A reacao anterior nao foi substituida';
  end if;

  select reacoes into v_reacoes from public.chat_set_reaction(v_a, v_m1, 'LEGAL');
  if (v_reacoes -> 0 ->> 'total')::int <> 2 then
    raise exception 'Agregado de reacoes nao somou os dois participantes: %', v_reacoes;
  end if;

  begin
    perform public.chat_set_reaction(v_c, v_m1, 'FELIZ');
    raise exception 'Nao participante reagiu a mensagem';
  exception when insufficient_privilege then
    if sqlerrm <> 'CHAT_FORBIDDEN' then raise; end if;
  end;

  perform public.chat_clear_reaction(v_b, v_m1);
  if (select count(*) from public.chat_reacao where mensagem_id = v_m1 and usuario_id = v_b) <> 0 then
    raise exception 'Repetir a mesma reacao nao removeu o registro';
  end if;

  begin
    insert into public.chat_reacao(mensagem_id, usuario_id, reacao) values (v_m1, v_a, 'FELIZ');
    raise exception 'A restricao unica nao impediu duas reacoes do mesmo usuario';
  exception when unique_violation then
    null;
  end;

  -- ================================================================
  -- Edicao
  -- ================================================================
  select created_at into v_criada_em from public.chat_mensagem where id = v_m1;
  v_total := public.chat_unread_count(v_b);

  perform public.chat_edit_message(v_a, v_m1, 'A peca da OS ja chegou?');

  select conteudo, editada_em, created_at into v_texto, v_editada, v_criada_depois
  from public.chat_mensagem where id = v_m1;
  if v_texto <> 'A peca da OS ja chegou?' then
    raise exception 'A edicao nao alterou o conteudo';
  end if;
  if v_editada is null then
    raise exception 'A edicao nao marcou editada_em';
  end if;
  if v_criada_em <> v_criada_depois then
    raise exception 'A edicao alterou created_at';
  end if;
  if (select count(*) from public.chat_mensagem_edicao where mensagem_id = v_m1) <> 1 then
    raise exception 'O historico de edicao nao registrou o conteudo anterior';
  end if;
  if (select conteudo_anterior from public.chat_mensagem_edicao where mensagem_id = v_m1)
     <> 'A peca da OS chegou?' then
    raise exception 'O historico guardou o conteudo errado';
  end if;
  if public.chat_unread_count(v_b) <> v_total then
    raise exception 'A edicao alterou o contador de nao lidas';
  end if;

  begin
    perform public.chat_edit_message(v_b, v_m1, 'Editando mensagem alheia');
    raise exception 'Outro usuario editou a mensagem';
  exception when insufficient_privilege then
    if sqlerrm <> 'CHAT_FORBIDDEN' then raise; end if;
  end;

  begin
    perform public.chat_edit_message(v_a, v_m1, 'Fora do prazo', 0);
    raise exception 'Edicao fora do prazo foi aceita';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_EDIT_WINDOW_EXPIRED' then raise; end if;
  end;

  begin
    perform public.chat_edit_message(v_a, v_m1, '   ');
    raise exception 'Edicao vazia foi aceita';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_EMPTY_MESSAGE' then raise; end if;
  end;

  -- ================================================================
  -- Mensagem de voz
  -- ================================================================
  select mensagem_id into v_voz
  from public.chat_send_message(
    v_conversa, v_a, '', gen_random_uuid(), 'VOICE', null,
    v_conversa::text || '/' || v_a::text || '/voz-1.webm', 'audio/webm', 4096, 7000
  );

  if (select tipo from public.chat_mensagem where id = v_voz) <> 'VOICE' then
    raise exception 'A mensagem de voz nao foi gravada com o tipo VOICE';
  end if;
  if (select conteudo from public.chat_mensagem where id = v_voz) <> '' then
    raise exception 'A mensagem de voz guardou texto';
  end if;

  begin
    perform public.chat_send_message(
      v_conversa, v_a, '', gen_random_uuid(), 'VOICE', null, null, 'audio/webm', 4096, 7000
    );
    raise exception 'Mensagem de voz sem arquivo foi aceita';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_INVALID_AUDIO' then raise; end if;
  end;

  begin
    perform public.chat_send_message(
      v_conversa, v_a, '', gen_random_uuid(), 'VOICE', null, 'caminho.webm', 'audio/webm', 20000000, 7000
    );
    raise exception 'Audio acima do limite de tamanho foi aceito';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_AUDIO_TOO_LARGE' then raise; end if;
  end;

  begin
    perform public.chat_send_message(
      v_conversa, v_a, '', gen_random_uuid(), 'VOICE', null, 'caminho.webm', 'audio/webm', 4096, 400000
    );
    raise exception 'Audio acima da duracao maxima foi aceito';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_AUDIO_TOO_LONG' then raise; end if;
  end;

  select audio_path into v_audio_path from public.chat_audio_access(v_b, v_voz);
  if v_audio_path is null then
    raise exception 'Participante nao conseguiu acessar o audio';
  end if;

  begin
    perform public.chat_audio_access(v_c, v_voz);
    raise exception 'Nao participante acessou o audio';
  exception when insufficient_privilege then
    if sqlerrm <> 'CHAT_FORBIDDEN' then raise; end if;
  end;

  -- ================================================================
  -- Excluir para mim
  -- ================================================================
  v_total := public.chat_unread_count(v_a);
  perform public.chat_delete_message_for_me(v_b, v_m1);

  if exists (
    select 1 from public.chat_list_messages(v_b, v_conversa, null, null, 51)
    where mensagem_id = v_m1
  ) then
    raise exception 'Mensagem oculta continuou visivel para quem excluiu';
  end if;
  if not exists (
    select 1 from public.chat_list_messages(v_a, v_conversa, null, null, 51)
    where mensagem_id = v_m1
  ) then
    raise exception 'Excluir para mim escondeu a mensagem do outro participante';
  end if;
  if public.chat_unread_count(v_a) <> v_total then
    raise exception 'Excluir para mim alterou o contador do outro participante';
  end if;
  if (select count(*) from public.chat_mensagem where id = v_m1) <> 1 then
    raise exception 'Excluir para mim apagou o registro principal';
  end if;

  -- A resposta que cita a mensagem oculta continua renderizavel.
  if (select reply_snapshot_conteudo from public.chat_mensagem where id = v_m2) is null then
    raise exception 'O recorte da citacao foi perdido';
  end if;

  -- ================================================================
  -- Excluir para todos
  -- ================================================================
  select mensagem_id into v_m3
  from public.chat_send_message(v_conversa, v_a, 'Mensagem que sera excluida', gen_random_uuid());
  perform public.chat_set_reaction(v_b, v_m3, 'TRISTE');

  begin
    perform public.chat_delete_message_for_everyone(v_b, v_m3);
    raise exception 'Participante excluiu para todos mensagem de outro autor';
  exception when insufficient_privilege then
    if sqlerrm <> 'CHAT_FORBIDDEN' then raise; end if;
  end;

  begin
    perform public.chat_delete_message_for_everyone(v_a, v_m3, 0);
    raise exception 'Exclusao para todos fora do prazo foi aceita';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_DELETE_WINDOW_EXPIRED' then raise; end if;
  end;

  v_total := public.chat_unread_count(v_b);
  perform public.chat_delete_message_for_everyone(v_a, v_m3);

  if (select conteudo from public.chat_mensagem where id = v_m3) <> '' then
    raise exception 'A exclusao para todos nao limpou o conteudo';
  end if;
  if (select excluida_para_todos_por from public.chat_mensagem where id = v_m3) <> v_a then
    raise exception 'A exclusao para todos nao registrou o autor';
  end if;
  if (select count(*) from public.chat_reacao where mensagem_id = v_m3) <> 0 then
    raise exception 'As reacoes da mensagem excluida permaneceram';
  end if;
  if public.chat_unread_count(v_b) >= v_total then
    raise exception 'Mensagem excluida para todos continuou contando como nao lida';
  end if;
  if not exists (
    select 1 from public.chat_list_messages(v_b, v_conversa, null, null, 51)
    where mensagem_id = v_m3
  ) then
    raise exception 'A mensagem excluida sumiu da timeline em vez de virar aviso';
  end if;

  begin
    perform public.chat_edit_message(v_a, v_m3, 'Editando excluida');
    raise exception 'Mensagem excluida para todos foi editada';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_MESSAGE_NOT_EDITABLE' then raise; end if;
  end;

  begin
    perform public.chat_set_reaction(v_b, v_m3, 'FELIZ');
    raise exception 'Mensagem excluida para todos aceitou nova reacao';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_MESSAGE_UNAVAILABLE' then raise; end if;
  end;

  begin
    perform public.chat_send_message(
      v_conversa, v_b, 'Citando excluida', gen_random_uuid(), 'TEXT', v_m3
    );
    raise exception 'Citacao aceitou mensagem excluida para todos';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_INVALID_REPLY_TARGET' then raise; end if;
  end;

  -- ================================================================
  -- Audio excluido deixa de ser acessivel e entra na fila de remocao
  -- ================================================================
  perform public.chat_delete_message_for_everyone(v_a, v_voz);

  if not exists (select 1 from public.chat_audio_pendente_remocao where path = v_audio_path) then
    raise exception 'O audio excluido nao entrou na fila de remocao do Storage';
  end if;
  if (select audio_path from public.chat_mensagem where id = v_voz) is not null then
    raise exception 'A mensagem excluida manteve o caminho do audio';
  end if;

  begin
    perform public.chat_audio_access(v_b, v_voz);
    raise exception 'Audio de mensagem excluida continuou acessivel';
  exception when invalid_parameter_value then
    if sqlerrm <> 'CHAT_AUDIO_UNAVAILABLE' then raise; end if;
  end;

  -- ================================================================
  -- Alvo do Web Push
  -- ================================================================
  select destinatario_id, suprimido into v_destinatario, v_suprimido
  from public.chat_push_target(v_m2);

  if v_destinatario <> v_a then
    raise exception 'O push seria enviado para o destinatario errado';
  end if;
  if v_suprimido then
    raise exception 'O push foi suprimido sem foco confirmado';
  end if;

  perform public.chat_marcar_foco(v_a, v_conversa, 60);
  select suprimido into v_suprimido from public.chat_push_target(v_m2);
  if not v_suprimido then
    raise exception 'O push nao foi suprimido com a conversa em foco';
  end if;

  perform public.chat_marcar_foco(v_a, v_conversa, 0);
  select suprimido into v_suprimido from public.chat_push_target(v_m2);
  if v_suprimido then
    raise exception 'A supressao do push nao foi liberada';
  end if;

  -- Mensagem oculta pelo destinatario nunca gera push.
  perform public.chat_delete_message_for_me(v_a, v_m2);
  if exists (select 1 from public.chat_push_target(v_m2)) then
    raise exception 'Push seria enviado para mensagem oculta pelo destinatario';
  end if;

  -- ================================================================
  -- Assinaturas Web Push
  -- ================================================================
  insert into public.chat_push_subscription(usuario_id, endpoint, endpoint_hash, p256dh, auth)
  values
    (v_a, 'https://push.invalid/a1', md5('https://push.invalid/a1'), 'p1', 'a1'),
    (v_a, 'https://push.invalid/a2', md5('https://push.invalid/a2'), 'p2', 'a2');

  if (select count(*) from public.chat_push_subscription where usuario_id = v_a) <> 2 then
    raise exception 'Um usuario nao pode manter dois dispositivos';
  end if;

  begin
    insert into public.chat_push_subscription(usuario_id, endpoint, endpoint_hash, p256dh, auth)
    values (v_b, 'https://push.invalid/a1', md5('https://push.invalid/a1'), 'p1', 'a1');
    raise exception 'Endpoint duplicado criou uma segunda assinatura';
  exception when unique_violation then
    null;
  end;

  raise notice 'Chat fase 2: citacao, reacoes, edicao, exclusoes, voz, supressao e assinaturas de push validadas.';
end;
$$;

rollback;
