-- Tokens ativos permanecem nas colunas dedicadas da conta. Este JSON é apenas
-- diagnóstico e não deve duplicar credenciais sensíveis.
update public.mercadolivre_account
set raw_token = coalesce(raw_token, '{}'::jsonb) - 'access_token' - 'refresh_token',
    updated_at = now()
where raw_token ? 'access_token'
   or raw_token ? 'refresh_token';

comment on column public.mercadolivre_account.raw_token is
  'Metadados não sensíveis da autorização (tipo, escopo, expiração e usuário). Não armazenar access_token ou refresh_token.';
