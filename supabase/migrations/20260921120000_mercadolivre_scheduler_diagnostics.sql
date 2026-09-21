-- Seven indexed lookups, independent of the paginated execution history.
create index if not exists mercadolivre_sync_run_job_started_idx
  on public.mercadolivre_sync_run (job_name, started_at desc, id desc);

create or replace function public.mercadolivre_latest_sync_runs()
returns setof public.mercadolivre_sync_run
language sql stable security invoker
set search_path = public
as $$
  select latest.*
  from unnest(array['NOTIFICATIONS','ORDERS','ITEMS','SHIPMENTS','STOCK','INVOICES','METRICS']) as jobs(name)
  cross join lateral (
    select r.* from public.mercadolivre_sync_run r
    where r.job_name = jobs.name
    order by r.started_at desc, r.id desc
    limit 1
  ) latest
  order by latest.started_at desc, latest.id desc;
$$;

revoke all on function public.mercadolivre_latest_sync_runs() from public, anon, authenticated;
grant execute on function public.mercadolivre_latest_sync_runs() to service_role;

create index if not exists mercadolivre_notification_unsupported_offers_idx
  on public.mercadolivre_notification (created_at, id)
  where topic = 'public_offers' and status = 'IGNORADA'
    and error = 'Tópico sem processador configurado: public_offers.' and account_id is not null;
