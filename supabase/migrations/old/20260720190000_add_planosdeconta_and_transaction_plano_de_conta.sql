-- Migration para adicionar a tabela planosdeconta e suporte em transacao

CREATE TABLE IF NOT EXISTS public.planosdeconta (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo text,
    nome text NOT NULL UNIQUE,
    descricao text,
    ativo boolean NOT NULL DEFAULT true,
    createdat timestamp with time zone DEFAULT now() NOT NULL,
    updatedat timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.planosdeconta
    ADD COLUMN IF NOT EXISTS codigo text;

ALTER TABLE public.planosdeconta OWNER TO postgres;

GRANT ALL ON TABLE public.planosdeconta TO anon;
GRANT ALL ON TABLE public.planosdeconta TO authenticated;
GRANT ALL ON TABLE public.planosdeconta TO service_role;

-- Adicionar colunas na tabela transacao
ALTER TABLE public.transacao
    ADD COLUMN IF NOT EXISTS plano_de_conta_id integer,
    ADD COLUMN IF NOT EXISTS plano_de_conta text;

-- Foreign key para transacao
ALTER TABLE public.transacao
    DROP CONSTRAINT IF EXISTS transacao_plano_de_conta_id_fkey;

ALTER TABLE public.transacao
    ADD CONSTRAINT transacao_plano_de_conta_id_fkey
    FOREIGN KEY (plano_de_conta_id) REFERENCES public.planosdeconta(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transacao_plano_de_conta_id
    ON public.transacao(plano_de_conta_id);

-- Trigger de sincronização de plano_de_conta em transacao
CREATE OR REPLACE FUNCTION public.sincronizar_plano_de_conta_transacao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.plano_de_conta_id IS NOT NULL THEN
    SELECT nome INTO NEW.plano_de_conta
    FROM public.planosdeconta
    WHERE id = NEW.plano_de_conta_id;
  ELSIF nullif(btrim(NEW.plano_de_conta), '') IS NOT NULL THEN
    SELECT id INTO NEW.plano_de_conta_id
    FROM public.planosdeconta
    WHERE upper(btrim(nome)) = upper(btrim(NEW.plano_de_conta))
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_plano_de_conta_transacao ON public.transacao;
CREATE TRIGGER trg_sincronizar_plano_de_conta_transacao
BEFORE INSERT OR UPDATE OF plano_de_conta, plano_de_conta_id ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_plano_de_conta_transacao();

-- Trigger de propagação ao renomear um plano de conta
CREATE OR REPLACE FUNCTION public.propagar_nome_plano_de_conta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.nome IS DISTINCT FROM OLD.nome THEN
    UPDATE public.transacao
    SET plano_de_conta = NEW.nome
    WHERE plano_de_conta_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagar_nome_plano_de_conta ON public.planosdeconta;
CREATE TRIGGER trg_propagar_nome_plano_de_conta
AFTER UPDATE OF nome ON public.planosdeconta
FOR EACH ROW EXECUTE FUNCTION public.propagar_nome_plano_de_conta();
