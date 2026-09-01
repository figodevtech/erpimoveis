-- O valor inicial da conta bancaria era real (float4, ~7 digitos significativos):
-- 445,333221 chegava ao banco como 445,33322. numeric(18,6) guarda as 6 casas
-- exatas e aceita saldo de abertura negativo (conta que abre no vermelho).
-- float4 -> numeric usa a representacao curta de ida e volta no PG 12+, entao os
-- valores ja gravados convertem sem residuo.

alter table public.bancoconta
  alter column valorinicial type numeric(18,6)
  using valorinicial::numeric(18,6);
