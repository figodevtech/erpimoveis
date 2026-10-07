begin;
alter table public.telegram_usuario_preferencia add column if not exists notificar_site boolean not null default false;
-- Preserve previously enabled delivery before separating the controls.
update public.telegram_usuario_preferencia set notificar_site = notificar_marketplace;
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
       and notification.source in ('MERCADOLIVRE_WEBHOOK', 'SITE_ORDER')
       and notification.telegram_sent_at is null
       and notification.telegram_attempts < 5
       and (notification.telegram_next_retry_at is null or notification.telegram_next_retry_at <= now())
       and (notification.telegram_locked_at is null or notification.telegram_locked_at < now() - interval '15 minutes')
       and (p_source_event_id is null or notification.source_event_id = p_source_event_id)
       and preference.ativo = true
       and ((notification.source = 'MERCADOLIVRE_WEBHOOK' and preference.notificar_marketplace = true)
         or (notification.source = 'SITE_ORDER' and preference.notificar_site = true))
       and preference.chat_id is not null
       -- Sem escolha explícita o usuário continua recebendo tudo o que vê na
       -- central; um aviso sem evento no metadata nunca é engolido pelo filtro.
       and (
         notification.source = 'SITE_ORDER'
         or preference.marketplace_topicos_selecionados is null
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
