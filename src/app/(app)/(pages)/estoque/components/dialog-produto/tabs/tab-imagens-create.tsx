"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { Image as ImageIcon, Upload } from "lucide-react";
import { ProdutoImagensGallery, type ProdutoImagemPendente } from "./produto-imagens-gallery";

type Props = {
  pendentes: ProdutoImagemPendente[];
  ordemItens: string[];
  progressoUpload?: Record<string, number>;
  saving?: boolean;
  onPick: (files: File[]) => void;
  onReordenar: (keys: string[]) => void;
  onRemove: (id: string) => void;
};

export function TabImagensCreate({ pendentes, ordemItens, progressoUpload, saving, onPick, onReordenar, onRemove }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <TabsContent value="Imagens" className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Imagens do produto
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Adicione imagens relacionadas a este produto. Elas serao enviadas ao salvar o cadastro.
            </p>
            <p className="text-xs text-muted-foreground">
              {pendentes.length} {pendentes.length === 1 ? "imagem selecionada" : "imagens selecionadas"}.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[240px]">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => {
                onPick(Array.from(e.target.files ?? []));
                e.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Enviar imagens
            </Button>
          </div>
        </div>

        <ProdutoImagensGallery
          pendentes={pendentes}
          orderKeys={ordemItens}
          uploadProgressByPendingId={progressoUpload}
          emptyText="Nenhuma imagem selecionada."
          saving={saving}
          onReorder={onReordenar}
          uploadDisabledReason={pendentes.length > 0 ? "As imagens serao enviadas ao salvar o produto." : undefined}
          onRemovePendente={onRemove}
        />
      </div>
    </TabsContent>
  );
}
