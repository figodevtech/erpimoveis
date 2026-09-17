BEGIN;

-- Arquivos fiscais ficam privados. O acesso é exclusivamente server-side com
-- service_role e URLs assinadas; não se criam policies para anon/authenticated.
INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) VALUES (
  'fiscal-sped',
  'fiscal-sped',
  false,
  52428800,
  ARRAY['text/plain', 'text/csv', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO public.permissao(nome, descricao) VALUES
  ('fiscal:sped', 'Visualizar competências e baixar arquivos do SPED Fiscal'),
  ('fiscal:sped_gerenciar', 'Configurar, importar, ajustar, validar, fechar e reabrir o SPED Fiscal')
ON CONFLICT(nome) DO UPDATE SET descricao = EXCLUDED.descricao;

-- Ambas as permissões nascem apenas no perfil administrativo. O conteúdo do
-- SPED inclui XML e apuração fiscal; redistribuir leitura ou gestão exige uma
-- decisão explícita da administração.
INSERT INTO public.perfilpermissao(perfilid, permissaoid)
SELECT p.id, permissao.id
  FROM public.perfil p
  JOIN public.permissao permissao
    ON permissao.nome IN ('fiscal:sped', 'fiscal:sped_gerenciar')
 WHERE upper(p.nome) = 'ADMINISTRADOR'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.fiscal_sped_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_bloquear_registro_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Registro fiscal imutavel: %.%', tg_table_schema, tg_table_name
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_guardar_snapshot_rascunho()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_linha jsonb;
  v_versao_id bigint;
  v_status text;
BEGIN
  v_linha := CASE WHEN tg_op = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  IF tg_table_name = 'fiscal_sped_item_snapshot' THEN
    SELECT documento.versao_id
      INTO v_versao_id
      FROM public.fiscal_sped_documento_snapshot documento
     WHERE documento.id = (v_linha ->> 'documento_snapshot_id')::bigint;
  ELSE
    v_versao_id := (v_linha ->> 'versao_id')::bigint;
  END IF;

  SELECT status INTO v_status
    FROM public.fiscal_sped_versao
   WHERE id = v_versao_id;

  IF v_status IS DISTINCT FROM 'RASCUNHO' THEN
    RAISE EXCEPTION 'Snapshots somente podem ser alterados em versao RASCUNHO.'
      USING ERRCODE = '55000';
  END IF;

  IF tg_op = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_guardar_versao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    RAISE EXCEPTION 'Versoes SPED nao podem ser excluidas.' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'SUBSTITUIDA' THEN
    RAISE EXCEPTION 'Versao SPED substituida e imutavel.' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'FECHADA' THEN
    IF NEW.status <> 'SUBSTITUIDA'
       OR (to_jsonb(NEW) - ARRAY['status', 'substituted_at']::text[])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status', 'substituted_at']::text[]) THEN
      RAISE EXCEPTION 'Versao SPED fechada somente pode ser marcada como SUBSTITUIDA.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'RASCUNHO' AND NEW.status = 'VALIDADA')
    OR (OLD.status = 'VALIDADA' AND NEW.status IN ('RASCUNHO', 'FECHADA'))
  ) THEN
    RAISE EXCEPTION 'Transicao de versao SPED invalida: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_guardar_estado_competencia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    RAISE EXCEPTION 'Competencias SPED nao podem ser excluidas.' USING ERRCODE = '55000';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'ABERTA' AND NEW.status = 'EM_VALIDACAO')
    OR (OLD.status = 'EM_VALIDACAO' AND NEW.status IN ('ABERTA', 'COM_ERROS', 'APTA'))
    OR (OLD.status = 'COM_ERROS' AND NEW.status IN ('ABERTA', 'EM_VALIDACAO'))
    OR (OLD.status = 'APTA' AND NEW.status IN ('ABERTA', 'EM_VALIDACAO', 'FECHADA'))
    OR (OLD.status = 'FECHADA' AND NEW.status = 'ABERTA')
  ) THEN
    RAISE EXCEPTION 'Transicao de competencia SPED invalida: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_guardar_mutacao_competencia_aberta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_linha jsonb;
  v_competencia_id bigint;
  v_status text;
BEGIN
  v_linha := CASE WHEN tg_op = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  IF tg_table_name = 'fiscal_sped_1601_linha' THEN
    SELECT importacao.competencia_id
      INTO v_competencia_id
      FROM public.fiscal_sped_1601_importacao importacao
     WHERE importacao.id = (v_linha ->> 'importacao_id')::bigint;
  ELSE
    v_competencia_id := (v_linha ->> 'competencia_id')::bigint;
  END IF;

  SELECT status INTO v_status
    FROM public.fiscal_sped_competencia
   WHERE id = v_competencia_id;

  IF v_status = 'FECHADA' THEN
    RAISE EXCEPTION 'A competencia SPED fechada nao aceita alteracao de dados de entrada.'
      USING ERRCODE = '55000';
  END IF;

  IF tg_op = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_guardar_inventario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_linha jsonb;
  v_status text;
