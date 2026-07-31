-- Reconcilia funcoes de negocio e garante a mesma cobertura de auditoria.

BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anterior jsonb := CASE WHEN tg_op IN ('UPDATE', 'DELETE') THEN to_jsonb(old) ELSE NULL END;
  novo jsonb := CASE WHEN tg_op IN ('INSERT', 'UPDATE') THEN to_jsonb(new) ELSE NULL END;
  anterior_alterado jsonb;
  novo_alterado jsonb;
  campos text[] := '{}'::text[];
  linha_referencia jsonb;
  ator uuid;
  contexto_externo jsonb;
  id_registro text;
BEGIN
  IF tg_op = 'UPDATE' AND anterior = novo THEN
    RETURN new;
  END IF;

  linha_referencia := coalesce(novo, anterior);

  IF tg_op = 'UPDATE' THEN
    SELECT
      coalesce(jsonb_object_agg(chave, anterior -> chave), '{}'::jsonb),
      coalesce(jsonb_object_agg(chave, novo -> chave), '{}'::jsonb),
      coalesce(array_agg(chave ORDER BY chave), '{}'::text[])
    INTO anterior_alterado, novo_alterado, campos
    FROM (
      SELECT chave
      FROM jsonb_object_keys(anterior || novo) AS chaves(chave)
      WHERE (anterior -> chave) IS DISTINCT FROM (novo -> chave)
    ) alteracoes;
  ELSIF tg_op = 'INSERT' THEN
    novo_alterado := novo;
    SELECT coalesce(array_agg(chave ORDER BY chave), '{}'::text[])
      INTO campos
    FROM jsonb_object_keys(novo) AS chaves(chave);
  ELSE
    anterior_alterado := anterior;
    SELECT coalesce(array_agg(chave ORDER BY chave), '{}'::text[])
      INTO campos
    FROM jsonb_object_keys(anterior) AS chaves(chave);
  END IF;

  ator := coalesce(
    public.auditoria_try_uuid(current_setting('app.audit_user_id', true)),
    auth.uid(),
    public.auditoria_usuario_requisicao()
  );
  contexto_externo := CASE
    WHEN ator IS NULL THEN public.auditoria_contexto_externo_requisicao()
    ELSE NULL
  END;

  IF ator IS NULL AND tg_op = 'INSERT' THEN
    ator := coalesce(
      public.auditoria_try_uuid(novo ->> 'created_by'),
      public.auditoria_try_uuid(novo ->> 'createdby'),
      public.auditoria_try_uuid(novo ->> 'usuariocriadorid')
    );
  ELSIF ator IS NULL AND tg_op = 'UPDATE' THEN
    ator := coalesce(
      public.auditoria_try_uuid(novo ->> 'updated_by'),
      public.auditoria_try_uuid(novo ->> 'updatedby'),
      public.auditoria_try_uuid(novo ->> 'usuarioalteracaoid')
    );
  ELSIF ator IS NULL AND tg_op = 'DELETE' THEN
    ator := coalesce(
      public.auditoria_try_uuid(anterior ->> 'deleted_by'),
      public.auditoria_try_uuid(anterior ->> 'updated_by'),
      public.auditoria_try_uuid(anterior ->> 'updatedby'),
      public.auditoria_try_uuid(anterior ->> 'usuarioalteracaoid')
    );
  END IF;

  IF ator IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = ator) THEN
    ator := NULL;
  END IF;

  id_registro := coalesce(
    linha_referencia ->> 'id',
    linha_referencia ->> 'uuid',
    linha_referencia ->> 'ordemservicoid',
    linha_referencia ->> 'vendaid',
    linha_referencia ->> 'produtoid',
    linha_referencia ->> 'clienteid',
    nullif(concat_ws(':', linha_referencia ->> 'perfilid', linha_referencia ->> 'permissaoid'), '')
  );

  INSERT INTO public.auditoria_evento (
    operacao,
    modulo,
    tabela,
    registro_id,
    usuario_id,
    ator_nome,
    dados_anteriores,
    dados_novos,
    campos_alterados,
    origem
  ) VALUES (
    tg_op,
    public.auditoria_modulo_tabela(tg_table_name),
    tg_table_name,
    id_registro,
    ator,
    contexto_externo ->> 'nome',
    public.auditoria_json_seguro(anterior_alterado),
    public.auditoria_json_seguro(novo_alterado),
    campos,
    CASE
      WHEN ator IS NOT NULL THEN 'usuario'
      WHEN contexto_externo ->> 'origem' = 'cliente' THEN 'cliente'
      ELSE 'sistema'
    END
  );

  IF tg_op = 'DELETE' THEN
    RETURN old;
  END IF;
  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Falha ao auditar %.%: %', tg_table_schema, tg_table_name, sqlerrm;
  IF tg_op = 'DELETE' THEN
    RETURN old;
  END IF;
  RETURN new;
END;
$$;

ALTER FUNCTION public.registrar_auditoria() OWNER TO postgres;

ALTER FUNCTION public.registrar_consulta_placa_empresa(integer) SECURITY DEFINER;
ALTER FUNCTION public.registrar_consulta_placa_empresa(integer) SET search_path = public;
REVOKE ALL ON FUNCTION public.registrar_consulta_placa_empresa(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_consulta_placa_empresa(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_os_status_estornar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Rejeicao do orcamento e cancelamento definitivo devolvem qualquer baixa existente.
  IF new.status IN ('ORCAMENTO_RECUSADO', 'CANCELADO')
     AND old.status IS DISTINCT FROM new.status THEN
    PERFORM public.estornar_baixa_estoque_os(new.id);
  END IF;
  RETURN new;
END;
$$;

ALTER FUNCTION public.trg_os_status_estornar() OWNER TO postgres;

-- Recria o mesmo trigger em todas as tabelas de negocio atualmente existentes.
DO $$
DECLARE
  tabela record;
BEGIN
  FOR tabela IN
    SELECT c.oid::regclass AS nome
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> 'auditoria_evento'
      AND c.relname !~* '(audit|auditoria|log|queue|fila|metric|notification|notificacao|evento|session|verification)'
    ORDER BY c.relname
  LOOP
    PERFORM public.habilitar_auditoria_tabela(tabela.nome);
  END LOOP;
END;
$$;

COMMIT;
