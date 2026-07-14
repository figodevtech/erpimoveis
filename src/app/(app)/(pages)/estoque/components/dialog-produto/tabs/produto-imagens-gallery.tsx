"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToWindowEdges, snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Image as ImageIcon, Loader2, Trash2, UploadCloud, X } from "lucide-react";
import type { ProdutoImagem } from "../hooks/use-produto-imagens";

export type ProdutoImagemPendente = {
  id: string;
  file: File;
  previewUrl: string;
};

type GalleryItem =
  | { key: string; type: "pending"; pending: ProdutoImagemPendente }
  | { key: string; type: "saved"; image: ProdutoImagem };

type Props = {
  imagens?: ProdutoImagem[];
  pendentes: ProdutoImagemPendente[];
  orderKeys?: string[];
  uploadProgressByPendingId?: Record<string, number>;
  imgUrlPrincipal?: string | null;
  emptyText: string;
  uploading?: boolean;
  savingOrder?: boolean;
  removingImageId?: number | null;
  definingMainImageId?: number | null;
  saving?: boolean;
  uploadLabel?: string;
  uploadDisabledReason?: string;
  onUpload?: () => void;
  onReorder?: (keys: string[]) => void;
  onRemovePendente: (id: string) => void;
  onDefinirPrincipal?: (id: number) => void;
  onRemoverImagem?: (id: number) => void;
};

type ImageCardProps = {
  item: GalleryItem;
  src: string;
  alt: string;
  displayOrder?: number;
  imgUrlPrincipal?: string | null;
  progressValue?: number;
  removingImageId?: number | null;
  definingMainImageId?: number | null;
  busy?: boolean;
  isOverlay?: boolean;
  onRemovePendente?: (id: string) => void;
  onDefinirPrincipal?: (id: number) => void;
  onConfirmRemove?: (id: number) => void;
};

function imageKey(id: number) {
  return `img-${id}`;
}

function pendingKey(id: string) {
  return `pending-${id}`;
}

function formatOrdinal(value: number) {
  return `${value}\u00ba`;
}

function ImageCard({
  item,
  src,
  alt,
  displayOrder,
  imgUrlPrincipal,
  progressValue = 0,
  removingImageId,
  definingMainImageId,
  busy,
  isOverlay,
  onRemovePendente,
  onDefinirPrincipal,
  onConfirmRemove,
}: ImageCardProps) {
  const pending = item.type === "pending" ? item.pending : null;
  const image = item.type === "saved" ? item.image : null;
  const ehPrincipal = !!image && !!imgUrlPrincipal && imgUrlPrincipal === image.url;
  const removendo = !!image && removingImageId === image.id;
  const definindoCapa = !!image && definingMainImageId === image.id;
  const bloqueadoPorCapa = definingMainImageId != null;

  return (
    <div
      className={`relative group aspect-square overflow-hidden rounded-md border bg-muted/20 transition-all duration-200 ${
        ehPrincipal ? "ring-2 ring-primary border-transparent" : ""
      } ${isOverlay ? "scale-105 cursor-grabbing shadow-2xl ring-2 ring-primary/40" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} draggable={false} className="h-full w-full object-cover group-hover:scale-105 transition-all duration-500" />

      {pending && !isOverlay && (
        <>
          <button
            type="button"
            className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-background/90 shadow-sm hover:bg-background "
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemovePendente?.(pending.id);
            }}
            title="Remover"
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </button>

          <div className="absolute inset-x-0 bottom-0 bg-background/80 px-1.5 py-1 backdrop-blur">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressValue}%` }} />
              </div>
              <span className="min-w-8 text-right text-[10px] text-muted-foreground">{progressValue}%</span>
            </div>
          </div>
        </>
      )}

      <div className="absolute bottom-2 left-1.5 flex flex-row gap-1 justify-between items-center w-[calc(100%-0.5rem)] px-2">

      {image && onDefinirPrincipal && !ehPrincipal && !isOverlay && (
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 h-7  rounded-md bg-gray-500/50  font-semibold px-2 py-1 text-[10px] text-white backdrop-blur duration-500 transition-all hover:cursor-pointer hover:bg-primary hover:text-primary-foreground duration-200"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDefinirPrincipal(image.id);
          }}
          disabled={removendo || busy || bloqueadoPorCapa}
          title="Definir como capa"
        >
          {definindoCapa ? "DEFININDO..." : "DEFINIR CAPA"}
        </button>
      )}

      
      {image && onConfirmRemove && !isOverlay && (
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 transition-all duration-500 flex flex-row itens-center h-7 w-7 items-center justify-center rounded-md bg-gray-500/50 text-white shadow-sm hover:cursor-pointer hover:bg-red-500"
          onPointerDown={(event) => event.stopPropagation()}
          disabled={removendo || busy || bloqueadoPorCapa}
          onClick={(event) => {
            event.stopPropagation();
            onConfirmRemove(image.id);
          }}
          title="Remover"
        >
          {removendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      )}
      </div>



      {displayOrder != null && (
        <div className="absolute top-2 left-1.5 flex flex-row gap-1 text-[11px]">
          <Badge>{formatOrdinal(displayOrder)}</Badge>
          {ehPrincipal && <Badge>Capa</Badge>}
        </div>
      )}

      
    </div>
  );
}

function SortableImageCard(props: ImageCardProps & { item: GalleryItem; disabled?: boolean }) {
  const { item, disabled, ...cardProps } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        touchAction: "none",
      }}
      className="cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <div className={isDragging ? "opacity-0" : ""}>
        <ImageCard item={item} {...cardProps} />
      </div>
    </div>
  );
}

