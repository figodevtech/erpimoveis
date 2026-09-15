"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Camera, CheckCircle2, Image as ImageIcon, Plus, Upload } from "lucide-react";
import { toast } from "@/lib/toast";
import { prepareProductImageForUpload, productImageUploadError } from "@/lib/product-image-upload";
import {
  getMercadoLivrePictureRequirement,
  mercadoLivrePictureRequirementMessage,
  MIN_MERCADO_LIVRE_LISTING_PICTURES,
  parseMercadoLivrePictureUrls,
} from "@/lib/integrations/mercadolivre-listing-pictures";
import {
  ProdutoImagensGallery,
  type ProdutoImagemPendente,
} from "@/app/(app)/(pages)/estoque/components/dialog-produto/tabs/produto-imagens-gallery";

/**
 * Mídia do anúncio Mercado Livre: mesma galeria da aba de imagens do produto,
 * porém operando sobre a lista ordenada de URLs públicas que vai no anúncio.
 *
 * A primeira imagem da lista é a capa enviada ao Mercado Livre. As fotos do
 * produto entram pelo link que já existe no ERP, sem cópia. Enviar um arquivo
 * manda a foto direto para o Mercado Livre: ela fica só no anúncio e não entra
 * no cadastro do produto. Remover aqui também só tira a foto do anúncio.
 */

export const parseListingPictureUrls = parseMercadoLivrePictureUrls;

type Props = {
  /** URLs do anúncio, uma por linha — o mesmo formato do campo `pictureUrl`. */
  value: string;
  onChange: (value: string) => void;
  /** Imagens já cadastradas no produto, oferecidas como atalho. */
  productImageUrls?: string[];
  disabled?: boolean;
  /** Explica por que a edição está bloqueada (regra do Mercado Livre, por exemplo). */
  disabledReason?: string | null;
};

