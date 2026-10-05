begin;

-- Funções internas chamadas por triggers e por RPCs do service_role não devem
-- ficar expostas como RPCs para a chave anon do navegador.
revoke all on function public.fn_publicar_produto_novo_no_site() from public, anon, authenticated;
grant execute on function public.fn_publicar_produto_novo_no_site() to service_role;

revoke all on function public.fn_sync_site_order_delivery_snapshot() from public, anon, authenticated;
grant execute on function public.fn_sync_site_order_delivery_snapshot() to service_role;

revoke all on function public.marketplace_search_normalize(text) from public, anon, authenticated;
grant execute on function public.marketplace_search_normalize(text) to service_role;

revoke all on function public.fiscal_difal_regra_touch_atualizado_em() from public, anon, authenticated;
grant execute on function public.fiscal_difal_regra_touch_atualizado_em() to service_role;

revoke all on function public.nfe_origem_vinculo_validar() from public, anon, authenticated;
grant execute on function public.nfe_origem_vinculo_validar() to service_role;

revoke all on function public.nfe_origem_vinculo_sincronizar_status() from public, anon, authenticated;
grant execute on function public.nfe_origem_vinculo_sincronizar_status() to service_role;

revoke all on function public.nfse_os_servico_vinculo_validar() from public, anon, authenticated;
grant execute on function public.nfse_os_servico_vinculo_validar() to service_role;

revoke all on function public.nfse_os_servico_vinculo_sincronizar_status() from public, anon, authenticated;
grant execute on function public.nfse_os_servico_vinculo_sincronizar_status() to service_role;

commit;
