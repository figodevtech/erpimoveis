begin;

-- Bancos criados pelo db:novo-cliente receberam o histórico de migrations sem
-- as policies de realtime.messages: a exportação do modelo só copiava as do
-- schema storage. Sem elas nenhum usuário entra nos canais privados — chat,
-- central operacional e ordens ficam só na consulta periódica. HG estava sem
-- nenhuma; Jean Car, só com a de ordens. Recria as quatro em todos os bancos,
-- idênticas às das migrations de origem.

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

drop policy if exists central_operacional_realtime_receive on realtime.messages;
create policy central_operacional_realtime_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.central_realtime_topic_allowed((select realtime.topic()))
);

drop policy if exists ordens_realtime_receive on realtime.messages;
create policy ordens_realtime_receive on realtime.messages for select to authenticated
using (extension = 'broadcast' and public.ordens_realtime_topic_allowed((select realtime.topic())));

commit;
