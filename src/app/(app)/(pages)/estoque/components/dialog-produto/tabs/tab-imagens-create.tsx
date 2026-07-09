"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { ExternalLink, Image as ImageIcon, Trash2, Upload } from "lucide-react";

type Props = {
  previews: string[];
  saving?: boolean;
  onPick: (files: File[]) => void;
  onRemove: (index: number) => void;
};

export function TabImagensCreate({ previews, saving, onPick, onRemove }: Props) {
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
              Adicione imagens relacionadas a este produto. Elas serão enviadas automaticamente ao salvar o cadastro.
            </p>
            <p className="text-xs text-muted-foreground">
              {previews.length} {previews.length === 1 ? "imagem selecionada" : "imagens selecionadas"}.
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
              {saving ? (
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {saving ? "Salvando..." : "Adicionar imagem"}
            </Button>
          </div>
        </div>

        {previews.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center text-muted-foreground">
            <ImageIcon className="h-10 w-10 opacity-25" />
            <p className="text-sm">Nenhuma imagem selecionada.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {previews.map((src, idx) => (
              <div key={`${src}-${idx}`} className="overflow-hidden rounded-lg border bg-card">
                <a href={src} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Imagem selecionada ${idx + 1}`} className="h-32 w-full object-cover" />
                </a>

                <div className="space-y-2 p-3">
                  <div className="min-w-0 space-y-1">
                    <Badge variant="secondary" className="mb-1">
                      Selecionada
                    </Badge>
                    <p className="truncate text-sm font-semibold" title={`Imagem ${idx + 1}`}>
                      Imagem {idx + 1}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Será enviada ao salvar
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" asChild>
                      <a href={src} target="_blank" rel="noreferrer" className="gap-2">
                        <ExternalLink className="h-4 w-4" />
                        Abrir
                      </a>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      disabled={saving}
                      onClick={() => onRemove(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TabsContent>
  );
}
