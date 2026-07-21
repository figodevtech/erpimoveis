ALTER TABLE public.cliente
    ALTER COLUMN telefone DROP NOT NULL,
    ALTER COLUMN cidade DROP NOT NULL,
    ALTER COLUMN estado DROP NOT NULL;

ALTER TABLE public.cliente
    ADD CONSTRAINT cliente_juridica_telefone_required
        CHECK (tipopessoa = 'FISICA' OR telefone IS NOT NULL),
    ADD CONSTRAINT cliente_juridica_cidade_required
        CHECK (tipopessoa = 'FISICA' OR cidade IS NOT NULL),
    ADD CONSTRAINT cliente_juridica_estado_required
        CHECK (tipopessoa = 'FISICA' OR estado IS NOT NULL);
