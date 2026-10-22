begin;
alter table public.venda add column if not exists erp_stock_reserved boolean not null default false;
-- O saldo local e uma vitrine; pedidos com reserva central baixam somente no ERP.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.fn_processar_evento_pagamento_asaas_sem_devolucao(text,text,text,bigint,text,text,text)'::regprocedure) into definition;
 if position('and not v_venda.erp_stock_reserved' in definition)=0 then
  if position('if not v_venda.estoque_baixado then' in definition)=0 or position('estoque_baixado = true,' in definition)=0 then raise exception 'Unexpected payment function; review stock migration'; end if;
  definition:=replace(definition,'if not v_venda.estoque_baixado then','if not v_venda.estoque_baixado and not v_venda.erp_stock_reserved then');
  definition:=replace(definition,'estoque_baixado = true,','estoque_baixado = not v_venda.erp_stock_reserved,');
  execute definition;
 end if;
end $$;
commit;
