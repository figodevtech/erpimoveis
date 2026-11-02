-- Uma noite tem no máximo uma tarifa especial por imóvel. Antes, tarifas sobrepostas eram
-- aceitas e a cotação escolhia a "vencedora" por prioridade/id, o que o operador não via.
-- Mesma técnica da ocupação (imovel_ocupacao_sem_sobreposicao); fim exclusivo, como na cotação.
ALTER TABLE public.imovel_tarifa
  ADD CONSTRAINT imovel_tarifa_sem_sobreposicao
  EXCLUDE USING gist (imovel_id WITH =, daterange(inicio, fim, '[)') WITH &&) WHERE (ativo);
