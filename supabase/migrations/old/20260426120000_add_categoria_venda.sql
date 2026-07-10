CREATE TABLE IF NOT EXISTS "public"."categoriavenda" (
    "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
    "nome" text NOT NULL,
    "descricao" text,
    "ativo" boolean DEFAULT true NOT NULL,
    "createdat" timestamp without time zone DEFAULT now(),
    "updatedat" timestamp without time zone DEFAULT now(),
    CONSTRAINT "categoriavenda_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'categoriavenda_nome_key'
    ) THEN
        ALTER TABLE "public"."categoriavenda"
            ADD CONSTRAINT "categoriavenda_nome_key" UNIQUE ("nome");
    END IF;
END $$;

GRANT ALL ON TABLE "public"."categoriavenda" TO "anon";
GRANT ALL ON TABLE "public"."categoriavenda" TO "authenticated";
GRANT ALL ON TABLE "public"."categoriavenda" TO "service_role";

GRANT ALL ON SEQUENCE "public"."categoriavenda_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."categoriavenda_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."categoriavenda_id_seq" TO "service_role";

ALTER TABLE "public"."venda"
    ADD COLUMN IF NOT EXISTS "categoriavendaid" integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_venda_categoria_venda'
    ) THEN
        ALTER TABLE "public"."venda"
            ADD CONSTRAINT "fk_venda_categoria_venda"
            FOREIGN KEY ("categoriavendaid")
            REFERENCES "public"."categoriavenda"("id")
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
END $$;
