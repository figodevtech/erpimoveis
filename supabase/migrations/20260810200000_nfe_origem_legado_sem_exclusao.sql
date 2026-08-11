-- A migration 20260810120000 foi aplicada primeiro na Demonstração com índices
-- únicos. Nos bancos com histórico fiscal legado, esses índices não podiam ser
-- criados sem excluir ou cancelar notas já transmitidas. Este alinhamento troca a
-- unicidade retroativa pela mesma guarda transacional usada nos novos bancos:
-- preserva o passado e impede novas duplicidades, inclusive sob concorrência.
BEGIN;

DROP INDEX IF EXISTS public.nfe_origem_venda_modelo_transmitida_idx;
DROP INDEX IF EXISTS public.nfe_origem_os_modelo_transmitida_idx;

CREATE INDEX nfe_origem_venda_modelo_transmitida_idx
  ON public.nfe (vendaid, modelo)
  WHERE vendaid IS NOT NULL
    AND is_deleted = false
    AND status IN ('ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO', 'CONTINGENCIA', 'RESULTADO_INCERTO');

CREATE INDEX nfe_origem_os_modelo_transmitida_idx
  ON public.nfe (ordemservicoid, modelo)
  WHERE ordemservicoid IS NOT NULL
    AND is_deleted = false
    AND status IN ('ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO', 'CONTINGENCIA', 'RESULTADO_INCERTO');

CREATE OR REPLACE FUNCTION public.nfe_impedir_origem_transmitida_duplicada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status_ocupa boolean;
  v_status_anterior_ocupava boolean := false;
BEGIN
  v_status_ocupa := NOT coalesce(NEW.is_deleted, false)
    AND NEW.status IN (
      'ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO',
      'CONTINGENCIA', 'RESULTADO_INCERTO'
    );

  IF NOT v_status_ocupa THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_status_anterior_ocupava := NOT coalesce(OLD.is_deleted, false)
      AND OLD.status IN (
        'ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO',
        'CONTINGENCIA', 'RESULTADO_INCERTO'
      );

    IF v_status_anterior_ocupava
       AND NEW.vendaid IS NOT DISTINCT FROM OLD.vendaid
       AND NEW.ordemservicoid IS NOT DISTINCT FROM OLD.ordemservicoid
       AND NEW.modelo IS NOT DISTINCT FROM OLD.modelo THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.vendaid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(format('nfe:venda:%s:modelo:%s', NEW.vendaid, NEW.modelo), 0)
    );

    IF EXISTS (
      SELECT 1
        FROM public.nfe existente
       WHERE existente.id <> coalesce(NEW.id, -1)
         AND existente.vendaid = NEW.vendaid
         AND existente.modelo = NEW.modelo
         AND existente.is_deleted = false
         AND existente.status IN (
           'ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO',
           'CONTINGENCIA', 'RESULTADO_INCERTO'
         )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = format(
          'A venda %s já possui uma nota transmitida do modelo %s.',
          NEW.vendaid,
          NEW.modelo
        ),
        CONSTRAINT = 'nfe_origem_venda_modelo_transmitida_idx';
    END IF;
  END IF;

  IF NEW.ordemservicoid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(format('nfe:os:%s:modelo:%s', NEW.ordemservicoid, NEW.modelo), 0)
    );

    IF EXISTS (
      SELECT 1
        FROM public.nfe existente
       WHERE existente.id <> coalesce(NEW.id, -1)
         AND existente.ordemservicoid = NEW.ordemservicoid
         AND existente.modelo = NEW.modelo
         AND existente.is_deleted = false
         AND existente.status IN (
           'ASSINADA', 'ENVIADA', 'AUTORIZADA', 'PENDENTE_ENVIO',
           'CONTINGENCIA', 'RESULTADO_INCERTO'
         )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = format(
          'A OS %s já possui uma nota transmitida do modelo %s.',
          NEW.ordemservicoid,
          NEW.modelo
        ),
        CONSTRAINT = 'nfe_origem_os_modelo_transmitida_idx';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nfe_origem_transmitida_unica ON public.nfe;
CREATE TRIGGER trg_nfe_origem_transmitida_unica
BEFORE INSERT OR UPDATE OF vendaid, ordemservicoid, modelo, status, is_deleted
ON public.nfe
FOR EACH ROW
EXECUTE FUNCTION public.nfe_impedir_origem_transmitida_duplicada();

COMMIT;
