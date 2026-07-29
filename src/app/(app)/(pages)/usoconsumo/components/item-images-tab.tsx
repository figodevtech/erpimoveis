"use client";

import { useRef } from "react";
import { Image as ImageIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import type { UsoConsumoImagem } from "@/types/usoconsumo";
import {
  ProdutoImagensGallery,
  type ProdutoImagemPendente,
} from "../../estoque/components/dialog-produto/tabs/produto-imagens-gallery";

type Props = {
  mode: "create" | "edit";
  images?: UsoConsumoImagem[];
  pending: ProdutoImagemPendente[];
  orderKeys: string[];
  progress: Record<string, number>;
  mainImageUrl?: string | null;
  loading?: boolean;
  uploading?: boolean;
  savingOrder?: boolean;
  removingId?: number | null;
  definingMainId?: number | null;
  saving?: boolean;
  onPick: (files: File[]) => void;
  onUpload?: () => void;
  onReorder: (keys: string[]) => void;
  onRemovePending: (id: string) => void;
  onDefineMain?: (id: number) => void;
  onRemove?: (id: number) => void;
};

export function ItemImagesTab({
  mode,
  images = [],
  pending,
  orderKeys,
  progress,
  mainImageUrl,
  loading,
  uploading,
  savingOrder,
  removingId,
  definingMainId,
  saving,
  onPick,
  onUpload,
  onReorder,
  onRemovePending,
  onDefineMain,
  onRemove,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <TabsContent value="Imagens" className="h-full min-h-0 overflow-auto px-2 py-3 dark:bg-muted-foreground/5 md:px-6 md:py-6">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Imagens do item</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "create"
                ? "Adicione imagens relacionadas a este item. Elas serão enviadas ao salvar o cadastro."
                : "Adicione imagens relacionadas a este item. Revise a seleção antes de realizar o upload."}
            </p>
            <p className="text-xs text-muted-foreground">
              {mode === "edit" ? `${images.length} ${images.length === 1 ? "imagem cadastrada" : "imagens cadastradas"}` : `${pending.length} ${pending.length === 1 ? "imagem selecionada" : "imagens selecionadas"}`}
              {mode === "edit" && pending.length ? `, ${pending.length} pendente(s)` : ""}.
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
            <Button type="button" variant="outline" className="gap-2" disabled={saving || uploading || loading} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Enviar imagens
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border text-muted-foreground">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
            <p className="text-sm">Carregando imagens...</p>
          </div>
        ) : (
          <ProdutoImagensGallery
            imagens={images}
            pendentes={pending}
            orderKeys={orderKeys}
            uploadProgressByPendingId={progress}
            imgUrlPrincipal={mainImageUrl}
            emptyText={mode === "create" ? "Nenhuma imagem selecionada." : "Nenhuma imagem vinculada."}
            uploading={uploading}
            savingOrder={savingOrder}
            removingImageId={removingId}
            definingMainImageId={definingMainId}
            saving={saving}
            onUpload={mode === "edit" ? onUpload : undefined}
            onReorder={onReorder}
            uploadDisabledReason={mode === "create" && pending.length ? "As imagens serão enviadas ao salvar o item." : undefined}
            onRemovePendente={onRemovePending}
            onDefinirPrincipal={mode === "edit" ? onDefineMain : undefined}
            onRemoverImagem={mode === "edit" ? onRemove : undefined}
          />
        )}
      </div>
    </TabsContent>
  );
}
