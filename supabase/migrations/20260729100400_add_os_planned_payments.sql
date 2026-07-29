alter table public.ordemservico
  add column if not exists pagamentos_previstos jsonb;

alter table public.ordemservico
  drop constraint if exists ordemservico_pagamentos_previstos_array;

alter table public.ordemservico
  add constraint ordemservico_pagamentos_previstos_array
  check (
    pagamentos_previstos is null
    or jsonb_typeof(pagamentos_previstos) = 'array'
  );

comment on column public.ordemservico.pagamentos_previstos is
  'Snapshot das formas de pagamento previstas, seus valores e parcelas ao enviar a OS ao financeiro.';
