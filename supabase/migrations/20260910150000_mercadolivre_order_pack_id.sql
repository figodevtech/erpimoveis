begin;

-- Reclamações e mensagens eram ligadas ao pedido varrendo as últimas 100 linhas
-- e procurando o número do pedido dentro do JSON inteiro do evento. Funciona com
-- volume baixo e falha em silêncio quando cresce.
alter table public.mercadolivre_order
  add column if not exists ml_pack_id bigint;

comment on column public.mercadolivre_order.ml_pack_id is
  'Carrinho do Mercado Livre. Varias orders compartilham o mesmo pack e a mesma conversa.';

update public.mercadolivre_order
   set ml_pack_id = nullif(coalesce(raw_order->>'pack_id', raw_order->'pack'->>'id'), '')::bigint
 where ml_pack_id is null
   and coalesce(raw_order->>'pack_id', raw_order->'pack'->>'id') ~ '^[0-9]+$';

create index if not exists mercadolivre_order_pack_idx
  on public.mercadolivre_order (empresa_id, account_id, ml_pack_id)
  where ml_pack_id is not null;

create index if not exists mercadolivre_order_ml_order_idx
  on public.mercadolivre_order (empresa_id, account_id, ml_order_id);

commit;
