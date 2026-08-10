-- Cancelar, reiniciar ou finalizar sem cobranca uma OS remove seus pagamentos
-- e titulos ativos. A decisao e deliberadamente destrutiva e fica protegida no
-- banco para valer para qualquer cliente/API que altere o status.
BEGIN;

CREATE OR REPLACE FUNCTION public.tg_excluir_transacoes_financeiras_os_por_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF new.status::text IS DISTINCT FROM old.status::text
     AND new.status::text IN ('ORCAMENTO', 'CANCELADO', 'SEM_COBRANCA') THEN
    DELETE FROM public.transacao t
     WHERE t.ordemservicoid = new.id
       AND upper(t.tipo::text) = 'RECEITA'
       AND t.evento_financeiro_id IS NULL
       AND t.is_deleted = false;
  END IF;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_excluir_transacoes_financeiras_os_por_status
  ON public.ordemservico;
CREATE TRIGGER trg_excluir_transacoes_financeiras_os_por_status
AFTER UPDATE OF status ON public.ordemservico
FOR EACH ROW EXECUTE FUNCTION public.tg_excluir_transacoes_financeiras_os_por_status();

ALTER FUNCTION public.tg_excluir_transacoes_financeiras_os_por_status() OWNER TO postgres;

COMMIT;
