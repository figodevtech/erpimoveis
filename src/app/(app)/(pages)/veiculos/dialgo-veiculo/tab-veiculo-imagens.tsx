"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { Image as ImageIcon, Upload } from "lucide-react";
import {
  ProdutoImagensGallery,
  type GaleriaImagem,
  type ProdutoImagemPendente,
} from "../../estoque/components/dialog-produto/tabs/produto-imagens-gallery";

type Props = {
  mode: "create" | "edit";
  carregando?: boolean;
  subindo?: boolean;
  salvandoOrdem?: boolean;
  removendoImagemId?: number | null;
  definindoCapaImagemId?: number | null;
  imagens?: GaleriaImagem[];
  pendentes: ProdutoImagemPendente[];
  ordemItens: string[];
  progressoUpload?: Record<string, number>;
  imgUrlPrincipal?: string | null;
  saving?: boolean;
  onPick: (files: File[]) => void;
  onUpload?: () => void;
  onReordenar: (keys: string[]) => void;
  onRemoverPendente: (id: string) => void;
  onDefinirPrincipal?: (id: number) => void;
  onRemover?: (id: number) => void;
};

export function TabVeiculoImagens({
  mode,
  carregando,
  subindo,
  salvandoOrdem,
  removendoImagemId,
  definindoCapaImagemId,
  imagens = [],
  pendentes,
  ordemItens,
  progressoUpload,
  imgUrlPrincipal,
  saving,
  onPick,
  onUpload,
  onReordenar,
  onRemoverPendente,
  onDefinirPrincipal,
  onRemover,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const disabled = !!saving || !!subindo || !!carregando;

  return (
    <TabsContent
      value="Imagens"
      className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Imagens do veiculo
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "create"
                ? "Adicione imagens do veiculo. Elas serao enviadas ao salvar o cadastro."
                : "Adicione imagens do veiculo. Revise a selecao antes de realizar o upload."}
            </p>
            <p className="text-xs text-muted-foreground">
              {mode === "create"
                ? `${pendentes.length} ${pendentes.length === 1 ? "imagem selecionada" : "imagens selecionadas"}.`
                : `${imagens.length} ${imagens.length === 1 ? "imagem cadastrada" : "imagens cadastradas"}${
                    pendentes.length > 0 ? `, ${pendentes.length} pendente(s)` : ""
                  }.`}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[240px]">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={(event) => {
                onPick(Array.from(event.target.files ?? []));
                event.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={disabled}
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
            emptyText={mode === "create" ? "Nenhuma imagem selecionada." : "Nenhuma imagem vinculada."}
            uploading={subindo}
            saving={saving}
            savingOrder={salvandoOrdem}
            removingImageId={removendoImagemId}
            definingMainImageId={definindoCapaImagemId}
            onUpload={onUpload}
            onReorder={onReordenar}
            uploadDisabledReason={
              mode === "create" && pendentes.length > 0
                ? "As imagens serao enviadas ao salvar o veiculo."
                : undefined
            }
            onRemovePendente={onRemoverPendente}
            onDefinirPrincipal={onDefinirPrincipal}
            onRemoverImagem={onRemover}
          />
        )}
      </div>
    </TabsContent>
  );
}