export function ProdutoImagensGallery({
  imagens = [],
  pendentes,
  orderKeys,
  uploadProgressByPendingId = {},
  imgUrlPrincipal,
  emptyText,
  uploading,
  savingOrder,
  removingImageId,
  definingMainImageId,
  saving,
  uploadLabel = "Realizar upload",
  uploadDisabledReason,
  onUpload,
  onReorder,
  onRemovePendente,
  onDefinirPrincipal,
  onRemoverImagem,
}: Props) {
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const confirmImage = imagens.find((img) => img.id === confirmRemoveId);
  const hasImages = imagens.length > 0 || pendentes.length > 0;
  const uploadDisabled = !onUpload || pendentes.length === 0 || uploading || saving || savingOrder;
  const busy = uploading || saving || savingOrder;

  const items = useMemo<GalleryItem[]>(() => {
    const saved = new Map(imagens.map((img) => [imageKey(img.id), img]));
    const pending = new Map(pendentes.map((img) => [pendingKey(img.id), img]));
    const baseKeys = orderKeys?.length
      ? orderKeys
      : [...imagens.map((img) => imageKey(img.id)), ...pendentes.map((img) => pendingKey(img.id))];
    const validKeys = baseKeys.filter((key) => saved.has(key) || pending.has(key));
    const missingSaved = imagens.map((img) => imageKey(img.id)).filter((key) => !validKeys.includes(key));
    const missingPending = pendentes.map((img) => pendingKey(img.id)).filter((key) => !validKeys.includes(key));

    return [...validKeys, ...missingSaved, ...missingPending]
      .map((key) => {
        const image = saved.get(key);
        if (image) return { key, type: "saved" as const, image };
        const pendingImage = pending.get(key);
        if (pendingImage) return { key, type: "pending" as const, pending: pendingImage };
        return null;
      })
      .filter(Boolean) as GalleryItem[];
  }, [imagens, orderKeys, pendentes]);

  const activeItem = activeId ? items.find((item) => item.key === activeId) : null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const getItemMedia = (item: GalleryItem) => {
    const pending = item.type === "pending" ? item.pending : null;
    const image = item.type === "saved" ? item.image : null;
    return {
      src: pending?.previewUrl ?? image?.url ?? "",
      alt: pending?.file.name ?? (image ? `Imagem ${image.id}` : "Imagem"),
      progressValue: pending ? uploadProgressByPendingId[pending.id] ?? 0 : 0,
    };
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const reorderFromDragEvent = (event: DragOverEvent | DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.key === active.id);
      const newIndex = items.findIndex((item) => item.key === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const nextItems = arrayMove(items, oldIndex, newIndex);
      onReorder?.(nextItems.map((item) => item.key));
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    reorderFromDragEvent(event);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    reorderFromDragEvent(event);

    setActiveId(null);
  };

  const confirmRemove = () => {
    if (!confirmRemoveId) return;
    onRemoverImagem?.(confirmRemoveId);
    setConfirmRemoveId(null);
  };

  return (
    <>
      <div className="space-y-3">
        {!hasImages ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center text-muted-foreground">
            <ImageIcon className="h-10 w-10 opacity-25" />
            <p className="text-sm">{emptyText}</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[snapCenterToCursor]}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext items={items.map((item) => item.key)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-5 p-4 lg:p-0 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
                {items.map((item, index) => {
                  const media = getItemMedia(item);
                  return (
                    <SortableImageCard
                      key={item.key}
                      item={item}
                      disabled={busy}
                      src={media.src}
                      alt={media.alt}
                      displayOrder={index + 1}
                      progressValue={media.progressValue}
                      imgUrlPrincipal={imgUrlPrincipal}
                      removingImageId={removingImageId}
                      definingMainImageId={definingMainImageId}
                      busy={busy}
                      onRemovePendente={onRemovePendente}
                      onDefinirPrincipal={onDefinirPrincipal}
                      onConfirmRemove={setConfirmRemoveId}
                    />
                  );
                })}
              </div>
            </SortableContext>

            <DragOverlay
              modifiers={[restrictToWindowEdges]}
              dropAnimation={{
                sideEffects: defaultDropAnimationSideEffects({
                  styles: {
                    active: { opacity: "0.5" },
                  },
                }),
              }}
            >
              {activeItem ? (
                <div className="w-32 sm:w-36 lg:w-40">
                  <ImageCard
                    item={activeItem}
                    {...getItemMedia(activeItem)}
                    displayOrder={items.findIndex((item) => item.key === activeItem.key) + 1}
                    imgUrlPrincipal={imgUrlPrincipal}
                    isOverlay
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {pendentes.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {pendentes.length} {pendentes.length === 1 ? "imagem pendente" : "imagens pendentes"} de upload.
            </div>

            {onUpload ? (
              <Button
                type="button"
                size="sm"
                className="gap-2"
                disabled={uploadDisabled}
                onClick={onUpload}
                title={uploadDisabledReason}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {uploading ? "Enviando..." : uploadLabel}
              </Button>
            ) : uploadDisabledReason ? (
              <span className="text-xs text-muted-foreground">{uploadDisabledReason}</span>
            ) : null}
          </div>
        )}
      </div>

      <AlertDialog open={confirmRemoveId != null} onOpenChange={(open) => !open && setConfirmRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir imagem?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta imagem ja foi enviada e sera removida do produto. Essa acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmImage ? (
            <div className="overflow-hidden rounded-md border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={confirmImage.url} alt={`Imagem ${confirmImage.id}`} className="max-h-48 w-full object-cover" />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!removingImageId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!removingImageId}
              onClick={confirmRemove}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
