-- A tela de tarifas sempre pediu uma descrição ("Réveillon", "Alta temporada"), mas a
-- tabela não tinha onde guardar e o texto era descartado na gravação.
ALTER TABLE public.imovel_tarifa
  ADD COLUMN IF NOT EXISTS descricao text CHECK (descricao IS NULL OR char_length(btrim(descricao)) BETWEEN 1 AND 200);
