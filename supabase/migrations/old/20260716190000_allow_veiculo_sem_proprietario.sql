alter table public.veiculo
alter column clienteid drop not null;

alter table public.veiculo
drop constraint if exists fk_veiculo_cliente;

alter table public.veiculo
add constraint fk_veiculo_cliente
foreign key (clienteid) references public.cliente(id) on delete set null;
