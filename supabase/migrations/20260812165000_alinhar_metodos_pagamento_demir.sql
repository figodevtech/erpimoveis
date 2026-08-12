-- Garante que todos os bancos tenham, no minimo, os metodos de pagamento
-- existentes no Demir. A ordem abaixo acompanha o enum do Demir e a migration
-- e idempotente para o banco onde os valores foram cadastrados manualmente.
alter type public.metodo_pagamento add value if not exists 'PERMUTA';
alter type public.metodo_pagamento add value if not exists 'DEBITO AUTOMATICO';
alter type public.metodo_pagamento add value if not exists 'CHEQUE';
alter type public.metodo_pagamento add value if not exists 'CREDITO EM CONTA';