export function ListingMediaManager({
  value,
  onChange,
  productImageUrls = [],
  disabled = false,
  disabledReason = null,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [pendentes, setPendentes] = useState<ProdutoImagemPendente[]>([]);
  const [progresso, setProgresso] = useState<Record<string, number>>({});
  const [subindo, setSubindo] = useState(false);

  const pendentesRef = useRef<ProdutoImagemPendente[]>([]);
  useEffect(() => {
    pendentesRef.current = pendentes;
  }, [pendentes]);

  // A galeria identifica cada card por id numérico. Uma URL mantém o mesmo id
  // enquanto estiver na lista, senão o arrastar perderia a referência no meio
  // do gesto (a reordenação acontece durante o drag, não só ao soltar).
  const idsRef = useRef(new Map<string, number>());
  const nextIdRef = useRef(1);
  const pictureRequirement = useMemo(() => getMercadoLivrePictureRequirement(value), [value]);
  const urls = pictureRequirement.urls;

  const imagens = useMemo(() => {
    const ids = idsRef.current;
    for (const url of urls) {
      if (!ids.has(url)) ids.set(url, nextIdRef.current++);
    }
    for (const url of Array.from(ids.keys())) {
      if (!urls.includes(url)) ids.delete(url);
    }
    return urls.map((url, index) => ({ id: ids.get(url) as number, url, ordem: index }));
  }, [urls]);

  // A ordem visual inclui os pendentes, para que arrastar um arquivo ainda não
  // enviado até o meio da lista não faça o card saltar de volta.
  const [ordemVisual, setOrdemVisual] = useState<string[]>([]);
  const orderKeys = useMemo(() => {
    const validas = new Set([
      ...imagens.map((image) => `img-${image.id}`),
      ...pendentes.map((item) => `pending-${item.id}`),
    ]);
    const mantidas = ordemVisual.filter((key) => validas.has(key));
    const novas = Array.from(validas).filter((key) => !mantidas.includes(key));
    return [...mantidas, ...novas];
  }, [imagens, ordemVisual, pendentes]);

  const commit = useCallback((nextUrls: string[]) => {
    onChange(Array.from(new Set(nextUrls)).join("\n"));
  }, [onChange]);

  const adicionarUrls = useCallback(
    (novas: string[]) => {
      const validas = novas.map((url) => url.trim()).filter(Boolean);
      if (!validas.length) return 0;
      const atuais = new Set(urls);
      const inéditas = validas.filter((url) => !atuais.has(url));
      if (!inéditas.length) return 0;
      commit([...urls, ...inéditas]);
      return inéditas.length;
    },
    [commit, urls],
  );

  function handleReorder(keys: string[]) {
    setOrdemVisual(keys);
    const porId = new Map(imagens.map((image) => [`img-${image.id}`, image.url]));
    const ordenadas = keys.map((key) => porId.get(key)).filter(Boolean) as string[];
    if (ordenadas.length !== imagens.length) return;
    commit(ordenadas);
  }

  function handleRemover(id: number) {
    const alvo = imagens.find((image) => image.id === id);
    if (!alvo) return;
    commit(urls.filter((url) => url !== alvo.url));
  }

  function handleDefinirCapa(id: number) {
    const alvo = imagens.find((image) => image.id === id);
    if (!alvo) return;
    commit([alvo.url, ...urls.filter((url) => url !== alvo.url)]);
  }

  function handlePick(files: File[]) {
    if (!files.length) return;
    const novas = files.map((file) => ({
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendentes((current) => [...current, ...novas]);
  }

  function removerPendente(id: string) {
    setPendentes((current) => {
      const alvo = current.find((item) => item.id === id);
      if (alvo) URL.revokeObjectURL(alvo.previewUrl);
      return current.filter((item) => item.id !== id);
    });
    setProgresso((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function enviarPendentes() {
    const fila = [...pendentesRef.current];
    if (!fila.length) return;

    setSubindo(true);
    const enviadas: string[] = [];
    const falhas: string[] = [];
    // A lista final é montada a partir da ordem da galeria, para que a posição
    // escolhida no arrasto seja exatamente a ordem enviada ao Mercado Livre.
    let ordem = [...orderKeys];
    const urlPorChave = new Map(imagens.map((image) => [`img-${image.id}`, image.url]));

    try {
      for (const pendente of fila) {
        try {
          const arquivo = await prepareProductImageForUpload(pendente.file);
          const formData = new FormData();
          formData.append("files", arquivo);

          const response = await axios.post("/api/integracoes/mercadolivre/pictures", formData, {
            onUploadProgress: (event) => {
              const total = event.total ?? arquivo.size;
              const pct = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
              setProgresso((current) => ({ ...current, [pendente.id]: pct }));
            },
          });

          const urlSalva = String(response.data?.pictures?.[0]?.url ?? "");
          if (!urlSalva) throw new Error("O Mercado Livre não devolveu o endereço da foto.");

          enviadas.push(urlSalva);
          const novoId = nextIdRef.current++;
          idsRef.current.set(urlSalva, novoId);
          urlPorChave.set(`img-${novoId}`, urlSalva);
          ordem = ordem.map((key) => (key === `pending-${pendente.id}` ? `img-${novoId}` : key));
          URL.revokeObjectURL(pendente.previewUrl);
          setPendentes((current) => current.filter((item) => item.id !== pendente.id));
          setProgresso((current) => ({ ...current, [pendente.id]: 100 }));
        } catch (error) {
          console.error(`Erro ao enviar a imagem ${pendente.file.name}:`, error);
          falhas.push(productImageUploadError(error, pendente.file.name));
          setProgresso((current) => ({ ...current, [pendente.id]: 0 }));
        }
      }

      if (enviadas.length) {
        const ordenadas = ordem.map((key) => urlPorChave.get(key)).filter(Boolean) as string[];
        const faltantes = enviadas.filter((url) => !ordenadas.includes(url));
        commit([...ordenadas, ...faltantes]);
        setOrdemVisual(ordem);
        toast.success(`${enviadas.length} imagem(ns) enviada(s) e anexada(s) ao anúncio.`);
      }
      setProgresso({});
      if (falhas.length) {
        toast.error("Algumas imagens não foram enviadas", {
          description: `${falhas.length} imagem(ns) continuam pendentes. ${falhas[0]}`,
          duration: 6000,
        });
      }
    } finally {
      setSubindo(false);
    }
  }

  useEffect(() => {
    return () => {
      pendentesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      pendentesRef.current = [];
    };
  }, []);

  const imagensDoProdutoDisponiveis = productImageUrls.filter((url) => !urls.includes(url));
  const bloqueado = disabled || subindo;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Mídia do anúncio</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Arraste para reordenar. A primeira imagem é a capa enviada ao Mercado Livre.
          </p>
          <div
            role="status"
            aria-live="polite"
            className={`mt-2 flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${
              pictureRequirement.valid
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            }`}
          >
            {pictureRequirement.valid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {pictureRequirement.count} de {MIN_MERCADO_LIVRE_LISTING_PICTURES} fotos válidas
          </div>
          {!pictureRequirement.valid ? (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {mercadoLivrePictureRequirementMessage(pictureRequirement.count)}
              {pendentes.length > 0 ? " Fotos pendentes só contam depois de concluído o envio." : ""}
            </p>
          ) : null}
          {pendentes.length > 0 ? <p className="text-xs text-muted-foreground">{pendentes.length} foto(s) pendente(s) de envio.</p> : null}
          {disabledReason ? <p className="text-xs text-amber-700 dark:text-amber-300">{disabledReason}</p> : null}
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[240px]">
          {/* Dois inputs de propósito: `capture` abre a câmera direto, mas não
              aceita `multiple`, então o envio em lote fica no input de cima. */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            multiple
            onChange={(event) => {
              handlePick(Array.from(event.target.files ?? []));
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
              handlePick(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={bloqueado}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="h-4 w-4" />
            Tirar foto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={bloqueado}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Enviar imagens
          </Button>
          {imagensDoProdutoDisponiveis.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={bloqueado}
              onClick={() => {
                const total = adicionarUrls(imagensDoProdutoDisponiveis);
                if (total) toast.success(`${total} imagem(ns) do produto adicionada(s).`);
              }}
            >
              <Plus className="h-4 w-4" />
              Usar imagens do produto ({imagensDoProdutoDisponiveis.length})
            </Button>
          ) : null}
        </div>
      </div>

      <ProdutoImagensGallery
        imagens={imagens}
        pendentes={pendentes}
        orderKeys={orderKeys}
        uploadProgressByPendingId={progresso}
        imgUrlPrincipal={urls[0] ?? null}
        emptyText="Nenhuma imagem no anúncio. Envie arquivos ou use as imagens já cadastradas no produto."
        uploading={subindo}
        uploadLabel="Enviar ao anúncio"
        removeConfirmTitle="Remover imagem do anúncio?"
        removeConfirmDescription="A imagem sai só deste anúncio do Mercado Livre. O cadastro do produto no ERP não muda."
        onUpload={enviarPendentes}
        onReorder={bloqueado ? undefined : handleReorder}
        onRemovePendente={removerPendente}
        onDefinirPrincipal={bloqueado ? undefined : handleDefinirCapa}
        onRemoverImagem={bloqueado ? undefined : handleRemover}
      />

    </div>
  );
}
