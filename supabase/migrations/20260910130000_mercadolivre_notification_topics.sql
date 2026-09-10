begin;

-- Escolha por empresa: quais eventos do Mercado Livre viram aviso na central.
-- Nulo significa "ainda não escolheu" e cai no padrão do código (vendas e
-- atendimento ligados, anúncios desligados).
alter table public.mercadolivre_account
  add column if not exists notificacao_topicos jsonb;

comment on column public.mercadolivre_account.notificacao_topicos is
  'Eventos do Mercado Livre que geram aviso na central. Nulo = padrao do ERP.';

-- Escolha por usuário: o que dele chega no Telegram. Antes era tudo ou nada.
alter table public.telegram_usuario_preferencia
  add column if not exists marketplace_topicos_selecionados text[];

comment on column public.telegram_usuario_preferencia.marketplace_topicos_selecionados is
  'Eventos de marketplace que este usuario recebe no Telegram. Nulo = todos os que ele ve na central.';

-- O evento passa a viajar no metadata do aviso para que o filtro do Telegram não
-- precise reimplementar a tradução de tópico -> evento em SQL.
create or replace function public.fn_reservar_notificacoes_marketplace_telegram(
  p_limit integer default 50,
  p_source_event_id text default null
)
returns table (
  notification_id bigint,
  usuario_id uuid,
  chat_id bigint,
  title text,
  message text,
  href text,
  source_event_id text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select notification.id, preference.chat_id
      from public.system_notification notification
      join public.telegram_usuario_preferencia preference
        on preference.usuario_id = notification.usuario_id
     where notification.category = 'MARKETPLACE'
       and notification.source = 'MERCADOLIVRE_WEBHOOK'
       and notification.telegram_sent_at is null
       and notification.telegram_attempts < 5
       and (notification.telegram_next_retry_at is null or notification.telegram_next_retry_at <= now())
       and (notification.telegram_locked_at is null or notification.telegram_locked_at < now() - interval '15 minutes')
       and (p_source_event_id is null or notification.source_event_id = p_source_event_id)
       and preference.ativo = true
       and preference.notificar_marketplace = true
       and preference.chat_id is not null
       -- Sem escolha explícita o usuário continua recebendo tudo o que vê na
       -- central; um aviso sem evento no metadata nunca é engolido pelo filtro.
       and (
         preference.marketplace_topicos_selecionados is null
         or notification.metadata->>'event' is null
         or notification.metadata->>'event' = any (preference.marketplace_topicos_selecionados)
       )
     order by notification.created_at, notification.id
     for update of notification skip locked
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  update public.system_notification notification
     set telegram_attempts = notification.telegram_attempts + 1,
         telegram_locked_at = now()
    from candidates
   where notification.id = candidates.id
  returning notification.id,
            notification.usuario_id,
            candidates.chat_id,
            notification.title,
            notification.message,
            notification.href,
            notification.source_event_id,
            notification.telegram_attempts;
end;
$$;

revoke all on function public.fn_reservar_notificacoes_marketplace_telegram(integer, text) from public, anon, authenticated;
grant execute on function public.fn_reservar_notificacoes_marketplace_telegram(integer, text) to service_role;

commit;
