ALTER TABLE public.fiscal_dfe_controle
  ADD COLUMN IF NOT EXISTS ambiente_consultado text,
  ADD COLUMN IF NOT EXISTS consulta_chave_window_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS consulta_chave_count integer NOT NULL DEFAULT 0;

UPDATE public.fiscal_dfe_controle AS controle
SET ambiente_consultado = CASE
      WHEN upper(coalesce(empresa.ambiente::text, '')) = 'PRODUCAO' THEN 'PRODUCAO'
      ELSE 'HOMOLOGACAO'
    END,
    updatedat = now()
FROM public.empresa AS empresa
WHERE empresa.id = controle.empresa_id
  AND nullif(btrim(controle.ambiente_consultado), '') IS NULL;

CREATE TABLE IF NOT EXISTS public.fiscal_dfe_contexto (
  empresa_id integer NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  cnpj text NOT NULL,
  ambiente text NOT NULL,
  ult_nsu text NOT NULL DEFAULT '000000000000000',
  max_nsu text NOT NULL DEFAULT '000000000000000',
  last_sync_at timestamp with time zone,
  last_cstat text,
  last_xmotivo text,
  next_sync_after timestamp with time zone,
  consumo_indevido_until timestamp with time zone,
  sync_started_at timestamp with time zone,
  consulta_chave_window_started_at timestamp with time zone,
  consulta_chave_count integer NOT NULL DEFAULT 0,
  createdat timestamp with time zone NOT NULL DEFAULT now(),
  updatedat timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_dfe_contexto_pkey PRIMARY KEY (empresa_id, cnpj, ambiente),
  CONSTRAINT fiscal_dfe_contexto_cnpj_check CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT fiscal_dfe_contexto_ambiente_check CHECK (ambiente IN ('HOMOLOGACAO', 'PRODUCAO'))
);

CREATE OR REPLACE FUNCTION public.fiscal_guardar_contexto_dfe_ativo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cnpj text := regexp_replace(coalesce(NEW.cnpj_consultado, ''), '\D', '', 'g');
  v_ambiente text := upper(btrim(coalesce(NEW.ambiente_consultado, '')));
