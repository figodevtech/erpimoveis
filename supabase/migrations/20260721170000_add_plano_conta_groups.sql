-- Hierarquia de planos de conta: grupo -> plano de conta.
-- Mantém os IDs dos planos existentes e infere os grupos pelo código/nome atual.

CREATE TABLE IF NOT EXISTS public.planosdecontagrupos (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo text NOT NULL,
    nome text NOT NULL,
    descricao text,
    ativo boolean NOT NULL DEFAULT true,
    createdat timestamp with time zone NOT NULL DEFAULT now(),
    updatedat timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.planosdecontagrupos OWNER TO postgres;

GRANT ALL ON TABLE public.planosdecontagrupos TO anon;
GRANT ALL ON TABLE public.planosdecontagrupos TO authenticated;
GRANT ALL ON TABLE public.planosdecontagrupos TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.planosdecontagrupos_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.planosdecontagrupos_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.planosdecontagrupos_id_seq TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS planosdecontagrupos_codigo_unique
    ON public.planosdecontagrupos (upper(btrim(codigo)));

CREATE UNIQUE INDEX IF NOT EXISTS planosdecontagrupos_nome_unique
    ON public.planosdecontagrupos (upper(btrim(nome)));

ALTER TABLE public.planosdeconta
    ADD COLUMN IF NOT EXISTS grupo_id integer;

ALTER TABLE public.planosdeconta
    DROP CONSTRAINT IF EXISTS planosdeconta_nome_key;

-- Os dados existentes usam "Grupo - Plano" e códigos como "1.1".
WITH grupos_existentes AS (
    SELECT DISTINCT ON (codigo_grupo)
        codigo_grupo,
        nome_grupo
    FROM (
        SELECT
            nullif(split_part(btrim(coalesce(codigo, '')), '.', 1), '') AS codigo_grupo,
            CASE
                WHEN position(' - ' IN nome) > 0 THEN btrim(split_part(nome, ' - ', 1))
                ELSE NULL
            END AS nome_grupo
        FROM public.planosdeconta
    ) dados
    WHERE codigo_grupo IS NOT NULL
      AND nome_grupo IS NOT NULL
    ORDER BY codigo_grupo, nome_grupo
)
INSERT INTO public.planosdecontagrupos (codigo, nome, descricao)
SELECT codigo_grupo, nome_grupo, 'Grupo criado automaticamente a partir dos planos de conta existentes.'
FROM grupos_existentes
ON CONFLICT DO NOTHING;

UPDATE public.planosdeconta plano
SET grupo_id = grupo.id
FROM public.planosdecontagrupos grupo
WHERE plano.grupo_id IS NULL
  AND (
      upper(btrim(grupo.codigo)) = upper(split_part(btrim(coalesce(plano.codigo, '')), '.', 1))
      OR (
          position(' - ' IN plano.nome) > 0
          AND upper(btrim(grupo.nome)) = upper(btrim(split_part(plano.nome, ' - ', 1)))
      )
  );

-- Registros sem prefixo reconhecível continuam utilizáveis em um grupo de apoio.
INSERT INTO public.planosdecontagrupos (codigo, nome, descricao)
SELECT 'OUTROS', 'Sem grupo', 'Planos anteriores sem um grupo identificável.'
WHERE EXISTS (SELECT 1 FROM public.planosdeconta WHERE grupo_id IS NULL)
ON CONFLICT DO NOTHING;

UPDATE public.planosdeconta plano
SET grupo_id = grupo.id
FROM public.planosdecontagrupos grupo
WHERE plano.grupo_id IS NULL
  AND upper(btrim(grupo.codigo)) = 'OUTROS';

-- Remove do título do plano somente o nome do grupo já materializado.
UPDATE public.planosdeconta plano
SET nome = btrim(substring(plano.nome FROM position(' - ' IN plano.nome) + 3)),
    updatedat = now()
FROM public.planosdecontagrupos grupo
WHERE plano.grupo_id = grupo.id
  AND position(' - ' IN plano.nome) > 0
  AND upper(btrim(split_part(plano.nome, ' - ', 1))) = upper(btrim(grupo.nome));

ALTER TABLE public.planosdeconta
    ALTER COLUMN grupo_id SET NOT NULL;

ALTER TABLE public.planosdeconta
    DROP CONSTRAINT IF EXISTS planosdeconta_grupo_id_fkey;

ALTER TABLE public.planosdeconta
    ADD CONSTRAINT planosdeconta_grupo_id_fkey
    FOREIGN KEY (grupo_id) REFERENCES public.planosdecontagrupos(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_planosdeconta_grupo_id
    ON public.planosdeconta(grupo_id);

CREATE UNIQUE INDEX IF NOT EXISTS planosdeconta_grupo_nome_unique
    ON public.planosdeconta (grupo_id, upper(btrim(nome)));

CREATE UNIQUE INDEX IF NOT EXISTS planosdeconta_codigo_unique
    ON public.planosdeconta (upper(btrim(codigo)))
    WHERE nullif(btrim(codigo), '') IS NOT NULL;

-- Ao alterar o código do grupo, preserva o sufixo dos códigos filhos (1.2 -> 20.2).
CREATE OR REPLACE FUNCTION public.propagar_codigo_grupo_plano_de_conta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    UPDATE public.planosdeconta
    SET codigo = btrim(NEW.codigo) || substring(codigo FROM char_length(btrim(OLD.codigo)) + 1),
        updatedat = now()
    WHERE grupo_id = NEW.id
      AND codigo LIKE btrim(OLD.codigo) || '.%';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagar_codigo_grupo_plano_de_conta ON public.planosdecontagrupos;
CREATE TRIGGER trg_propagar_codigo_grupo_plano_de_conta
AFTER UPDATE OF codigo ON public.planosdecontagrupos
FOR EACH ROW EXECUTE FUNCTION public.propagar_codigo_grupo_plano_de_conta();

-- Aceita tanto o novo nome curto quanto o formato legado "Grupo - Plano".
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
    SELECT plano.id INTO NEW.plano_de_conta_id
    FROM public.planosdeconta plano
    JOIN public.planosdecontagrupos grupo ON grupo.id = plano.grupo_id
    WHERE upper(btrim(plano.nome)) = upper(btrim(NEW.plano_de_conta))
       OR upper(btrim(grupo.nome || ' - ' || plano.nome)) = upper(btrim(NEW.plano_de_conta))
    ORDER BY CASE
        WHEN upper(btrim(plano.nome)) = upper(btrim(NEW.plano_de_conta)) THEN 0
        ELSE 1
      END,
      plano.id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

-- Garante que o texto auxiliar das transações acompanhe os nomes curtos.
UPDATE public.transacao transacao
SET plano_de_conta = plano.nome
FROM public.planosdeconta plano
WHERE transacao.plano_de_conta_id = plano.id
  AND transacao.plano_de_conta IS DISTINCT FROM plano.nome;
