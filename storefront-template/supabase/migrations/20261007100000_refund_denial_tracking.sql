begin;
alter table public.site_order_refund_request
  add column if not exists denial_reason text,
  add column if not exists denied_at timestamptz;

create or replace function public.fn_registrar_recusa_estorno_site(
  p_order_id bigint, p_payment_id text, p_reason text, p_denied_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- Old events cannot reject a newer attempt. Never release the claim here.
  update public.site_order_refund_request
  set denial_reason = left(coalesce(nullif(p_reason, ''), 'Estorno recusado pelo Asaas'), 1000),
      denied_at = p_denied_at
  where order_id = p_order_id and payment_id = p_payment_id
    and p_denied_at >= created_at and (denied_at is null or denied_at < p_denied_at);
end;
$$;
revoke all on function public.fn_registrar_recusa_estorno_site(bigint,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fn_registrar_recusa_estorno_site(bigint,text,text,timestamptz) to service_role;
commit;
