begin;
-- Restaura a baixa local anterior, preservando as demais regras de pagamento.
do $$
declare definition text; used boolean;
begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='venda' and column_name='erp_stock_reserved') then
  execute 'select exists(select 1 from public.venda where erp_stock_reserved)' into used;
  if used then raise exception 'Existem pedidos com reserva central. Reconciliar antes da reversao.'; end if;
 end if;
 select pg_get_functiondef('public.fn_processar_evento_pagamento_asaas_sem_devolucao(text,text,text,bigint,text,text,text)'::regprocedure) into definition;
 definition:=replace(definition,'if not v_venda.estoque_baixado and not v_venda.erp_stock_reserved then','if not v_venda.estoque_baixado then');
 definition:=replace(definition,'estoque_baixado = not v_venda.erp_stock_reserved,','estoque_baixado = true,');
 if position('erp_stock_reserved' in definition)>0 then raise exception 'Unexpected payment function; manual review required'; end if;
 execute definition;
end $$;
alter table public.venda drop column if exists erp_stock_reserved;
commit;
