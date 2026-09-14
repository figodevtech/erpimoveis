-- O advisor de segurança do Supabase acusou, em 14/09, nove tabelas do public
-- sem RLS e funções SECURITY DEFINER executáveis por anon.
--
-- Funções: `20260820180000_public_schema_lockdown` tentou fechar as funções
-- futuras com `alter default privileges ... in schema public revoke ... from
-- public`, e essa forma não tem efeito. Privilégio padrão por schema só soma ao
-- padrão global, e o padrão global do Postgres dá EXECUTE a PUBLIC em toda
-- função nova. Resultado: toda função criada depois de 20/08 sem REVOKE
-- explícito nasceu executável por anon. A chave anon vai no bundle do
-- navegador, e uma função SECURITY DEFINER roda como dono — basta a chave para
-- chamar por /rest/v1/rpc rotinas que gravam transferência, estoque, consumo e
-- conciliação OFX.
--
-- Tabelas: as nove nasceram depois do lockdown e nenhuma migration ligou RLS.
-- O lockdown já tirava delas os privilégios de anon/authenticated, mas RLS
-- ligado em todo o public é a invariante que ele estabeleceu, e é o que garante
-- que um GRANT futuro por engano não abra a tabela.
--
-- O ERP acessa tudo pelo servidor com service_role, que ignora RLS e recebe
-- EXECUTE de novo abaixo. `authenticated` só existe no JWT curto do Realtime, e
-- as únicas funções que ele precisa executar são as que as políticas de
-- `realtime.messages` chamam (chat e central operacional).
--
-- O `db:status` e o `db:deploy` passam a acusar função executável por anon,
-- porque a próxima migration que esquecer o REVOKE reabre o mesmo buraco.

-- ---------------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT n.nspname AS schema_name, c.relname AS relation_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                   relation.schema_name, relation.relation_name);
    EXECUTE format('ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY',
                   relation.schema_name, relation.relation_name);
  END LOOP;
END
$$;

REVOKE ALL ON TABLE
  public.transacao_transferencia,
  public.classificacoes_resultado,
  public.plano_contas_classificacao_regra,
  public.eventos_financeiros_classificacao,
  public.dre_implantacao,
  public.plano_contas_lote,
  public.plano_contas_lote_item,
  public.ofx_importacao,
  public.ofx_movimento
FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Funções e procedures da aplicação
-- ---------------------------------------------------------------------------
-- Funções instaladas por extensão ficam de fora pelo mesmo motivo do lockdown:
-- não são da aplicação e o usuário de migrations não altera a ACL delas.
DO $$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (
         SELECT 1
           FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass
            AND d.objid = p.oid
            AND d.deptype = 'e'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon, authenticated',
                   routine.signature);
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role',
                   routine.signature);
  END LOOP;
END
$$;

-- Os dois são SECURITY DEFINER e só respondem se o usuário do JWT participa do
-- tópico; sem EXECUTE o Realtime recusa todo canal privado.
GRANT EXECUTE ON FUNCTION public.chat_realtime_topic_allowed(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.central_realtime_topic_allowed(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) A migration falha se algo continuar aberto
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Há tabelas do schema public sem RLS';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (
         SELECT 1
           FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass
            AND d.objid = p.oid
            AND d.deptype = 'e'
       )
       AND (
         has_function_privilege('anon', p.oid, 'EXECUTE')
         OR (
           has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND p.proname NOT IN ('chat_realtime_topic_allowed', 'central_realtime_topic_allowed')
         )
       )
  ) THEN
    RAISE EXCEPTION 'Há funções do schema public executáveis por anon/authenticated';
  END IF;
END
$$;
