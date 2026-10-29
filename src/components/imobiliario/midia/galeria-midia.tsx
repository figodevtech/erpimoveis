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

export type GaleriaImagem = {
  id: number;
  url: string;
  ordem: number;
  nome?: string;
};

export type ImagemPendente = {
  id: string;
  file: File;
  previewUrl: string;
};

type GalleryItem =
  | { key: string; type: "pending"; pending: ImagemPendente }
  | { key: string; type: "saved"; image: GaleriaImagem };

type Props = {
  imagens?: GaleriaImagem[];
  pendentes: ImagemPendente[];
  orderKeys?: string[];
  uploadProgressByPendingId?: Record<string, number>;
  imgUrlPrincipal?: string | null;
  emptyText: string;
  uploading?: boolean;
  savingOrder?: boolean;
  removingImageId?: number | null;
  definingMainImageId?: number | null;
  /** Sem permissão de edição: só exibe, sem arrastar nem ações. */
  readOnly?: boolean;
  uploadLabel?: string;
  uploadDisabledReason?: string;
  onUpload?: () => void;
  onReorder?: (keys: string[]) => void;
  /** Disparado ao soltar o card: é quando a ordem nova deve ser gravada. */
  onReorderEnd?: (keys: string[]) => void;
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
  readOnly?: boolean;
  isOverlay?: boolean;
  actionsVisible?: boolean;
  onToggleActions?: (key: string) => void;
  onRemovePendente?: (id: string) => void;
  onDefinirPrincipal?: (id: number) => void;
  onConfirmRemove?: (id: number) => void;
};

export function imageKey(id: number) {
  return `img-${id}`;
}

export function pendingKey(id: string) {
  return `pending-${id}`;
}

