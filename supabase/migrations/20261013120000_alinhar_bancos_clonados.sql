begin;

-- Jean Car e HG nasceram de um dump do schema, e o dump deixa diferenças só de
-- forma, que o db:status acusa como schema divergente. Esta migration as
-- elimina; nos bancos criados pelas migrations ela não muda nada.

-- 1. O dump regrava o CHECK com outra árvore de expressão (o mesmo IN, com os
--    casts em outro lugar). Recriar a partir do mesmo SQL deixa todos iguais.
alter table public.ordemservico drop constraint if exists ordemservico_destaque_cor_chk;
alter table public.ordemservico
  add constraint ordemservico_destaque_cor_chk
  check (destaque_cor in ('vermelho', 'amarelo'));

-- 2. Projeto Supabase novo vem com o gatilho de evento "ensure_rls", que liga
--    RLS em toda tabela criada. Só os bancos novos o têm: a mesma migration
--    criaria uma tabela com RLS em uns e sem em outros (Realtime e leituras de
--    authenticated quebrariam só ali). A função ainda fica executável por anon.
--    O RLS de cada tabela é decidido nas migrations, igual em todos os bancos.
drop event trigger if exists ensure_rls;
drop function if exists public.rls_auto_enable();

commit;