BEGIN
  v_linha := CASE WHEN tg_op = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  SELECT status INTO v_status
    FROM public.fiscal_inventario_fechamento
   WHERE id = (v_linha ->> 'inventario_id')::bigint;

  IF v_status IN ('APROVADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'Itens de inventario aprovado/cancelado sao imutaveis.'
      USING ERRCODE = '55000';
  END IF;

  IF tg_op = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_sped_config_touch
BEFORE UPDATE ON public.fiscal_sped_config
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();
CREATE TRIGGER fiscal_sped_contabilista_touch
BEFORE UPDATE ON public.fiscal_sped_contabilista
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();
CREATE TRIGGER fiscal_sped_item_config_touch
BEFORE UPDATE ON public.fiscal_sped_item_config
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();
CREATE TRIGGER fiscal_sped_item_credito_touch
BEFORE UPDATE ON public.fiscal_sped_item_credito_decisao
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();
CREATE TRIGGER fiscal_sped_item_correlacao_touch
BEFORE UPDATE ON public.fiscal_sped_item_correlacao
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();
CREATE TRIGGER fiscal_sped_unidade_conversao_touch
BEFORE UPDATE ON public.fiscal_sped_unidade_conversao
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();
CREATE TRIGGER fiscal_sped_competencia_touch
BEFORE UPDATE ON public.fiscal_sped_competencia
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();
CREATE TRIGGER fiscal_sped_ajuste_touch
BEFORE UPDATE ON public.fiscal_sped_ajuste_apuracao
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();
CREATE TRIGGER fiscal_inventario_touch
BEFORE UPDATE ON public.fiscal_inventario_fechamento
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_touch_updated_at();

CREATE TRIGGER fiscal_sped_competencia_estado_trg
BEFORE UPDATE OR DELETE ON public.fiscal_sped_competencia
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_estado_competencia();
CREATE TRIGGER fiscal_sped_versao_estado_trg
BEFORE UPDATE OR DELETE ON public.fiscal_sped_versao
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_versao();

CREATE TRIGGER fiscal_sped_documento_snapshot_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_sped_documento_snapshot
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_snapshot_rascunho();
CREATE TRIGGER fiscal_sped_item_snapshot_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_sped_item_snapshot
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_snapshot_rascunho();
CREATE TRIGGER fiscal_sped_cadastro_snapshot_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_sped_cadastro_snapshot
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_snapshot_rascunho();
CREATE TRIGGER fiscal_sped_apuracao_snapshot_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_sped_apuracao_snapshot
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_snapshot_rascunho();

CREATE TRIGGER fiscal_documento_evento_immutable_trg
BEFORE UPDATE OR DELETE ON public.fiscal_documento_evento
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_bloquear_registro_imutavel();
CREATE TRIGGER fiscal_sped_arquivo_immutable_trg
BEFORE UPDATE OR DELETE ON public.fiscal_sped_arquivo
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_bloquear_registro_imutavel();
CREATE TRIGGER fiscal_sped_pva_immutable_trg
BEFORE UPDATE OR DELETE ON public.fiscal_sped_arquivo_validacao_pva
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_bloquear_registro_imutavel();

CREATE TRIGGER fiscal_sped_ajuste_competencia_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_sped_ajuste_apuracao
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_mutacao_competencia_aberta();
CREATE TRIGGER fiscal_sped_efd_anterior_competencia_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_sped_efd_anterior_importacao
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_mutacao_competencia_aberta();
CREATE TRIGGER fiscal_sped_1601_importacao_competencia_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_sped_1601_importacao
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_mutacao_competencia_aberta();
CREATE TRIGGER fiscal_sped_1601_linha_competencia_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_sped_1601_linha
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_mutacao_competencia_aberta();
CREATE TRIGGER fiscal_inventario_item_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.fiscal_inventario_item
FOR EACH ROW EXECUTE FUNCTION public.fiscal_sped_guardar_inventario();

CREATE OR REPLACE FUNCTION public.fiscal_sped_criar_competencia(
  p_empresa_id integer,
  p_competencia date,
  p_usuario_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_lock_key integer;
BEGIN
  IF p_competencia IS NULL
     OR p_competencia <> date_trunc('month', p_competencia)::date THEN
    RAISE EXCEPTION 'Competencia deve ser o primeiro dia do mes.' USING ERRCODE = '22023';
  END IF;

  v_lock_key := extract(year FROM p_competencia)::integer * 100
    + extract(month FROM p_competencia)::integer;
  PERFORM pg_advisory_xact_lock(p_empresa_id, v_lock_key);

  INSERT INTO public.fiscal_sped_competencia(
    empresa_id, competencia, created_by, updated_by
  ) VALUES (
    p_empresa_id, p_competencia, p_usuario_id, p_usuario_id
  )
  ON CONFLICT (empresa_id, competencia) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.fiscal_sped_competencia
     WHERE empresa_id = p_empresa_id
       AND competencia = p_competencia;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_abrir_versao(
  p_competencia_id bigint,
  p_finalidade text,
  p_leiaute text,
  p_guia_pratico text,
  p_motor_versao text,
  p_git_commit text,
  p_source_cutoff_at timestamptz,
  p_context_hash text,
  p_usuario_id uuid,
  p_versao_anterior_id bigint DEFAULT NULL,
  p_motivo_abertura text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_competencia public.fiscal_sped_competencia%ROWTYPE;
  v_numero integer;
  v_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(2147480000, (p_competencia_id % 2147483647)::integer);
  SELECT * INTO v_competencia
    FROM public.fiscal_sped_competencia
   WHERE id = p_competencia_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competencia SPED inexistente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_competencia.status = 'FECHADA' THEN
    RAISE EXCEPTION 'Reabra a competencia antes de criar nova versao.' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_sped_versao
     WHERE competencia_id = p_competencia_id
       AND status IN ('RASCUNHO', 'VALIDADA')
  ) THEN
    RAISE EXCEPTION 'A competencia ja possui versao editavel.' USING ERRCODE = '23505';
  END IF;
  IF p_versao_anterior_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_sped_versao
     WHERE id = p_versao_anterior_id
       AND competencia_id = p_competencia_id
       AND status = 'FECHADA'
  ) THEN
    RAISE EXCEPTION 'Versao anterior invalida para a competencia.' USING ERRCODE = '23503';
  END IF;

  SELECT coalesce(max(numero), 0) + 1 INTO v_numero
    FROM public.fiscal_sped_versao
   WHERE competencia_id = p_competencia_id;

  INSERT INTO public.fiscal_sped_versao(
    competencia_id, numero, finalidade, versao_anterior_id, leiaute,
    guia_pratico, motor_versao, git_commit, source_cutoff_at,
    context_hash, motivo_abertura, created_by
  ) VALUES (
    p_competencia_id, v_numero, p_finalidade, p_versao_anterior_id,
    p_leiaute, p_guia_pratico, p_motor_versao, lower(p_git_commit),
    p_source_cutoff_at, lower(p_context_hash), p_motivo_abertura, p_usuario_id
  ) RETURNING id INTO v_id;

  UPDATE public.fiscal_sped_competencia
     SET versao_atual_id = v_id,
         status = 'ABERTA',
         updated_by = p_usuario_id,
         lock_version = lock_version + 1,
         fechada_at = NULL,
         fechada_by = NULL
   WHERE id = p_competencia_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_substituir_snapshots_documentais(
  p_versao_id bigint,
  p_documentos jsonb,
  p_cadastros jsonb,
  p_apuracoes jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_documento jsonb;
  v_item jsonb;
  v_cadastro jsonb;
  v_apuracao jsonb;
  v_documento_snapshot_id bigint;
BEGIN
  IF jsonb_typeof(p_documentos) <> 'array'
     OR jsonb_typeof(p_cadastros) <> 'array'
     OR jsonb_typeof(p_apuracoes) <> 'array' THEN
    RAISE EXCEPTION 'Snapshots documentais devem ser arrays JSON.' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_status
    FROM public.fiscal_sped_versao
   WHERE id = p_versao_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versao SPED inexistente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'RASCUNHO' THEN
    RAISE EXCEPTION 'Snapshots somente podem ser substituidos em versao RASCUNHO.'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.fiscal_sped_item_snapshot item
   USING public.fiscal_sped_documento_snapshot documento
   WHERE item.documento_snapshot_id = documento.id
     AND documento.versao_id = p_versao_id;
  DELETE FROM public.fiscal_sped_documento_snapshot WHERE versao_id = p_versao_id;
  DELETE FROM public.fiscal_sped_cadastro_snapshot
   WHERE versao_id = p_versao_id AND tipo <> 'CONFIG';
  DELETE FROM public.fiscal_sped_apuracao_snapshot WHERE versao_id = p_versao_id;

  FOR v_documento IN SELECT value FROM jsonb_array_elements(p_documentos)
  LOOP
    INSERT INTO public.fiscal_sped_documento_snapshot(
      versao_id, fonte_tipo, fonte_tabela, fonte_id, operacao, chave_acesso,
      modelo, codigo_situacao, data_emissao_civil, data_emissao_original,
      data_emissao_offset, data_emissao_instante_utc, data_escrituracao_civil,
      participante_codigo, participante_documento_tipo,
      participante_documento_canonico, participante_documento_original,
      xml_sha256, payload, source_refs
    ) VALUES (
      p_versao_id,
      v_documento->>'fonte_tipo',
      v_documento->>'fonte_tabela',
      v_documento->>'fonte_id',
      v_documento->>'operacao',
      v_documento->>'chave_acesso',
      v_documento->>'modelo',
      v_documento->>'codigo_situacao',
      (v_documento->>'data_emissao_civil')::date,
      nullif(v_documento->>'data_emissao_original', ''),
      nullif(v_documento->>'data_emissao_offset', ''),
      nullif(v_documento->>'data_emissao_instante_utc', '')::timestamptz,
      nullif(v_documento->>'data_escrituracao_civil', '')::date,
      nullif(v_documento->>'participante_codigo', ''),
      coalesce(nullif(v_documento->>'participante_documento_tipo', ''), 'SEM_DOCUMENTO'),
      nullif(v_documento->>'participante_documento_canonico', ''),
      nullif(v_documento->>'participante_documento_original', ''),
      v_documento->>'xml_sha256',
      coalesce(v_documento->'payload', '{}'::jsonb),
      coalesce(v_documento->'source_refs', '[]'::jsonb)
    ) RETURNING id INTO v_documento_snapshot_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_documento->'itens', '[]'::jsonb))
    LOOP
      INSERT INTO public.fiscal_sped_item_snapshot(
        documento_snapshot_id, numero_item, produto_id, item_config_id,
        codigo_item, unidade_documento, unidade_inventario,
        tratamento_credito, payload, source_refs
      ) VALUES (
        v_documento_snapshot_id,
        (v_item->>'numero_item')::integer,
        nullif(v_item->>'produto_id', '')::integer,
        nullif(v_item->>'item_config_id', '')::bigint,
        v_item->>'codigo_item',
        v_item->>'unidade_documento',
        nullif(v_item->>'unidade_inventario', ''),
        v_item->>'tratamento_credito',
        coalesce(v_item->'payload', '{}'::jsonb),
        coalesce(v_item->'source_refs', '[]'::jsonb)
      );
    END LOOP;
  END LOOP;

  FOR v_cadastro IN SELECT value FROM jsonb_array_elements(p_cadastros)
  LOOP
    INSERT INTO public.fiscal_sped_cadastro_snapshot(
      versao_id, tipo, codigo, documento_tipo, documento_canonico,
      documento_original, payload, source_refs, payload_sha256
    ) VALUES (
      p_versao_id,
      v_cadastro->>'tipo',
      v_cadastro->>'codigo',
      coalesce(nullif(v_cadastro->>'documento_tipo', ''), 'SEM_DOCUMENTO'),
      nullif(v_cadastro->>'documento_canonico', ''),
      nullif(v_cadastro->>'documento_original', ''),
      coalesce(v_cadastro->'payload', '{}'::jsonb),
      coalesce(v_cadastro->'source_refs', '[]'::jsonb),
      v_cadastro->>'payload_sha256'
    );
  END LOOP;

  FOR v_apuracao IN SELECT value FROM jsonb_array_elements(p_apuracoes)
  LOOP
    INSERT INTO public.fiscal_sped_apuracao_snapshot(
      versao_id, tipo, uf, periodo_inicio, periodo_fim, payload, payload_sha256
    ) VALUES (
      p_versao_id,
      v_apuracao->>'tipo',
      nullif(v_apuracao->>'uf', ''),
      (v_apuracao->>'periodo_inicio')::date,
      (v_apuracao->>'periodo_fim')::date,
      coalesce(v_apuracao->'payload', '{}'::jsonb),
      v_apuracao->>'payload_sha256'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_configurar_item_competencia(
  p_competencia_id bigint,
  p_produto_id integer,
  p_codigo_item text,
  p_tipo_item text,
  p_documento_id bigint,
  p_numero_item integer,
  p_tratamento_credito text,
  p_evidencia text,
  p_usuario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competencia public.fiscal_sped_competencia%ROWTYPE;
  v_config public.fiscal_sped_item_config%ROWTYPE;
  v_decisao public.fiscal_sped_item_credito_decisao%ROWTYPE;
  v_config_id bigint;
  v_decisao_id bigint;
BEGIN
  IF nullif(btrim(p_evidencia), '') IS NULL THEN
    RAISE EXCEPTION 'A evidencia da decisao fiscal e obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF p_produto_id IS NULL AND p_documento_id IS NULL THEN
    RAISE EXCEPTION 'Informe a configuracao do produto ou a decisao de credito.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_competencia
    FROM public.fiscal_sped_competencia
   WHERE id = p_competencia_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competencia SPED inexistente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_competencia.status = 'FECHADA' THEN
    RAISE EXCEPTION 'Competencia fechada nao aceita decisoes fiscais.' USING ERRCODE = '55000';
  END IF;

  IF p_produto_id IS NOT NULL THEN
    IF nullif(btrim(p_codigo_item), '') IS NULL OR p_tipo_item IS NULL OR p_tipo_item !~ '^[0-9]{2}$' THEN
      RAISE EXCEPTION 'Codigo canonico e tipo de item valido sao obrigatorios.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_config
      FROM public.fiscal_sped_item_config
     WHERE empresa_id = v_competencia.empresa_id
       AND produto_id = p_produto_id
       AND vigencia_inicio <= v_competencia.competencia
       AND (vigencia_fim IS NULL OR vigencia_fim >= v_competencia.competencia)
     ORDER BY vigencia_inicio DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND AND v_config.vigencia_inicio = v_competencia.competencia THEN
      UPDATE public.fiscal_sped_item_config
         SET codigo_item = btrim(p_codigo_item), tipo_item = p_tipo_item,
             fonte = 'CONFIGURACAO_MANUAL', evidencia = btrim(p_evidencia),
             updated_by = p_usuario_id
       WHERE id = v_config.id
      RETURNING id INTO v_config_id;
    ELSE
      IF FOUND THEN
        UPDATE public.fiscal_sped_item_config
           SET vigencia_fim = v_competencia.competencia - 1, updated_by = p_usuario_id
         WHERE id = v_config.id;
      END IF;
      INSERT INTO public.fiscal_sped_item_config(
        empresa_id, produto_id, codigo_item, tipo_item, vigencia_inicio,
        fonte, evidencia, created_by, updated_by
      ) VALUES (
        v_competencia.empresa_id, p_produto_id, btrim(p_codigo_item), p_tipo_item,
        v_competencia.competencia, 'CONFIGURACAO_MANUAL', btrim(p_evidencia),
        p_usuario_id, p_usuario_id
      ) RETURNING id INTO v_config_id;
    END IF;
  END IF;

  IF p_documento_id IS NOT NULL THEN
    IF p_numero_item IS NULL OR p_numero_item <= 0
       OR p_tratamento_credito IS NULL
       OR p_tratamento_credito NOT IN ('CREDITAVEL', 'SEM_CREDITO', 'USO_CONSUMO', 'ATIVO_IMOBILIZADO') THEN
      RAISE EXCEPTION 'Decisao de credito invalida.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.fiscal_dfe_documento
       WHERE id = p_documento_id AND empresa_id = v_competencia.empresa_id
    ) THEN
      RAISE EXCEPTION 'DFe nao pertence ao estabelecimento da competencia.' USING ERRCODE = '23503';
    END IF;
    SELECT * INTO v_decisao
      FROM public.fiscal_sped_item_credito_decisao
     WHERE documento_id = p_documento_id
       AND numero_item = p_numero_item
       AND vigencia_inicio <= v_competencia.competencia
       AND (vigencia_fim IS NULL OR vigencia_fim >= v_competencia.competencia)
     ORDER BY vigencia_inicio DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND AND v_decisao.vigencia_inicio = v_competencia.competencia THEN
      UPDATE public.fiscal_sped_item_credito_decisao
         SET tratamento_credito = p_tratamento_credito,
             evidencia = btrim(p_evidencia), updated_by = p_usuario_id
       WHERE id = v_decisao.id
      RETURNING id INTO v_decisao_id;
    ELSE
      IF FOUND THEN
        UPDATE public.fiscal_sped_item_credito_decisao
           SET vigencia_fim = v_competencia.competencia - 1, updated_by = p_usuario_id
         WHERE id = v_decisao.id;
      END IF;
      INSERT INTO public.fiscal_sped_item_credito_decisao(
        empresa_id, documento_id, numero_item, tratamento_credito, evidencia,
        vigencia_inicio, created_by, updated_by
      ) VALUES (
        v_competencia.empresa_id, p_documento_id, p_numero_item,
        p_tratamento_credito, btrim(p_evidencia), v_competencia.competencia,
        p_usuario_id, p_usuario_id
      ) RETURNING id INTO v_decisao_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('itemConfigId', v_config_id, 'creditDecisionId', v_decisao_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_iniciar_validacao(
  p_versao_id bigint,
  p_context_hash text,
  p_usuario_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_versao public.fiscal_sped_versao%ROWTYPE;
  v_execucao_id bigint;
BEGIN
  SELECT * INTO v_versao
    FROM public.fiscal_sped_versao
   WHERE id = p_versao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versao SPED inexistente.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(2147480000, (v_versao.competencia_id % 2147483647)::integer);
  SELECT * INTO v_versao
    FROM public.fiscal_sped_versao
   WHERE id = p_versao_id
   FOR UPDATE;
  IF v_versao.status NOT IN ('RASCUNHO', 'VALIDADA') THEN
    RAISE EXCEPTION 'Somente versao editavel pode ser validada.' USING ERRCODE = '55000';
  END IF;
  IF lower(p_context_hash) <> v_versao.context_hash THEN
    RAISE EXCEPTION 'Hash de contexto divergente.' USING ERRCODE = '40001';
  END IF;

  IF v_versao.status = 'VALIDADA' THEN
    UPDATE public.fiscal_sped_versao
       SET status = 'RASCUNHO', validated_at = NULL, validated_by = NULL
     WHERE id = p_versao_id;
  END IF;

  INSERT INTO public.fiscal_sped_validacao_execucao(
    competencia_id, versao_id, context_hash, iniciado_by
  ) VALUES (
    v_versao.competencia_id, p_versao_id, lower(p_context_hash), p_usuario_id
  ) RETURNING id INTO v_execucao_id;

  UPDATE public.fiscal_sped_competencia
     SET status = 'EM_VALIDACAO', updated_by = p_usuario_id,
         lock_version = lock_version + 1
   WHERE id = v_versao.competencia_id;

  RETURN v_execucao_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_concluir_validacao(
  p_execucao_id bigint,
  p_usuario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_execucao public.fiscal_sped_validacao_execucao%ROWTYPE;
  v_bloqueios integer;
  v_erros integer;
  v_avisos integer;
  v_informacoes integer;
  v_apta boolean;
BEGIN
  SELECT * INTO v_execucao
    FROM public.fiscal_sped_validacao_execucao
   WHERE id = p_execucao_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao de validacao inexistente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_execucao.status <> 'PROCESSANDO' OR v_execucao.versao_id IS NULL THEN
    RAISE EXCEPTION 'Execucao de validacao nao esta processando uma versao.' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(2147480000, (v_execucao.competencia_id % 2147483647)::integer);

  SELECT
    count(*) FILTER (WHERE severidade = 'BLOQUEIO'),
    count(*) FILTER (WHERE severidade = 'ERRO'),
    count(*) FILTER (WHERE severidade = 'AVISO' AND status = 'ABERTA'),
    count(*) FILTER (WHERE severidade = 'INFORMACAO' AND status = 'ABERTA')
  INTO v_bloqueios, v_erros, v_avisos, v_informacoes
  FROM public.fiscal_sped_inconsistencia
  WHERE execucao_id = p_execucao_id;

  v_apta := v_bloqueios = 0 AND v_erros = 0;

  UPDATE public.fiscal_sped_validacao_execucao
     SET status = 'CONCLUIDA', concluido_at = now(),
         quantidade_bloqueios = v_bloqueios,
         quantidade_erros = v_erros,
         quantidade_avisos = v_avisos,
         quantidade_informacoes = v_informacoes
   WHERE id = p_execucao_id;

  IF v_apta THEN
    UPDATE public.fiscal_sped_versao
       SET status = 'VALIDADA', validated_at = now(), validated_by = p_usuario_id
     WHERE id = v_execucao.versao_id AND status = 'RASCUNHO';
  END IF;

  UPDATE public.fiscal_sped_competencia
     SET status = CASE WHEN v_apta THEN 'APTA' ELSE 'COM_ERROS' END,
         updated_by = p_usuario_id,
         lock_version = lock_version + 1
   WHERE id = v_execucao.competencia_id;

  RETURN jsonb_build_object(
    'apta', v_apta,
    'bloqueios', v_bloqueios,
    'erros', v_erros,
    'avisos', v_avisos,
    'informacoes', v_informacoes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_fechar_versao(
  p_competencia_id bigint,
  p_versao_id bigint,
  p_expected_lock_version integer,
  p_context_hash text,
  p_usuario_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_competencia public.fiscal_sped_competencia%ROWTYPE;
  v_versao public.fiscal_sped_versao%ROWTYPE;
  v_config public.fiscal_sped_config%ROWTYPE;
  v_novo_lock integer;
BEGIN
  PERFORM pg_advisory_xact_lock(2147480000, (p_competencia_id % 2147483647)::integer);
  SELECT * INTO v_competencia
    FROM public.fiscal_sped_competencia
   WHERE id = p_competencia_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competencia SPED inexistente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_competencia.lock_version <> p_expected_lock_version THEN
    RAISE EXCEPTION 'Competencia alterada por outro processo.' USING ERRCODE = '40001';
  END IF;
  IF v_competencia.status <> 'APTA' OR v_competencia.versao_atual_id <> p_versao_id THEN
    RAISE EXCEPTION 'Competencia nao esta apta com a versao informada.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_versao
    FROM public.fiscal_sped_versao
   WHERE id = p_versao_id AND competencia_id = p_competencia_id
   FOR UPDATE;
  IF NOT FOUND OR v_versao.status <> 'VALIDADA' THEN
    RAISE EXCEPTION 'Versao SPED nao esta validada.' USING ERRCODE = '55000';
  END IF;
  IF lower(p_context_hash) <> v_versao.context_hash THEN
    RAISE EXCEPTION 'Hash de contexto divergente.' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_config
    FROM public.fiscal_sped_config
   WHERE empresa_id = v_competencia.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuracao SPED ausente.' USING ERRCODE = '23514';
  END IF;
  IF v_config.timezone_status <> 'CONFIRMADO'
     OR v_config.perfil_efd_status <> 'CONFIRMADO'
     OR v_config.indicador_atividade_status <> 'CONFIRMADO'
     OR v_config.bloco_k_status = 'PENDENTE'
     OR v_config.registro_1400_status = 'PENDENTE'
     OR v_config.c176_c179_status = 'PENDENTE'
     OR v_config.registro_1601_status = 'PENDENTE'
     OR v_config.inventario_status = 'PENDENTE'
     OR v_config.contribuinte_ipi_status = 'PENDENTE'
     OR v_config.entrega_efd_contribuicoes_status = 'PENDENTE' THEN
    RAISE EXCEPTION 'Existem gates fiscais pendentes na configuracao SPED.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.fiscal_sped_validacao_execucao execucao
     WHERE execucao.versao_id = p_versao_id
       AND execucao.status = 'CONCLUIDA'
       AND execucao.context_hash = v_versao.context_hash
       AND execucao.quantidade_bloqueios = 0
       AND execucao.quantidade_erros = 0
  ) THEN
    RAISE EXCEPTION 'Versao sem validacao concluida e livre de erros.' USING ERRCODE = '23514';
  END IF;

  IF v_versao.versao_anterior_id IS NOT NULL THEN
    UPDATE public.fiscal_sped_versao
       SET status = 'SUBSTITUIDA', substituted_at = now()
     WHERE id = v_versao.versao_anterior_id
       AND status = 'FECHADA';
  END IF;

  UPDATE public.fiscal_sped_versao
     SET status = 'FECHADA', closed_at = now(), closed_by = p_usuario_id
   WHERE id = p_versao_id;

  UPDATE public.fiscal_sped_competencia
     SET status = 'FECHADA', fechada_at = now(), fechada_by = p_usuario_id,
         updated_by = p_usuario_id, lock_version = lock_version + 1
   WHERE id = p_competencia_id
  RETURNING lock_version INTO v_novo_lock;

  RETURN v_novo_lock;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_sped_reabrir_competencia(
  p_competencia_id bigint,
  p_expected_lock_version integer,
  p_usuario_id uuid,
  p_motivo text,
  p_leiaute text,
  p_guia_pratico text,
  p_motor_versao text,
  p_git_commit text,
  p_source_cutoff_at timestamptz,
  p_context_hash text
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_competencia public.fiscal_sped_competencia%ROWTYPE;
  v_numero integer;
  v_nova_versao_id bigint;
BEGIN
  IF nullif(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Motivo da reabertura e obrigatorio.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(2147480000, (p_competencia_id % 2147483647)::integer);
  SELECT * INTO v_competencia
    FROM public.fiscal_sped_competencia
   WHERE id = p_competencia_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competencia SPED inexistente.' USING ERRCODE = 'P0002';
  END IF;
  IF v_competencia.status <> 'FECHADA' OR v_competencia.versao_atual_id IS NULL THEN
    RAISE EXCEPTION 'Somente competencia fechada pode ser reaberta.' USING ERRCODE = '55000';
  END IF;
  IF v_competencia.lock_version <> p_expected_lock_version THEN
    RAISE EXCEPTION 'Competencia alterada por outro processo.' USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(max(numero), 0) + 1 INTO v_numero
    FROM public.fiscal_sped_versao
   WHERE competencia_id = p_competencia_id;

  INSERT INTO public.fiscal_sped_versao(
    competencia_id, numero, finalidade, versao_anterior_id, leiaute,
    guia_pratico, motor_versao, git_commit, source_cutoff_at,
    context_hash, motivo_abertura, created_by
  ) VALUES (
    p_competencia_id, v_numero, 'RETIFICADORA', v_competencia.versao_atual_id,
    p_leiaute, p_guia_pratico, p_motor_versao, lower(p_git_commit),
    p_source_cutoff_at, lower(p_context_hash), btrim(p_motivo), p_usuario_id
  ) RETURNING id INTO v_nova_versao_id;

  UPDATE public.fiscal_sped_competencia
     SET status = 'ABERTA', versao_atual_id = v_nova_versao_id,
         fechada_at = NULL, fechada_by = NULL,
         updated_by = p_usuario_id, lock_version = lock_version + 1
   WHERE id = p_competencia_id;

  RETURN v_nova_versao_id;
END;
$$;

-- Auditoria nas entidades operacionais. Snapshots e artefatos já são
-- imutáveis e carregam source_refs/hash, evitando duplicar XML/payload no log.
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_config'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_contabilista'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_item_config'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_item_credito_decisao'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_item_correlacao'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_unidade_conversao'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_competencia'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_versao'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_ajuste_apuracao'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_efd_anterior_importacao'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_sped_1601_importacao'::regclass);
SELECT public.habilitar_auditoria_tabela('public.fiscal_inventario_fechamento'::regclass);

DO $$
DECLARE
  v_table regclass;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.fiscal_documento_evento'::regclass,
    'public.fiscal_sped_config'::regclass,
    'public.fiscal_sped_contabilista'::regclass,
    'public.fiscal_sped_item_config'::regclass,
    'public.fiscal_sped_item_credito_decisao'::regclass,
    'public.fiscal_sped_item_correlacao'::regclass,
    'public.fiscal_sped_unidade_conversao'::regclass,
    'public.fiscal_sped_competencia'::regclass,
    'public.fiscal_sped_versao'::regclass,
    'public.fiscal_sped_validacao_execucao'::regclass,
    'public.fiscal_sped_inconsistencia'::regclass,
    'public.fiscal_sped_documento_snapshot'::regclass,
    'public.fiscal_sped_item_snapshot'::regclass,
    'public.fiscal_sped_cadastro_snapshot'::regclass,
    'public.fiscal_sped_apuracao_snapshot'::regclass,
    'public.fiscal_sped_ajuste_apuracao'::regclass,
    'public.fiscal_sped_efd_anterior_importacao'::regclass,
    'public.fiscal_sped_1601_importacao'::regclass,
    'public.fiscal_sped_1601_linha'::regclass,
    'public.fiscal_sped_arquivo'::regclass,
    'public.fiscal_sped_arquivo_validacao_pva'::regclass,
    'public.fiscal_inventario_fechamento'::regclass,
    'public.fiscal_inventario_item'::regclass
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE %s TO service_role', v_table);
  END LOOP;
END
$$;

REVOKE ALL ON SEQUENCE
  public.fiscal_documento_evento_id_seq,
  public.fiscal_sped_contabilista_id_seq,
  public.fiscal_sped_item_config_id_seq,
  public.fiscal_sped_item_credito_decisao_id_seq,
  public.fiscal_sped_item_correlacao_id_seq,
  public.fiscal_sped_unidade_conversao_id_seq,
  public.fiscal_sped_competencia_id_seq,
  public.fiscal_sped_versao_id_seq,
  public.fiscal_sped_validacao_execucao_id_seq,
  public.fiscal_sped_inconsistencia_id_seq,
  public.fiscal_sped_documento_snapshot_id_seq,
  public.fiscal_sped_item_snapshot_id_seq,
  public.fiscal_sped_cadastro_snapshot_id_seq,
  public.fiscal_sped_apuracao_snapshot_id_seq,
  public.fiscal_sped_ajuste_apuracao_id_seq,
  public.fiscal_sped_efd_anterior_importacao_id_seq,
  public.fiscal_sped_1601_importacao_id_seq,
  public.fiscal_sped_1601_linha_id_seq,
  public.fiscal_sped_arquivo_id_seq,
  public.fiscal_sped_arquivo_validacao_pva_id_seq,
  public.fiscal_inventario_fechamento_id_seq,
  public.fiscal_inventario_item_id_seq
FROM PUBLIC, anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.fiscal_documento_evento_id_seq,
  public.fiscal_sped_contabilista_id_seq,
  public.fiscal_sped_item_config_id_seq,
  public.fiscal_sped_item_credito_decisao_id_seq,
  public.fiscal_sped_item_correlacao_id_seq,
  public.fiscal_sped_unidade_conversao_id_seq,
  public.fiscal_sped_competencia_id_seq,
  public.fiscal_sped_versao_id_seq,
  public.fiscal_sped_validacao_execucao_id_seq,
  public.fiscal_sped_inconsistencia_id_seq,
  public.fiscal_sped_documento_snapshot_id_seq,
  public.fiscal_sped_item_snapshot_id_seq,
  public.fiscal_sped_cadastro_snapshot_id_seq,
  public.fiscal_sped_apuracao_snapshot_id_seq,
  public.fiscal_sped_ajuste_apuracao_id_seq,
  public.fiscal_sped_efd_anterior_importacao_id_seq,
  public.fiscal_sped_1601_importacao_id_seq,
  public.fiscal_sped_1601_linha_id_seq,
  public.fiscal_sped_arquivo_id_seq,
  public.fiscal_sped_arquivo_validacao_pva_id_seq,
  public.fiscal_inventario_fechamento_id_seq,
  public.fiscal_inventario_item_id_seq
TO service_role;

REVOKE ALL ON FUNCTION public.fiscal_sped_touch_updated_at()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_bloquear_registro_imutavel()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_guardar_snapshot_rascunho()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_guardar_versao()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_guardar_estado_competencia()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_guardar_mutacao_competencia_aberta()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_guardar_inventario()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_criar_competencia(integer, date, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_abrir_versao(bigint, text, text, text, text, text, timestamptz, text, uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_substituir_snapshots_documentais(bigint, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_configurar_item_competencia(bigint, integer, text, text, bigint, integer, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_iniciar_validacao(bigint, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_concluir_validacao(bigint, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_fechar_versao(bigint, bigint, integer, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_sped_reabrir_competencia(bigint, integer, uuid, text, text, text, text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fiscal_sped_criar_competencia(integer, date, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_bloquear_registro_imutavel() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_guardar_snapshot_rascunho() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_guardar_versao() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_guardar_estado_competencia() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_guardar_mutacao_competencia_aberta() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_guardar_inventario() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_abrir_versao(bigint, text, text, text, text, text, timestamptz, text, uuid, bigint, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_substituir_snapshots_documentais(bigint, jsonb, jsonb, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_configurar_item_competencia(bigint, integer, text, text, bigint, integer, text, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_iniciar_validacao(bigint, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_concluir_validacao(bigint, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_fechar_versao(bigint, bigint, integer, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_sped_reabrir_competencia(bigint, integer, uuid, text, text, text, text, text, timestamptz, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
