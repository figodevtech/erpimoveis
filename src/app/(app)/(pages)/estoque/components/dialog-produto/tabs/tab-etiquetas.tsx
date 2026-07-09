"use client";

import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { MapPin, Tag } from "lucide-react";
import type { Produto } from "../../../types";
import { QrCodeInput } from "../qr-code-input";

type Props = {
  produto: Produto;
  onChange: (field: keyof Produto, value: any) => void;
};

export function TabEtiquetas({ produto, onChange }: Props) {
  return (
    <TabsContent value="Etiquetas" className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6">
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-4 flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Etiquetagem
            </h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <QrCodeInput
              id="produto-etiqueta"
              label="Etiqueta do produto"
              value={produto.etiqueta ?? ""}
              placeholder="Ex: PRD-000123"
              onChange={(value) => onChange("etiqueta", value)}
            />

            <QrCodeInput
              id="produto-local"
              label="Local"
              value={produto.local ?? ""}
              placeholder="Ex: CX-001"
              onChange={(value) => onChange("local", value)}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Etiqueta vinculada</span>
            </div>
            {produto.etiqueta ? (
              <Badge variant="secondary">{produto.etiqueta}</Badge>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma etiqueta informada.</p>
            )}
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Local atual</span>
            </div>
            {produto.local ? (
              <Badge variant="outline">{produto.local}</Badge>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum local informado.</p>
            )}
          </div>
        </div>
      </div>
    </TabsContent>
  );
}