function formatOrdinal(value: number) {
  return `${value}º`;
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
  readOnly,
  isOverlay,
  actionsVisible,
  onToggleActions,
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
  const actionVisibilityClass = actionsVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100";
  const showActions = !!image && !isOverlay && !readOnly;

  return (
    <div
      className={`relative group aspect-square overflow-hidden rounded-md border bg-muted/20 transition-all duration-200 ${
        ehPrincipal ? "ring-2 ring-primary border-transparent" : ""
      } ${showActions ? "cursor-pointer" : ""} ${
        isOverlay ? "scale-105 cursor-grabbing shadow-2xl ring-2 ring-primary/40" : ""
      }`}
      onClick={() => {
        if (showActions) onToggleActions?.(item.key);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        loading="lazy"
        className="h-full w-full object-cover group-hover:scale-105 transition-all duration-500"
      />

      {pending && !isOverlay && (
        <>
          <button
            type="button"
            className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-background/90 shadow-sm hover:bg-background hover:cursor-pointer"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemovePendente?.(pending.id);
            }}
            title="Remover"
            aria-label={`Remover ${pending.file.name}`}
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

      {showActions && (
        <div className="absolute bottom-2 left-1.5 flex flex-row gap-1 justify-between items-center w-[calc(100%-0.5rem)] px-2">
          {onDefinirPrincipal && !ehPrincipal ? (
            <button
              type="button"
              className={`${actionVisibilityClass} h-7 rounded-md bg-gray-500/50 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur transition-all duration-500 hover:cursor-pointer hover:bg-primary hover:text-primary-foreground`}
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
          ) : (
            <span />
          )}

          {onConfirmRemove && (
            <button
              type="button"
              className={`${actionVisibilityClass} flex h-7 w-7 flex-row items-center justify-center rounded-md bg-gray-500/50 text-white shadow-sm transition-all duration-500 hover:cursor-pointer hover:bg-red-500`}
              onPointerDown={(event) => event.stopPropagation()}
              disabled={removendo || busy || bloqueadoPorCapa}
              onClick={(event) => {
                event.stopPropagation();
                onConfirmRemove(image.id);
              }}
              title="Remover"
              aria-label="Remover imagem"
            >
              {removendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      )}

      {displayOrder != null && (
        <div className="absolute top-2 left-1.5 flex flex-row gap-1 text-[11px]">
          <Badge>{formatOrdinal(displayOrder)}</Badge>
          {ehPrincipal && <Badge>Capa</Badge>}
          {pending && <Badge variant="secondary">Pendente</Badge>}
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
        touchAction: disabled ? undefined : "none",
      }}
      className={disabled ? "" : "cursor-grab active:cursor-grabbing"}
      {...attributes}
      {...listeners}
    >
      <div className={isDragging ? "opacity-0" : ""}>
        <ImageCard item={item} {...cardProps} />
      </div>
    </div>
  );
}

/** Galeria ordenável por arrastar e soltar, no mesmo padrão da galeria de produtos. */
export function GaleriaMidia({
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
  readOnly,
  uploadLabel = "Enviar imagens",
  uploadDisabledReason,
  onUpload,
  onReorder,
  onReorderEnd,
  onRemovePendente,
  onDefinirPrincipal,
  onRemoverImagem,
}: Props) {
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeActionsKey, setActiveActionsKey] = useState<string | null>(null);
  const confirmImage = imagens.find((img) => img.id === confirmRemoveId);
  const hasImages = imagens.length > 0 || pendentes.length > 0;
  const uploadDisabled = !onUpload || pendentes.length === 0 || uploading || savingOrder;
  const busy = uploading || savingOrder;

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
      alt: pending?.file.name ?? image?.nome ?? (image ? `Imagem ${image.id}` : "Imagem"),
      progressValue: pending ? uploadProgressByPendingId[pending.id] ?? 0 : 0,
    };
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveActionsKey(null);
    setActiveId(String(event.active.id));
  };

  const reorderFromDragEvent = (event: DragOverEvent | DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return null;
    const oldIndex = items.findIndex((item) => item.key === active.id);
    const newIndex = items.findIndex((item) => item.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return null;
    const nextKeys = arrayMove(items, oldIndex, newIndex).map((item) => item.key);
    onReorder?.(nextKeys);
    return nextKeys;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const nextKeys = reorderFromDragEvent(event) ?? items.map((item) => item.key);
    setActiveId(null);
    onReorderEnd?.(nextKeys);
  };

  const confirmRemove = () => {
    if (!confirmRemoveId) return;
    onRemoverImagem?.(confirmRemoveId);
    setActiveActionsKey(null);
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
            onDragOver={reorderFromDragEvent}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext items={items.map((item) => item.key)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {items.map((item, index) => {
                  const media = getItemMedia(item);
                  return (
                    <SortableImageCard
                      key={item.key}
                      item={item}
                      disabled={busy || readOnly}
                      src={media.src}
                      alt={media.alt}
                      displayOrder={index + 1}
                      progressValue={media.progressValue}
                      imgUrlPrincipal={imgUrlPrincipal}
                      removingImageId={removingImageId}
                      definingMainImageId={definingMainImageId}
                      busy={busy}
                      readOnly={readOnly}
                      actionsVisible={activeActionsKey === item.key}
                      onToggleActions={(key) => {
                        setActiveActionsKey((current) => (current === key ? null : key));
                      }}
                      onRemovePendente={onRemovePendente}
                      onDefinirPrincipal={onDefinirPrincipal}
                      onConfirmRemove={onRemoverImagem ? setConfirmRemoveId : undefined}
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
              {pendentes.length} {pendentes.length === 1 ? "imagem pendente" : "imagens pendentes"} de envio.
            </div>

            {onUpload ? (
              <Button
                type="button"
                size="sm"
                className="gap-2 hover:cursor-pointer"
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
              A imagem será removida do imóvel e da galeria do site. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmImage ? (
            <div className="overflow-hidden rounded-md border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={confirmImage.url} alt={confirmImage.nome ?? `Imagem ${confirmImage.id}`} className="max-h-48 w-full object-cover" />
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
