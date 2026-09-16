BEGIN;

-- 20260909120000 possui nomes diferentes no repositório e no histórico remoto.
-- A versão remota executou a transferência de comissão, também aplicada em
-- 20260909125000, mas não criou este índice. Não se reescreve uma migration
-- aplicada: esta correção aditiva materializa, de forma idempotente, o efeito
-- local que faltou no banco remoto.
UPDATE public.mercadolivre_sync_run
   SET status = 'ERRO',
       error = coalesce(error, 'Execução antiga encerrada durante a reconciliação do agendador.'),
       completed_at = coalesce(completed_at, now())
 WHERE status = 'PROCESSANDO';

CREATE UNIQUE INDEX IF NOT EXISTS mercadolivre_sync_run_one_active_job_idx
  ON public.mercadolivre_sync_run(job_name)
  WHERE status = 'PROCESSANDO';

COMMENT ON INDEX public.mercadolivre_sync_run_one_active_job_idx IS
  'Impede duas execuções simultâneas da mesma etapa de sincronização Mercado Livre. Reconciliado de forma aditiva após a colisão da migration 20260909120000.';

-- Remove somente os separadores aceitos em uma representação de CNPJ.
-- Diferentemente de regexp_replace(..., '\D', ...), preserva letras.
CREATE OR REPLACE FUNCTION public.fiscal_cnpj_normalizar(p_valor text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_valor IS NULL THEN NULL
    ELSE upper(regexp_replace(btrim(p_valor), '[./[:space:]-]', '', 'g'))
  END
$$;

CREATE OR REPLACE FUNCTION public.fiscal_cnpj_valido(p_valor text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_cnpj text := public.fiscal_cnpj_normalizar(p_valor);
  v_pesos_primeiro integer[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  v_pesos_segundo integer[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  v_soma integer := 0;
  v_resto integer;
  v_dv1 integer;
  v_dv2 integer;
  v_indice integer;
BEGIN
  IF v_cnpj IS NULL OR v_cnpj !~ '^[A-Z0-9]{12}[0-9]{2}$' THEN
    RETURN false;
  END IF;

  -- Rejeita bases triviais repetidas, inclusive a forma numérica
  -- 00000000000000, em paridade com o validador TypeScript.
  IF substr(v_cnpj, 1, 12) = repeat(substr(v_cnpj, 1, 1), 12) THEN
    RETURN false;
  END IF;

  FOR v_indice IN 1..12 LOOP
    v_soma := v_soma
      + (ascii(substr(v_cnpj, v_indice, 1)) - 48) * v_pesos_primeiro[v_indice];
  END LOOP;
  v_resto := mod(v_soma, 11);
  v_dv1 := CASE WHEN v_resto < 2 THEN 0 ELSE 11 - v_resto END;

  v_soma := 0;
  FOR v_indice IN 1..12 LOOP
    v_soma := v_soma
      + (ascii(substr(v_cnpj, v_indice, 1)) - 48) * v_pesos_segundo[v_indice];
  END LOOP;
  v_soma := v_soma + v_dv1 * v_pesos_segundo[13];
  v_resto := mod(v_soma, 11);
  v_dv2 := CASE WHEN v_resto < 2 THEN 0 ELSE 11 - v_resto END;

  RETURN substr(v_cnpj, 13, 1)::integer = v_dv1
     AND substr(v_cnpj, 14, 1)::integer = v_dv2;
END;
$$;

COMMENT ON FUNCTION public.fiscal_cnpj_normalizar(text) IS
  'Normaliza CNPJ numérico ou alfanumérico para 14 caracteres uppercase, removendo somente pontuação e espaços conhecidos.';
COMMENT ON FUNCTION public.fiscal_cnpj_valido(text) IS
  'Valida CNPJ numérico ou alfanumérico pelo módulo 11 oficial (valor ASCII menos 48).';

ALTER TABLE public.fiscal_dfe_contexto
  DROP CONSTRAINT IF EXISTS fiscal_dfe_contexto_cnpj_check;
ALTER TABLE public.fiscal_dfe_contexto
  ADD CONSTRAINT fiscal_dfe_contexto_cnpj_check
  CHECK (cnpj = public.fiscal_cnpj_normalizar(cnpj) AND public.fiscal_cnpj_valido(cnpj));

ALTER TABLE public.fiscal_dfe_controle
  DROP CONSTRAINT IF EXISTS fiscal_dfe_controle_cnpj_consultado_check;
ALTER TABLE public.fiscal_dfe_controle
  ADD CONSTRAINT fiscal_dfe_controle_cnpj_consultado_check
  CHECK (
    cnpj_consultado IS NULL
    OR (
      cnpj_consultado = public.fiscal_cnpj_normalizar(cnpj_consultado)
      AND public.fiscal_cnpj_valido(cnpj_consultado)
    )
  ) NOT VALID;

ALTER TABLE public.empresa
  DROP CONSTRAINT IF EXISTS empresa_cnpj_formato_chk;
ALTER TABLE public.empresa
  ADD CONSTRAINT empresa_cnpj_formato_chk
  CHECK (
    cnpj::text = public.fiscal_cnpj_normalizar(cnpj::text)
    AND public.fiscal_cnpj_valido(cnpj::text)
  ) NOT VALID;

ALTER TABLE public.fiscal_dfe_documento
  DROP CONSTRAINT IF EXISTS fiscal_dfe_documento_emitente_cnpj_check;
ALTER TABLE public.fiscal_dfe_documento
  ADD CONSTRAINT fiscal_dfe_documento_emitente_cnpj_check
  CHECK (
    emitente_cnpj IS NULL
    OR nullif(btrim(emitente_cnpj), '') IS NULL
    -- Registros anteriores a esta adequação incluem zeros à esquerda já
    -- perdidos pelo parser antigo. Eles permanecem legíveis e atualizáveis,
    -- mas nunca devem ser usados como participante canônico do SPED.
    OR createdat < timestamptz '2026-09-16 05:40:31+00'
    OR (
      emitente_cnpj = public.fiscal_cnpj_normalizar(emitente_cnpj)
      AND public.fiscal_cnpj_valido(emitente_cnpj)
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.fiscal_guardar_contexto_dfe_ativo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cnpj text := public.fiscal_cnpj_normalizar(NEW.cnpj_consultado);
  v_ambiente text := upper(btrim(coalesce(NEW.ambiente_consultado, '')));
BEGIN
  IF NOT public.fiscal_cnpj_valido(v_cnpj)
     OR v_ambiente NOT IN ('HOMOLOGACAO', 'PRODUCAO') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.fiscal_dfe_contexto (
    empresa_id, cnpj, ambiente, ult_nsu, max_nsu, last_sync_at,
    last_cstat, last_xmotivo, next_sync_after, consumo_indevido_until,
    sync_started_at, consulta_chave_window_started_at,
    consulta_chave_count, updatedat
  ) VALUES (
    NEW.empresa_id, v_cnpj, v_ambiente,
    coalesce(NEW.ult_nsu, '000000000000000'),
    coalesce(NEW.max_nsu, '000000000000000'),
    NEW.last_sync_at, NEW.last_cstat, NEW.last_xmotivo,
    NEW.next_sync_after, NEW.consumo_indevido_until, NEW.sync_started_at,
    NEW.consulta_chave_window_started_at,
    coalesce(NEW.consulta_chave_count, 0), now()
  )
  ON CONFLICT (empresa_id, cnpj, ambiente)
  DO UPDATE SET
    ult_nsu = EXCLUDED.ult_nsu,
    max_nsu = EXCLUDED.max_nsu,
    last_sync_at = EXCLUDED.last_sync_at,
    last_cstat = EXCLUDED.last_cstat,
    last_xmotivo = EXCLUDED.last_xmotivo,
    next_sync_after = EXCLUDED.next_sync_after,
    consumo_indevido_until = EXCLUDED.consumo_indevido_until,
    sync_started_at = EXCLUDED.sync_started_at,
    consulta_chave_window_started_at = EXCLUDED.consulta_chave_window_started_at,
    consulta_chave_count = EXCLUDED.consulta_chave_count,
    updatedat = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_ativar_contexto_dfe(
  p_empresa_id integer,
  p_cnpj text,
  p_ambiente text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cnpj text := public.fiscal_cnpj_normalizar(p_cnpj);
  v_ambiente text := upper(btrim(coalesce(p_ambiente, '')));
  v_contexto public.fiscal_dfe_contexto%ROWTYPE;
  v_restaurado boolean := false;
BEGIN
  IF NOT public.fiscal_cnpj_valido(v_cnpj) THEN
    RAISE EXCEPTION 'CNPJ invalido para ativacao do contexto DF-e.' USING ERRCODE = '22023';
  END IF;

  IF v_ambiente NOT IN ('HOMOLOGACAO', 'PRODUCAO') THEN
    RAISE EXCEPTION 'Ambiente fiscal invalido para ativacao do contexto DF-e.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.fiscal_dfe_controle (empresa_id, updatedat)
  VALUES (p_empresa_id, now())
  ON CONFLICT (empresa_id) DO NOTHING;

  PERFORM 1
    FROM public.fiscal_dfe_controle
   WHERE empresa_id = p_empresa_id
   FOR UPDATE;

  SELECT * INTO v_contexto
    FROM public.fiscal_dfe_contexto
   WHERE empresa_id = p_empresa_id
     AND cnpj = v_cnpj
     AND ambiente = v_ambiente;
  v_restaurado := FOUND;

  DELETE FROM public.fiscal_dfe_documento
   WHERE empresa_id = p_empresa_id;

  UPDATE public.fiscal_dfe_controle
     SET cnpj_consultado = v_cnpj,
         ambiente_consultado = v_ambiente,
         ult_nsu = CASE WHEN v_restaurado THEN v_contexto.ult_nsu ELSE '000000000000000' END,
         max_nsu = CASE WHEN v_restaurado THEN v_contexto.max_nsu ELSE '000000000000000' END,
         last_sync_at = CASE WHEN v_restaurado THEN v_contexto.last_sync_at ELSE NULL END,
         last_cstat = CASE WHEN v_restaurado THEN v_contexto.last_cstat ELSE NULL END,
         last_xmotivo = CASE WHEN v_restaurado THEN v_contexto.last_xmotivo ELSE NULL END,
         next_sync_after = CASE WHEN v_restaurado THEN v_contexto.next_sync_after ELSE NULL END,
         consumo_indevido_until = CASE WHEN v_restaurado THEN v_contexto.consumo_indevido_until ELSE NULL END,
         sync_lock_until = NULL,
         sync_started_at = CASE WHEN v_restaurado THEN v_contexto.sync_started_at ELSE NULL END,
         consulta_chave_window_started_at = CASE
           WHEN v_restaurado THEN v_contexto.consulta_chave_window_started_at ELSE NULL
         END,
         consulta_chave_count = CASE WHEN v_restaurado THEN v_contexto.consulta_chave_count ELSE 0 END,
         updatedat = now()
   WHERE empresa_id = p_empresa_id;

  RETURN jsonb_build_object(
    'restaurado', v_restaurado,
    'cnpj', v_cnpj,
    'ambiente', v_ambiente,
    'ultNSU', CASE WHEN v_restaurado THEN v_contexto.ult_nsu ELSE '000000000000000' END,
    'maxNSU', CASE WHEN v_restaurado THEN v_contexto.max_nsu ELSE '000000000000000' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fiscal_cnpj_normalizar(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_cnpj_valido(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_guardar_contexto_dfe_ativo()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_ativar_contexto_dfe(integer, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fiscal_cnpj_normalizar(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_cnpj_valido(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_guardar_contexto_dfe_ativo() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_ativar_contexto_dfe(integer, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
