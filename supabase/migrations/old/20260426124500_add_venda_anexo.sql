CREATE TABLE IF NOT EXISTS "public"."vendaanexo" (
    "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
    "vendaid" integer NOT NULL,
    "nome" text NOT NULL,
    "tipo" text,
    "tamanho" bigint,
    "url" text NOT NULL,
    "path" text NOT NULL,
    "descricao" text,
    "createdat" timestamp without time zone DEFAULT now(),
    CONSTRAINT "vendaanexo_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'vendaanexo_vendaid_fkey'
    ) THEN
        ALTER TABLE "public"."vendaanexo"
            ADD CONSTRAINT "vendaanexo_vendaid_fkey"
            FOREIGN KEY ("vendaid")
            REFERENCES "public"."venda"("id")
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "vendaanexo_vendaid_idx"
    ON "public"."vendaanexo" USING "btree" ("vendaid");

CREATE UNIQUE INDEX IF NOT EXISTS "vendaanexo_path_uq"
    ON "public"."vendaanexo" USING "btree" ("path");

GRANT ALL ON TABLE "public"."vendaanexo" TO "anon";
GRANT ALL ON TABLE "public"."vendaanexo" TO "authenticated";
GRANT ALL ON TABLE "public"."vendaanexo" TO "service_role";

GRANT ALL ON SEQUENCE "public"."vendaanexo_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendaanexo_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendaanexo_id_seq" TO "service_role";
