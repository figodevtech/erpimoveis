begin;

-- Privilégios que faltaram para alinhar os bancos.
--
-- 1. Loja virtual: as policies *_own (20260928220000) só valem com o GRANT da
--    tabela. São os mesmos privilégios que o Demir já tem; a RLS continua
--    restringindo cada cliente autenticado às próprias linhas.
grant select, insert, update on table public.cliente to authenticated;
grant select, insert, update, delete on table public.cliente_endereco to authenticated;
grant select, insert, delete on table public.favorito to authenticated;
grant select on table public.venda to authenticated;
grant select on table public.vendaproduto to authenticated;
grant usage, select on sequence public.cliente_id_seq to authenticated;
grant usage, select on sequence public.cliente_endereco_id_seq to authenticated;
grant usage, select on sequence public.favorito_id_seq to authenticated;

-- 2. Ciência de aviso de NF-e é só de inclusão (20260922200000). No Demir o
--    service_role ainda tinha DELETE e TRUNCATE; nos demais já estava certo.
revoke delete, truncate on table public.nfe_ciencia_aviso from service_role;

commit;
