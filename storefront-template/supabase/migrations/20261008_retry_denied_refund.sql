begin;
create table if not exists public.site_order_refund_attempt_history (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.venda(id),
  payment_id text not null,
  reason text not null,
  requested_at timestamptz not null,
  denied_at timestamptz not null,
  denial_reason text,
  archived_at timestamptz not null default now()
);
alter table public.site_order_refund_attempt_history enable row level security;
revoke all on public.site_order_refund_attempt_history from anon, authenticated;
grant all on public.site_order_refund_attempt_history to service_role;

create or replace function public.fn_reabrir_estorno_recusado_site(
  p_order_id bigint, p_payment_id text, p_expected_denied_at timestamptz, p_reason text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_request public.site_order_refund_request%rowtype;
begin
  select * into v_request from public.site_order_refund_request
  where order_id = p_order_id and payment_id = p_payment_id for update;
  if not found or v_request.denied_at is null or v_request.denied_at is distinct from p_expected_denied_at then
    return false;
  end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Motivo invalido'; end if;
  insert into public.site_order_refund_attempt_history(order_id,payment_id,reason,requested_at,denied_at,denial_reason)
  values(v_request.order_id,v_request.payment_id,v_request.reason,v_request.created_at,v_request.denied_at,v_request.denial_reason);
  update public.site_order_refund_request set reason = p_reason, created_at = now(), denied_at = null, denial_reason = null
  where order_id = p_order_id;
  return true;
end;
$$;
revoke all on function public.fn_reabrir_estorno_recusado_site(bigint,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.fn_reabrir_estorno_recusado_site(bigint,text,timestamptz,text) to service_role;
commit;
