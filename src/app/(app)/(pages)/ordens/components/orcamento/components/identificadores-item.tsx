import { Barcode, Hash, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type IdentificadoresItemProps = {
  id?: number | string | null;
  referencia?: string | null;
  etiqueta?: string | null;
};

export function IdentificadoresItem({
  id,
  referencia,
  etiqueta,
}: IdentificadoresItemProps) {
  const idTexto = String(id ?? "").trim();
  const referenciaTexto = String(referencia ?? "").trim();
  const etiquetaTexto = String(etiqueta ?? "").trim();

  if (!idTexto && !referenciaTexto && !etiquetaTexto) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {idTexto ? (
        <Badge
          variant="secondary"
          className="h-5 gap-0.5 rounded-md px-1.5 font-mono text-[10px] font-medium"
        >
          <Hash className="size-2.5" />
          ID {idTexto}
        </Badge>
      ) : null}

      {referenciaTexto ? (
        <Badge
          variant="outline"
          className="h-5 gap-1 rounded-md border-border/70 bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground"
          title="Referência"
        >
          <Barcode className="size-2.5" />
          Ref. {referenciaTexto}
        </Badge>
      ) : null}

      {etiquetaTexto ? (
        <Badge
          variant="outline"
          className="h-5 gap-1 rounded-md border-indigo-500/30 bg-indigo-500/10 px-1.5 font-mono text-[10px] font-semibold text-indigo-700 dark:text-indigo-300"
          title="Etiqueta do produto"
        >
          <Tag className="size-2.5" />
          Etiqueta: {etiquetaTexto}
        </Badge>
      ) : null}
    </div>
  );
}
