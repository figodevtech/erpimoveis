"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { Camera, Image as ImageIcon, Upload } from "lucide-react";
import type { ProdutoImagem } from "../hooks/use-produto-imagens";
import { ProdutoImagensGallery, type ProdutoImagemPendente } from "./produto-imagens-gallery";

type Props = {
  carregando: boolean;
  subindo: boolean;
  salvandoOrdem?: boolean;
  removendoImagemId?: number | null;
  definindoCapaImagemId?: number | null;
  imagens: ProdutoImagem[];
  pendentes: ProdutoImagemPendente[];
  ordemItens: string[];
  progressoUpload: Record<string, number>;
  imgUrlPrincipal?: string | null;
  onPick: (files: File[]) => void;
  onUpload: () => void;
  onReordenar: (keys: string[]) => void;
  onRemoverPendente: (id: string) => void;
  onDefinirPrincipal: (id: number) => void;
  onRemover: (id: number) => void;
};

export function TabImagensEdit({
  carregando,
  subindo,
  salvandoOrdem,
  removendoImagemId,
  definindoCapaImagemId,
  imagens,
  pendentes,
  ordemItens,
  progressoUpload,
  imgUrlPrincipal,
  onPick,
  onUpload,
  onReordenar,
  onRemoverPendente,
  onDefinirPrincipal,
  onRemover,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <TabsContent value="Imagens" className="h-full min-h-0 w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6">
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
              Adicione imagens relacionadas a este produto. Revise a selecao antes de realizar o upload.
            </p>
            <p className="text-xs text-muted-foreground">
              {imagens.length} {imagens.length === 1 ? "imagem cadastrada" : "imagens cadastradas"}
              {pendentes.length > 0 ? `, ${pendentes.length} pendente(s)` : ""}.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[240px]">
            {/* Dois inputs de proposito. O Android 13+ atende `accept="image/*"`
                com o seletor de fotos do sistema, que nao oferece camera nem
                escolha de aplicativo; so `capture` abre a camera direto. E
                `capture` nao aceita `multiple`, entao o envio em lote continua
                no input de cima. */}
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
            <input
              ref={cameraInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              capture="environment"
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
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera className="h-4 w-4" />
              Tirar foto
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={subindo || carregando}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Enviar imagens
            </Button>
          </div>
        </div>

        {carregando ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border text-muted-foreground">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
            <p className="text-sm">Carregando imagens...</p>
          </div>
        ) : (
          <ProdutoImagensGallery
            imagens={imagens}
            pendentes={pendentes}
            orderKeys={ordemItens}
            uploadProgressByPendingId={progressoUpload}
            imgUrlPrincipal={imgUrlPrincipal}
            emptyText="Nenhuma imagem vinculada."
            uploading={subindo}
            savingOrder={salvandoOrdem}
            removingImageId={removendoImagemId}
            definingMainImageId={definindoCapaImagemId}
            onUpload={onUpload}
            onReorder={onReordenar}
            onRemovePendente={onRemoverPendente}
            onDefinirPrincipal={onDefinirPrincipal}
            onRemoverImagem={onRemover}
          />
        )}
      </div>
    </TabsContent>
  );
}
