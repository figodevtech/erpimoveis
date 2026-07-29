alter table public.ordemservico
  add column if not exists forma_pagamento text,
  add column if not exists garantia text;

alter table public.ordemservico
  drop constraint if exists ordemservico_forma_pagamento_valida,
  drop constraint if exists ordemservico_garantia_nao_vazia;

alter table public.ordemservico
  add constraint ordemservico_forma_pagamento_valida
  check (
    forma_pagamento is null
    or forma_pagamento in ('CREDITO', 'DEBITO', 'DINHEIRO', 'PIX', 'BOLETO')
  ),
  add constraint ordemservico_garantia_nao_vazia
  check (garantia is null or btrim(garantia) <> '');

comment on column public.ordemservico.forma_pagamento is
  'Forma de pagamento prevista ao enviar a OS ao financeiro; não representa quitação.';

comment on column public.ordemservico.garantia is
  'Informação de garantia registrada no envio da OS ao financeiro.';
