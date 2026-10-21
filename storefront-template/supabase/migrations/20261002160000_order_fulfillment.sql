begin;

alter table public.venda
  add column if not exists status_entrega text
    check (status_entrega is null or status_entrega in ('SEPARACAO', 'FATURADO', 'ENVIADO', 'ENTREGUE')),
  add column if not exists transportadora text,
  add column if not exists url_rastreio text,
  add column if not exists nfe_numero text,
  add column if not exists nfe_serie text,
  add column if not exists nfe_chave_acesso text,
  add column if not exists danfe_url text,
  add column if not exists faturado_em timestamptz,
  add column if not exists enviado_em timestamptz;

create index if not exists venda_status_entrega_idx
  on public.venda (status_entrega, datavenda desc);

comment on column public.venda.nfe_chave_acesso is
  'Chave da NF-e emitida no ERP e devolvida para acompanhamento do pedido.';

commit;