BEGIN
  IF length(v_cnpj) <> 14 OR v_ambiente NOT IN ('HOMOLOGACAO', 'PRODUCAO') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.fiscal_dfe_contexto (
    empresa_id,
    cnpj,
    ambiente,
    ult_nsu,
    max_nsu,
    last_sync_at,
    last_cstat,
    last_xmotivo,
    next_sync_after,
    consumo_indevido_until,
    sync_started_at,
    consulta_chave_window_started_at,
    consulta_chave_count,
    updatedat
  )
  VALUES (
    NEW.empresa_id,
    v_cnpj,
    v_ambiente,
    coalesce(NEW.ult_nsu, '000000000000000'),
    coalesce(NEW.max_nsu, '000000000000000'),
    NEW.last_sync_at,
    NEW.last_cstat,
    NEW.last_xmotivo,
    NEW.next_sync_after,
    NEW.consumo_indevido_until,
    NEW.sync_started_at,
    NEW.consulta_chave_window_started_at,
    coalesce(NEW.consulta_chave_count, 0),
    now()
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

DROP TRIGGER IF EXISTS trg_fiscal_guardar_contexto_dfe_ativo
  ON public.fiscal_dfe_controle;

CREATE TRIGGER trg_fiscal_guardar_contexto_dfe_ativo
AFTER INSERT OR UPDATE ON public.fiscal_dfe_controle
FOR EACH ROW
EXECUTE FUNCTION public.fiscal_guardar_contexto_dfe_ativo();

INSERT INTO public.fiscal_dfe_contexto (
  empresa_id,
  cnpj,
  ambiente,
  ult_nsu,
  max_nsu,
  last_sync_at,
  last_cstat,
  last_xmotivo,
  next_sync_after,
  consumo_indevido_until,
  sync_started_at,
  consulta_chave_window_started_at,
  consulta_chave_count,
  updatedat
)
SELECT
  empresa_id,
  regexp_replace(cnpj_consultado, '\D', '', 'g'),
  ambiente_consultado,
  ult_nsu,
  max_nsu,
  last_sync_at,
  last_cstat,
  last_xmotivo,
  next_sync_after,
  consumo_indevido_until,
  sync_started_at,
  consulta_chave_window_started_at,
  consulta_chave_count,
  now()
FROM public.fiscal_dfe_controle
WHERE length(regexp_replace(coalesce(cnpj_consultado, ''), '\D', '', 'g')) = 14
  AND ambiente_consultado IN ('HOMOLOGACAO', 'PRODUCAO')
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

CREATE OR REPLACE FUNCTION public.fiscal_ativar_contexto_dfe(
  p_empresa_id integer,
  p_cnpj text,
  p_ambiente text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_ambiente text := upper(btrim(coalesce(p_ambiente, '')));
  v_contexto public.fiscal_dfe_contexto%ROWTYPE;
  v_restaurado boolean := false;
BEGIN
  IF length(v_cnpj) <> 14 THEN
    RAISE EXCEPTION 'CNPJ invalido para ativacao do contexto DF-e.';
  END IF;

  IF v_ambiente NOT IN ('HOMOLOGACAO', 'PRODUCAO') THEN
    RAISE EXCEPTION 'Ambiente fiscal invalido para ativacao do contexto DF-e.';
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

  -- Os documentos pertencem ao contexto que estava ativo. Eles nao podem
  -- aparecer para outro CNPJ/ambiente usando o mesmo empresa_id.
  DELETE FROM public.fiscal_dfe_documento
  WHERE empresa_id = p_empresa_id;

  UPDATE public.fiscal_dfe_controle
  SET
    cnpj_consultado = v_cnpj,
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

CREATE OR REPLACE FUNCTION public.fiscal_reservar_consulta_chave_dfe(
  p_empresa_id integer,
  p_limite integer DEFAULT 15,
  p_janela interval DEFAULT interval '70 minutes'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_controle public.fiscal_dfe_controle%ROWTYPE;
  v_inicio timestamp with time zone;
  v_contagem integer;
  v_proxima_tentativa timestamp with time zone;
BEGIN
  SELECT * INTO v_controle
  FROM public.fiscal_dfe_controle
  WHERE empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'CONTROLE_AUSENTE');
  END IF;

  IF v_controle.consumo_indevido_until IS NOT NULL
     AND v_controle.consumo_indevido_until > now() THEN
    RETURN jsonb_build_object(
      'permitido', false,
      'motivo', 'CONSUMO_INDEVIDO',
      'proximaTentativa', v_controle.consumo_indevido_until
    );
  END IF;

  v_inicio := v_controle.consulta_chave_window_started_at;
  v_contagem := coalesce(v_controle.consulta_chave_count, 0);

  IF v_inicio IS NULL OR v_inicio + p_janela <= now() THEN
    v_inicio := now();
    v_contagem := 0;
  END IF;

  IF v_contagem >= greatest(1, p_limite) THEN
    v_proxima_tentativa := v_inicio + p_janela;
    RETURN jsonb_build_object(
      'permitido', false,
      'motivo', 'LIMITE_LOCAL',
      'proximaTentativa', v_proxima_tentativa
    );
  END IF;

  UPDATE public.fiscal_dfe_controle
  SET
    consulta_chave_window_started_at = v_inicio,
    consulta_chave_count = v_contagem + 1,
    updatedat = now()
  WHERE empresa_id = p_empresa_id;

  RETURN jsonb_build_object(
    'permitido', true,
    'consultasNaJanela', v_contagem + 1,
    'limite', greatest(1, p_limite),
    'janelaIniciadaEm', v_inicio
  );
END;
$$;

GRANT ALL ON TABLE public.fiscal_dfe_contexto TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_ativar_contexto_dfe(integer, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_reservar_consulta_chave_dfe(integer, integer, interval)
  TO service_role;
