DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_ambiente') THEN
        CREATE TYPE public.tipo_ambiente AS ENUM ('PRODUCAO', 'HOMOLOGACAO');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_produto_conservacao') THEN
        CREATE TYPE public.enum_produto_conservacao AS ENUM ('NOVO', 'USADO', 'RECONDICIONADO');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_canal_venda') THEN
        CREATE TYPE public.enum_canal_venda AS ENUM ('PDV', 'ONLINE');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_status_entrega') THEN
        CREATE TYPE public.enum_status_entrega AS ENUM ('SEPARACAO', 'ENVIO', 'ENTREGUE');
    END IF;
END $$;

ALTER TABLE public.checklist ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.config_geral
    ADD COLUMN IF NOT EXISTS habilitar_drawers boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS emissao_nf_no_modulo_ordens boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS emissao_nf_no_modulo_vendas boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS emissao_nf_ordens_nao_pagas boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS emissao_nf_vendas_nao_pagas boolean DEFAULT false NOT NULL;

ALTER TABLE public.empresa ALTER COLUMN ambiente DROP DEFAULT;
ALTER TABLE public.empresa
    ALTER COLUMN ambiente TYPE public.tipo_ambiente
    USING ambiente::public.tipo_ambiente;
ALTER TABLE public.empresa
    ALTER COLUMN ambiente SET DEFAULT 'HOMOLOGACAO'::public.tipo_ambiente;

ALTER TABLE public.fornecedor ADD COLUMN IF NOT EXISTS codigomunicipio text;
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS "tpNF" smallint;

ALTER TABLE public.ordemservico
    ALTER COLUMN dataentrada TYPE timestamp with time zone USING dataentrada AT TIME ZONE 'America/Sao_Paulo',
    ALTER COLUMN datasaida TYPE timestamp with time zone USING datasaida AT TIME ZONE 'America/Sao_Paulo',
    ALTER COLUMN createdat TYPE timestamp with time zone USING createdat AT TIME ZONE 'America/Sao_Paulo',
    ALTER COLUMN updatedat TYPE timestamp with time zone USING updatedat AT TIME ZONE 'America/Sao_Paulo',
    ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
    ADD COLUMN IF NOT EXISTS motivo_sem_cobranca text;

ALTER TABLE public.peca ADD COLUMN IF NOT EXISTS lacre text;

ALTER TABLE public.produto
    ADD COLUMN IF NOT EXISTS precocompra numeric,
    ADD COLUMN IF NOT EXISTS conservacao public.enum_produto_conservacao,
    ADD COLUMN IF NOT EXISTS destaque boolean DEFAULT false;

ALTER TABLE public.transacao ALTER COLUMN banco_id SET NOT NULL;

ALTER TABLE public.usuario ADD COLUMN IF NOT EXISTS is_root boolean DEFAULT false NOT NULL;

ALTER TABLE public.veiculo
    ADD COLUMN IF NOT EXISTS ano_modelo integer,
    ADD COLUMN IF NOT EXISTS versao text,
    ADD COLUMN IF NOT EXISTS fipe numeric,
    ADD COLUMN IF NOT EXISTS combustivel text,
    ADD COLUMN IF NOT EXISTS transmissao text;

ALTER TABLE public.venda
    ADD COLUMN IF NOT EXISTS canal public.enum_canal_venda DEFAULT 'PDV'::public.enum_canal_venda NOT NULL,
    ADD COLUMN IF NOT EXISTS endereco_entrega_snapshot jsonb,
    ADD COLUMN IF NOT EXISTS forma_pagamento text,
    ADD COLUMN IF NOT EXISTS status_entrega public.enum_status_entrega,
    ADD COLUMN IF NOT EXISTS codigo_rastreio text,
    ADD COLUMN IF NOT EXISTS transportadora_rastreio text DEFAULT ''::text,
    ADD COLUMN IF NOT EXISTS ultimo_evento_rastreio text,
    ADD COLUMN IF NOT EXISTS ultimo_evento_rastreio_em timestamp with time zone,
    ADD COLUMN IF NOT EXISTS status_rastreio text,
    ADD COLUMN IF NOT EXISTS eventos_rastreio jsonb,
    ADD COLUMN IF NOT EXISTS rastreio_atualizado_em timestamp with time zone,
    ADD COLUMN IF NOT EXISTS nfe_chave_acesso text,
    ADD COLUMN IF NOT EXISTS danfe_url text,
    ADD COLUMN IF NOT EXISTS observacoes_fiscais text,
    ADD COLUMN IF NOT EXISTS vendedor uuid,
    ADD COLUMN IF NOT EXISTS updated_by uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_created_by_fkey') THEN
        ALTER TABLE public.checklist
            ADD CONSTRAINT checklist_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.usuario(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_email_formato_chk') THEN
        ALTER TABLE public.cliente
            ADD CONSTRAINT cliente_email_formato_chk CHECK (((email)::text ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'::text));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_email_key') THEN
        ALTER TABLE public.cliente
            ADD CONSTRAINT cliente_email_key UNIQUE (email);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_user_id_fkey') THEN
        ALTER TABLE public.cliente
            ADD CONSTRAINT cliente_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_user_id_key') THEN
        ALTER TABLE public.cliente
            ADD CONSTRAINT cliente_user_id_key UNIQUE (user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venda_updated_by_fkey') THEN
        ALTER TABLE public.venda
            ADD CONSTRAINT venda_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.usuario(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venda_vendedor_fkey') THEN
        ALTER TABLE public.venda
            ADD CONSTRAINT venda_vendedor_fkey FOREIGN KEY (vendedor) REFERENCES public.usuario(id);
    END IF;
END $$;
