"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { CheckCircle2, ExternalLink, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import type { ProdutoImagem } from "../hooks/use-produto-imagens";

type Props = {
  carregando: boolean;
  subindo: boolean;
  removendoImagemId?: number | null;
  imagens: ProdutoImagem[];
  imgUrlPrincipal?: string | null;
  onPick: (files: File[]) => void;
  onDefinirPrincipal: (id: number) => void;
  onRemover: (id: number) => void;
};

function formatDate(date?: string | null) {
  if (!date) return "";

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(date));
  } catch {
    return "";
  }
}

export function TabImagensEdit({
  carregando,
  subindo,
  removendoImagemId,
  imagens,
  imgUrlPrincipal,
  onPick,
  onDefinirPrincipal,
  onRemover,
}: Props) {
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
              Adicione imagens relacionadas a este produto. Elas são otimizadas automaticamente.
            </p>
            <p className="text-xs text-muted-foreground">
              {imagens.length} {imagens.length === 1 ? "imagem cadastrada" : "imagens cadastradas"}.
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
              disabled={subindo || carregando}
              onClick={() => fileInputRef.current?.click()}
            >
              {subindo ? (
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {subindo ? "Enviando..." : "Adicionar imagem"}
            </Button>
          </div>
        </div>

        {carregando ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border text-muted-foreground">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
            <p className="text-sm">Carregando imagens...</p>
          </div>
        ) : imagens.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center text-muted-foreground">
            <ImageIcon className="h-10 w-10 opacity-25" />
            <p className="text-sm">Nenhuma imagem vinculada.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {imagens.map((img) => {
              const ehPrincipal = !!imgUrlPrincipal && imgUrlPrincipal === img.url;
              const removendo = removendoImagemId === img.id;

              return (
                <div key={img.id} className={`overflow-hidden rounded-lg border bg-card ${ehPrincipal ? "ring-2 ring-primary border-transparent" : ""}`}>
                  <a href={img.url} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`Imagem ${img.id}`} className="h-32 w-full object-cover" />
                  </a>

                  <div className="space-y-2 p-3">
                    <div className="min-w-0 space-y-1">
                      {ehPrincipal ? (
                        <Badge className="mb-1 gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Capa
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="mb-1">
                          Imagem
                        </Badge>
                      )}
                      <p className="truncate text-sm font-semibold" title={`Imagem #${img.id}`}>
                        Imagem #{img.id}
                      </p>
                      {img.createdat && (
                        <p className="text-xs text-muted-foreground">
                          {formatDate(img.createdat)}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a href={img.url} target="_blank" rel="noreferrer" className="gap-2">
                          <ExternalLink className="h-4 w-4" />
                          Abrir
                        </a>
                      </Button>

                      <Button
                        type="button"
                        variant={ehPrincipal ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => onDefinirPrincipal(img.id)}
                        disabled={ehPrincipal || removendo}
                      >
                        {ehPrincipal ? "Capa" : "Definir capa"}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2 text-destructive hover:text-destructive"
                        disabled={removendo}
                        onClick={() => onRemover(img.id)}
                      >
                        {removendo ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-destructive" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        Remover
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </TabsContent>
  );
}
