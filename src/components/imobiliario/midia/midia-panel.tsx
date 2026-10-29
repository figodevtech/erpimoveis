"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Image as ImageIcon, Info, Loader2, Upload } from "lucide-react";
import { GaleriaMidia } from "./galeria-midia";
import type { ImovelMidia } from "./use-imovel-midia";

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

/** Área que aceita arquivos arrastados do computador, com destaque enquanto paira. */
export function FileDropZone({
  disabled,
  onFiles,
  hint,
  children,
}: {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  hint: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  return (
    <div
      className="relative"
      onDragEnter={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        if (disabled) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {children}
      {over ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px]">
          <p className="rounded-md bg-background/90 px-3 py-1.5 text-sm font-medium text-primary shadow-sm">{hint}</p>
        </div>
      ) : null}
    </div>
  );
}

export function MidiaPanel({
  midia,
  editable,
  isNew,
}: {
  midia: ImovelMidia;
  editable: boolean;
  /** Cadastro ainda não salvo: as fotos ficam pendentes até o imóvel existir. */
  isNew: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const busy = midia.subindoImagens || midia.carregandoImagens;
  const total = midia.imagens.length;
  const pendentes = midia.imagensPendentes.length;

  return (
    <FileDropZone disabled={!editable || midia.subindoImagens} onFiles={midia.onPick} hint="Solte as fotos para adicionar à galeria">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Fotos do anúncio</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {isNew
                ? "Escolha as fotos agora; elas serão enviadas ao salvar o cadastro."
                : "Revise e ordene as fotos antes de enviar. Também é possível arrastar arquivos para cá."}
            </p>
            <p className="text-xs text-muted-foreground">
              {total} {total === 1 ? "foto publicada" : "fotos publicadas"}
              {pendentes > 0 ? `, ${pendentes} pendente(s)` : ""}.
              {midia.salvandoOrdem ? (
                <span className="ml-2 inline-flex items-center gap-1 text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" /> Salvando ordem…
                </span>
              ) : null}
            </p>
          </div>

          {editable ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[220px]">
              {/* Dois inputs de propósito: no Android 13+ `accept="image/*"` abre o
                  seletor de fotos do sistema, sem câmera; só `capture` abre a câmera
                  direto, e `capture` não aceita `multiple`. */}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,.heic,.heif"
                multiple
                onChange={(event) => {
                  midia.onPick(Array.from(event.target.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  midia.onPick(Array.from(event.target.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="gap-2 hover:cursor-pointer"
                disabled={busy}
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                Tirar foto
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2 hover:cursor-pointer"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Selecionar fotos
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            O site exibe as fotos nesta ordem e usa a 1ª como capa. Arraste para reordenar: a nova ordem é salva ao
            soltar. Fotos de celular (inclusive HEIC do iPhone) são convertidas e otimizadas no envio.
          </p>
        </div>

        {midia.carregandoImagens && total === 0 && pendentes === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border text-muted-foreground">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
            <p className="text-sm">Carregando fotos...</p>
          </div>
        ) : (
          <GaleriaMidia
            imagens={midia.imagens}
            pendentes={midia.imagensPendentes}
            orderKeys={midia.ordemItens}
            uploadProgressByPendingId={midia.uploadProgressByPendingId}
            imgUrlPrincipal={midia.capaUrl}
            emptyText={editable ? "Nenhuma foto. Selecione ou arraste imagens para cá." : "Nenhuma foto cadastrada."}
            uploading={midia.subindoImagens}
            savingOrder={midia.salvandoOrdem}
            removingImageId={midia.removendoImagemId}
            definingMainImageId={midia.definindoCapaImagemId}
            readOnly={!editable}
            uploadLabel={pendentes === 1 ? "Enviar 1 imagem" : `Enviar ${pendentes} imagens`}
            uploadDisabledReason={isNew && pendentes > 0 ? "As imagens serão enviadas ao salvar o cadastro." : undefined}
            onUpload={isNew ? undefined : () => void midia.uploadPendentes()}
            onReorder={midia.reordenarItens}
            onReorderEnd={isNew ? midia.reordenarItens : midia.finalizarReordenacao}
            onRemovePendente={midia.removerImagemPendente}
            onDefinirPrincipal={isNew ? undefined : (id) => void midia.definirCapa(id)}
            onRemoverImagem={isNew ? undefined : (id) => void midia.removerImagem(id)}
          />
        )}
      </div>
    </FileDropZone>
  );
}
