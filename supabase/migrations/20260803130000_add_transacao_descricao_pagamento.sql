-- Descricao livre do pagamento, separada da descricao da transacao.
--
-- A coluna `descricao` e preenchida automaticamente quando o lancamento nasce de
-- uma OS ou venda (o formulario a deixa travada) e ainda recebe o sufixo
-- " - Parcela N/M" no parcelamento. Nao sobra onde anotar o que foi aquele
-- pagamento especifico: entrada, sinal, troco, quem levou o dinheiro.
-- `descricao_pagamento` e sempre editavel e nunca reescrita pelo backend.
-- Campo opcional: transacoes antigas e chamadas que nao informam seguem valendo.

alter table public.transacao
  add column if not exists descricao_pagamento text;

comment on column public.transacao.descricao_pagamento is
  'Texto livre sobre o pagamento em si, informado por quem registrou a transacao. Preservado integralmente em cada parcela.';
