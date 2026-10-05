begin;

do $$
declare
  v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.fn_publicar_produto_novo_no_site()'::regprocedure,
    'public.fn_sync_site_order_delivery_snapshot()'::regprocedure,
    'public.marketplace_search_normalize(text)'::regprocedure,
    'public.fiscal_difal_regra_touch_atualizado_em()'::regprocedure,
    'public.nfe_origem_vinculo_validar()'::regprocedure,
    'public.nfe_origem_vinculo_sincronizar_status()'::regprocedure,
    'public.nfse_os_servico_vinculo_validar()'::regprocedure,
    'public.nfse_os_servico_vinculo_sincronizar_status()'::regprocedure
  ]
  loop
    if has_function_privilege('anon', v_signature, 'execute') then
      raise exception 'A função % continua executável por anon.', v_signature;
    end if;
    if has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'A função % continua executável por authenticated.', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'A função % deixou de ser executável pelo service_role.', v_signature;
    end if;
  end loop;
end;
$$;

rollback;
