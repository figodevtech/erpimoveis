begin;

-- Não se sabe se algum cliente ainda recebe entrega direta do Mercado Livre ou
-- se todos já passam pela Figo Central. Medir antes de fechar a rota pública.
alter table public.mercadolivre_notification
  add column if not exists delivery_source text
    check (delivery_source is null or delivery_source in ('CENTRAL', 'DIRETO'));

comment on column public.mercadolivre_notification.delivery_source is
  'Como a notificacao chegou: CENTRAL (entrega assinada da Figo Central) ou DIRETO (webhook publico do Mercado Livre).';

create index if not exists mercadolivre_notification_delivery_source_idx
  on public.mercadolivre_notification (delivery_source, created_at desc);

commit;
