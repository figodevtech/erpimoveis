"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TabsContent } from "@/components/ui/tabs";
import { Image as ImageIcon, Upload, Trash2, CheckCircle2 } from "lucide-react";
import type { ProdutoImagem } from "../hooks/use-produto-imagens";

type Props = {
  previews: string[];
  carregando: boolean;
  subindo: boolean;
  imagens: ProdutoImagem[];
  imgUrlPrincipal?: string | null;
  onPick: (files: File[]) => void;
  onEnviar: () => void;
  onDefinirPrincipal: (id: number) => void;
  onRemover: (id: number) => void;
  hasSelection: boolean;
};

export function TabImagensEdit({
  previews,
  carregando,
  subindo,
  imagens,
  imgUrlPrincipal,
  onPick,
  onEnviar,
  onDefinirPrincipal,
  onRemover,
  hasSelection,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <TabsContent value="Imagens" className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6 space-y-6">
      
      <div className="space-y-6">
        {/* Upload Header */}
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Adicionar Imagens
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Selecione imagens do seu dispositivo para adicionar a este produto.
            </p>
            {hasSelection && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {previews.length} {previews.length === 1 ? "imagem pronta" : "imagens prontas"} para envio.
              </p>
            )}
          </div>
          
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[240px]">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => onPick(Array.from(e.target.files ?? []))}
            />
            
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 gap-2 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                disabled={subindo}
              >
                Selecionar
              </Button>

              <Button
                type="button"
                className="flex-1 gap-2 cursor-pointer"
                onClick={onEnviar}
                disabled={!hasSelection || subindo}
              >
                {subindo ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary-foreground" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {subindo ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </div>
        </div>

        {/* Previews de Novas Imagens */}
        {previews.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {previews.map((src, idx) => (
              <div key={idx} className="overflow-hidden rounded-lg border bg-card opacity-70">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="aspect-square overflow-hidden flex items-center justify-center">
                  <img src={src} alt={`preview-${idx}`} className="w-full object-cover grayscale transition-all hover:grayscale-0" />
                </div>
                <div className="space-y-1 p-3">
                  <Badge variant="outline" className="mb-1 text-[10px]">Não Enviada</Badge>
                  <p className="truncate text-sm font-semibold">Nova Imagem {idx + 1}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {previews.length > 0 && <Separator className="my-4" />}

        {/* Lista de Imagens Salvas */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Imagens Cadastradas
            </h3>
          </div>

          {carregando ? (
            <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border text-muted-foreground">
              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
              <p className="text-sm">Carregando imagens...</p>
            </div>
          ) : imagens.length === 0 ? (
            <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center text-muted-foreground">
              <ImageIcon className="h-10 w-10 opacity-25" />
              <p className="text-sm">Nenhuma imagem cadastrada no momento.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {imagens.map((img) => {
                const ehPrincipal = !!imgUrlPrincipal && imgUrlPrincipal === img.url;
                return (
                  <div key={img.id} className={`overflow-hidden rounded-lg border bg-card transition-all ${ehPrincipal ? "ring-2 ring-primary border-transparent" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <div className="group aspect-square overflow-hidden flex items-center justify-center">
                      <img src={img.url} alt={`img-${img.id}`} className="aspect-auto group-hover:scale-105 transition-transform duration-300" />
                    </div>
                    <div className="space-y-2 p-3">
                      <div className="min-w-0 space-y-1">
                        {ehPrincipal ? (
                          <Badge className="mb-1 bg-primary text-primary-foreground gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Principal
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="mb-1 text-transparent select-none bg-transparent hover:bg-transparent">
                            -
                          </Badge>
                        )}
                        <p className="truncate text-sm font-semibold text-muted-foreground" title={`Imagem #${img.id}`}>
                          Imagem #{img.id}
                        </p>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2">
                        <Button
                          type="button"
                          variant={ehPrincipal ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => onDefinirPrincipal(img.id)}
                          disabled={ehPrincipal}
                          className="flex-1 cursor-pointer text-xs"
                        >
                          {ehPrincipal ? "Capa" : "Definir Capa"}
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onRemover(img.id)}
                          className="gap-1 cursor-pointer text-destructive hover:text-destructive px-2"
                          title="Remover Imagem"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TabsContent>
  );
}
