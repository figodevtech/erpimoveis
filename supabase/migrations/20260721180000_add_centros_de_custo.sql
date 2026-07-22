-- Cadastro de centros de custo e vínculo opcional com transações.

CREATE TABLE IF NOT EXISTS public.centrosdecusto (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome text NOT NULL,
    descricao text,
    ativo boolean NOT NULL DEFAULT true,
    createdat timestamp with time zone NOT NULL DEFAULT now(),
    updatedat timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.centrosdecusto OWNER TO postgres;

GRANT ALL ON TABLE public.centrosdecusto TO anon;
GRANT ALL ON TABLE public.centrosdecusto TO authenticated;
GRANT ALL ON TABLE public.centrosdecusto TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.centrosdecusto_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.centrosdecusto_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.centrosdecusto_id_seq TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS centrosdecusto_nome_unique
    ON public.centrosdecusto (upper(btrim(nome)));

ALTER TABLE public.transacao
    ADD COLUMN IF NOT EXISTS centro_custo_id integer,
    ADD COLUMN IF NOT EXISTS centro_custo text;

ALTER TABLE public.transacao
    DROP CONSTRAINT IF EXISTS transacao_centro_custo_id_fkey;

ALTER TABLE public.transacao
    ADD CONSTRAINT transacao_centro_custo_id_fkey
    FOREIGN KEY (centro_custo_id) REFERENCES public.centrosdecusto(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transacao_centro_custo_id
    ON public.transacao(centro_custo_id);

CREATE OR REPLACE FUNCTION public.sincronizar_centro_custo_transacao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.centro_custo_id IS NOT NULL THEN
    SELECT nome INTO NEW.centro_custo
    FROM public.centrosdecusto
    WHERE id = NEW.centro_custo_id;
  ELSIF TG_OP = 'UPDATE'
    AND OLD.centro_custo_id IS NOT NULL
    AND NEW.centro_custo_id IS NULL THEN
    NEW.centro_custo := NULL;
  ELSIF nullif(btrim(NEW.centro_custo), '') IS NOT NULL THEN
    SELECT id INTO NEW.centro_custo_id
    FROM public.centrosdecusto
    WHERE upper(btrim(nome)) = upper(btrim(NEW.centro_custo))
    LIMIT 1;
  ELSE
    NEW.centro_custo := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_centro_custo_transacao ON public.transacao;
CREATE TRIGGER trg_sincronizar_centro_custo_transacao
BEFORE INSERT OR UPDATE OF centro_custo, centro_custo_id ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_centro_custo_transacao();

CREATE OR REPLACE FUNCTION public.propagar_nome_centro_custo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.nome IS DISTINCT FROM OLD.nome THEN
    UPDATE public.transacao
    SET centro_custo = NEW.nome
    WHERE centro_custo_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagar_nome_centro_custo ON public.centrosdecusto;
CREATE TRIGGER trg_propagar_nome_centro_custo
AFTER UPDATE OF nome ON public.centrosdecusto
FOR EACH ROW EXECUTE FUNCTION public.propagar_nome_centro_custo();
