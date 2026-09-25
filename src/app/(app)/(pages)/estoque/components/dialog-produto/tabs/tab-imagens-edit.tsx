"use client";

import { ChecklistVideoCamera } from "@/components/checklist-video-camera";
import { useEntityVideos } from "@/lib/videos/use-entity-videos";
import { VideoViewerDialog } from "@/components/video-viewer-dialog";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { Film, Image as ImageIcon, Upload } from "lucide-react";
import type { ProdutoImagem } from "../hooks/use-produto-imagens";
import { ProdutoImagensGallery, type ProdutoImagemPendente } from "./produto-imagens-gallery";

type Props = {
  productId: number;
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
  productId,
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
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const productVideos = useEntityVideos(productId, "produto");

  const pick = (files: File[]) => {
    onPick(files.filter(file => file.type.startsWith("image/")));
    void (async () => {
      for (const file of files.filter(item => item.type.startsWith("video/"))) {
        try { await productVideos.upload(file); }
        catch { break; }
      }
    })();
  };

  return (
    <TabsContent value="Imagens" className="h-full min-h-0 w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Fotos e vídeos do produto
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Adicione fotos ou vídeos relacionados a este produto. Revise as fotos antes de enviar.
            </p>
            <p className="text-xs text-muted-foreground">
              {imagens.length + productVideos.videos.length} anexos cadastrados
              {pendentes.length > 0 ? `, ${pendentes.length} pendente(s)` : ""}.
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:max-w-md">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => {
                pick(Array.from(e.target.files ?? []));
                e.currentTarget.value = "";
              }}
            />
            <input
              ref={videoInputRef}
              type="file"
              className="hidden"
              accept="video/*"
              multiple
              onChange={(e) => {
                pick(Array.from(e.target.files ?? []));
                e.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm" className="h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5"
              disabled={subindo || carregando || !!productVideos.busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Selecionar fotos
            </Button>
            {productVideos.enabled && productVideos.canEdit && <><Button
              type="button"
              variant="outline"
              size="sm" className="h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5"
              disabled={subindo || carregando || !!productVideos.busy}
              onClick={() => videoInputRef.current?.click()}
            >
              <Film className="h-4 w-4" />
              {productVideos.busy || "Escolher vídeo salvo"}
            </Button>
            <ChecklistVideoCamera compact disabled={subindo || carregando || !!productVideos.busy} onCapture={file => { void productVideos.upload(file).catch(() => undefined); }} />
            <p className="basis-full text-xs text-muted-foreground">Para gravar em Full HD, use Gravar vídeo aqui no ERP. No seletor do iPhone, escolha Fototeca ou Arquivos.</p></>}
            {productVideos.error && <p role="alert" className="text-xs text-destructive">{productVideos.error}</p>}
          </div>
        </div>

        {carregando || productVideos.loading ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border text-muted-foreground">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
            <p className="text-sm">Carregando fotos e vídeos...</p>
          </div>
        ) : (
            <ProdutoImagensGallery
              videos={productVideos.videos}
              videoAccess={productVideos.access}
              videoOpen={productVideos.open}
              videoDownload={productVideos.download}
              videoRemove={productVideos.canDelete && productVideos.canEdit ? productVideos.remove : undefined}
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
        {productVideos.viewing && <VideoViewerDialog key={productVideos.viewing.id} id={productVideos.viewing.id} name={productVideos.viewing.name} access={productVideos.access} onClose={productVideos.closeViewer} />}
      </div>
    </TabsContent>
  );
}
