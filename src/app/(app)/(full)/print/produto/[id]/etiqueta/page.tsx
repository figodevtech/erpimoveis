import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseReferencias } from "@/lib/etiquetas/label-sizes";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";
import { EtiquetaProdutoView } from "./etiqueta-produto-view";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
};

export const metadata: Metadata = {
  title: "Etiqueta do produto",
};

export default async function EtiquetaProdutoPrintPage({ params }: PageProps) {
  const { id } = await params;
  const produtoId = Number(id);
  if (!Number.isInteger(produtoId) || produtoId <= 0) notFound();

  const { data, error } = await supabaseAdmin
    .from("produto")
    .select("id, titulo, descricao, etiqueta, referencia")
    .eq("id", produtoId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw error;
  if (!data) notFound();

  const etiqueta = String(data.etiqueta ?? "").trim();

  // Sem etiqueta nao ha o que codificar: o QR do produto e sempre a etiqueta, e
  // e por ela que a leitura em /api/etiquetas/consultar reencontra o produto.
  // O atalho no cadastro ja bloqueia esse caso — aqui a guarda cobre acesso
  // direto pela URL e etiqueta removida por outra pessoa com a aba aberta.
  if (!etiqueta) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">Produto sem etiqueta.</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Defina a etiqueta em Estoque &rarr; produto &rarr; aba Localização antes de imprimir.
        </p>
        <Button asChild variant="outline" className={PRINT_ACTION_BUTTON_CLASS}>
          <Link href="/estoque">Voltar</Link>
        </Button>
      </div>
    );
  }

  return (
    <EtiquetaProdutoView
      produtoId={data.id}
      titulo={String(data.titulo ?? data.descricao ?? "").trim()}
      etiqueta={etiqueta}
      referencias={parseReferencias(data.referencia)}
    />
  );
}
