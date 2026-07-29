alter table public.ordemservico
  add column if not exists parcelas_pagamento integer,
  add column if not exists descricao_financeiro text;

alter table public.ordemservico
  drop constraint if exists ordemservico_parcelas_pagamento_valida,
  drop constraint if exists ordemservico_parcelas_compativel_forma;

alter table public.ordemservico
  add constraint ordemservico_parcelas_pagamento_valida
  check (
    parcelas_pagamento is null
    or parcelas_pagamento between 1 and 12
  ),
  add constraint ordemservico_parcelas_compativel_forma
  check (
    parcelas_pagamento is null
    or forma_pagamento in ('CREDITO', 'BOLETO')
  );

comment on column public.ordemservico.parcelas_pagamento is
  'Quantidade prevista de parcelas para pagamento por credito ou boleto.';

comment on column public.ordemservico.descricao_financeiro is
  'Orientacoes livres registradas ao enviar a OS ao financeiro.';
