"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import {
  BadgeCheck,
  DollarSign,
  Image as ImageIcon,
  Loader2,
  Package,
  PackageCheck,
  PackagePlus,
  Pencil,
  ShieldCheck,
  ShieldX,
  ShoppingCart,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { toast } from "@/lib/toast";

import ProductSelect from "@/app/(app)/components/productSelect";
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
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import formatarEmReal from "@/utils/formatarEmReal";

import type { Produto } from "../../estoque/types";
import { DialogProduto } from "../../estoque/components/dialog-produto/dialog-produto";
import { Lote, LotePeca, LotePecasKpis } from "../types";
import LoteFormFields from "./form-lote-fields";
import { TabLoteImagens } from "./tab-lote-imagens";
import { useLoteImagens } from "./use-lote-imagens";

type EditarLoteProps = {
  loteId?: number;
  isOpen: boolean;
  onUpdated?: () => void;
};

function produtoLabel(produto?: Produto | null) {
  if (!produto) return "Produto não encontrado";
  return [produto.titulo, produto.referencia ? `Ref. ${produto.referencia}` : null]
    .filter(Boolean)
    .join(" - ");
}

function ConservacaoBadge({ value }: { value?: string | null }) {
  if (value === "NOVO") {
    return (
      <Badge variant="outline" className="gap-1">
        <BadgeCheck className="h-3 w-3 text-primary" />
        Novo
      </Badge>
    );
  }
  if (value === "USADO") {
    return (
      <Badge variant="outline" className="gap-1">
        <ShieldX className="h-3 w-3 text-yellow-500" />
        Usado
      </Badge>
    );
  }
  if (value === "RECONDICIONADO") {
    return (
      <Badge variant="outline" className="gap-1">
        <ShieldCheck className="h-3 w-3 text-emerald-500" />
        Recondicionado
      </Badge>
    );
  }
  return null;
}

const KPIS_VAZIOS: LotePecasKpis = {
  totalPecas: 0,
  pecasVendidas: 0,
  quantidadeVendida: 0,
  valorCompra: 0,
  valorPecas: 0,
  valorApurado: 0,
  valorDisponivel: 0,
  resultadoApurado: 0,
  resultadoPotencial: 0,
};

type PecasSnapshot = {
  pecas: LotePeca[];
  pecasKpis: LotePecasKpis;
};

type KpiCardProps = {
  titulo: string;
  valor: React.ReactNode;
  detalhe: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  destaque?: "success" | "danger";
};

function KpiCard({ titulo, valor, detalhe, icon: Icon, destaque }: KpiCardProps) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {titulo}
          </p>
          <p
            className={`mt-1 truncate text-lg font-semibold ${
              destaque === "success"
                ? "text-emerald-600 dark:text-emerald-400"
                : destaque === "danger"
                  ? "text-destructive"
                  : "text-foreground"
            }`}
          >
            {valor}
          </p>
        </div>
        <span className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{detalhe}</p>
    </div>
  );
}

export default function EditarLote({ loteId, isOpen, onUpdated }: EditarLoteProps) {
  const [selectedLote, setSelectedLote] = React.useState<Lote | undefined>(undefined);
  const [isLoadingLote, setIsLoadingLote] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [currentTab, setCurrentTab] = React.useState("Geral");
  const [productSelectOpen, setProductSelectOpen] = React.useState(false);
  const [linkingProductId, setLinkingProductId] = React.useState<number | null>(null);
  const [pecaToRemove, setPecaToRemove] = React.useState<LotePeca | null>(null);
  const [removingPecaId, setRemovingPecaId] = React.useState<number | null>(null);
  const [editingProductId, setEditingProductId] = React.useState<number | undefined>();
  const [productDialogOpen, setProductDialogOpen] = React.useState(false);
  const [isRefreshingPecas, setIsRefreshingPecas] = React.useState(false);

  const pecas = selectedLote?.pecas ?? [];
  const pecasKpis = selectedLote?.pecasKpis ?? {
    ...KPIS_VAZIOS,
    valorCompra: Number(selectedLote?.valor_compra ?? 0),
  };

  const aplicarSnapshotPecas = React.useCallback((snapshot: PecasSnapshot) => {
    setSelectedLote((current) =>
      current
        ? { ...current, pecas: snapshot.pecas, pecasKpis: snapshot.pecasKpis }
        : current,
    );
  }, []);

  const atualizarSomentePecas = React.useCallback(async () => {
    if (!loteId) return;
    setIsRefreshingPecas(true);
    try {
      const response = await axios.get<PecasSnapshot>(`/api/lotes/${loteId}/pecas`);
      aplicarSnapshotPecas(response.data);
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao atualizar peças", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    } finally {
      setIsRefreshingPecas(false);
    }
  }, [aplicarSnapshotPecas, loteId]);

  const handleGetLote = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!loteId) return;

    if (!options?.silent) setIsLoadingLote(true);
    try {
      const response = await axios.get<{ lote: Lote }>(`/api/lotes/${loteId}`);
      if (response.status === 200) {
        setSelectedLote(response.data.lote);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? "Falha ao buscar lote",
        });
      }
    } finally {
      if (!options?.silent) setIsLoadingLote(false);
    }
  }, [loteId]);

  const imagensHook = useLoteImagens({
    loteId,
    onAfterChangeCapa: () => handleGetLote({ silent: true }),
  });

  React.useEffect(() => {
    if (isOpen && loteId) void handleGetLote();
    if (!isOpen) {
      setSelectedLote(undefined);
      setCurrentTab("Geral");
      setProductSelectOpen(false);
      setPecaToRemove(null);
      setLinkingProductId(null);
      setRemovingPecaId(null);
      setEditingProductId(undefined);
      setProductDialogOpen(false);
    }
  }, [handleGetLote, isOpen, loteId]);

  const handleUpdateLote = async () => {
    if (!selectedLote?.id) return;

    setIsSubmitting(true);
    try {
      const response = await axios.put(`/api/lotes/${selectedLote.id}`, {
        selectedLote,
      });
      if (response.status === 200) {
        if (
          imagensHook.ordemAlterada &&
          imagensHook.imagensPendentes.length === 0
        ) {
          await imagensHook.salvarOrdem();
        }

        toast.success("Sucesso!", {
          description: "Lote atualizado.",
          duration: 2000,
        });
        await handleGetLote({ silent: true });
        onUpdated?.();
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? "Falha ao atualizar lote",
          duration: 2000,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const vincularProduto = async (produto: Produto) => {
    if (!selectedLote?.id || !produto.id) return;
    if (linkingProductId != null) return;

    setLinkingProductId(produto.id);
    try {
      const response = await axios.post<PecasSnapshot & { peca: LotePeca }>(`/api/lotes/${selectedLote.id}/pecas`, {
        produtoId: produto.id,
      });
      aplicarSnapshotPecas(response.data);
      toast.success("Peça vinculada ao lote.");
      onUpdated?.();
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao vincular peça", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    } finally {
      setLinkingProductId(null);
    }
  };

  const removerPeca = async (peca: LotePeca) => {
    if (!selectedLote?.id) return;
    if (removingPecaId != null) return;

    setRemovingPecaId(peca.id);
    try {
      const response = await axios.delete<PecasSnapshot>(`/api/lotes/${selectedLote.id}/pecas`, {
        params: { relationId: peca.id },
      });
      aplicarSnapshotPecas(response.data);
      setPecaToRemove(null);
      toast.success("Peça removida do lote.");
      onUpdated?.();
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao remover peça", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    } finally {
      setRemovingPecaId(null);
    }
  };

  return (
    <DialogContent className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[850px] sm:w-[95vw] sm:max-w-[1100px] sm:min-w-0">
      <div className="flex h-full min-h-0 flex-col">
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <DialogTitle className="text-sm sm:text-lg">
            Lote
            <span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">
              | #{loteId}
            </span>
          </DialogTitle>
          <DialogDescription>
            Edite os dados do lote de desmanche e gerencie as peças vinculadas
          </DialogDescription>
        </DialogHeader>

        {isLoadingLote ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : selectedLote ? (
          <Tabs
            value={currentTab}
            onValueChange={setCurrentTab}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="shrink-0 overflow-x-auto border-b bg-background px-4 py-2 sm:px-6">
              <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                <TabsTrigger
                  value="Geral"
                  className="h-9 rounded-xl px-4 text-xs data-[state=active]:shadow-sm sm:text-sm"
                >
                  Geral
                </TabsTrigger>
                <TabsTrigger
                  value="Pecas"
                  className="h-9 rounded-xl px-4 text-xs data-[state=active]:shadow-sm sm:text-sm"
                >
                  Peças
                </TabsTrigger>
                <TabsTrigger
                  value="Imagens"
                  className="h-9 rounded-xl px-4 text-xs data-[state=active]:shadow-sm sm:text-sm"
                >
                  <span className="flex items-center gap-2">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Imagens
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent
              value="Geral"
              className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6"
            >
              <LoteFormFields
                lote={selectedLote}
                setLote={setSelectedLote}
                isOpen={isOpen}
              />
            </TabsContent>

            <TabLoteImagens
              mode="edit"
              carregando={imagensHook.carregandoImagens}
              subindo={imagensHook.subindoImagens}
              salvandoOrdem={imagensHook.salvandoOrdem}
              removendoImagemId={imagensHook.removendoImagemId}
              definindoCapaImagemId={imagensHook.definindoCapaImagemId}
              imagens={imagensHook.imagens}
              pendentes={imagensHook.imagensPendentes}
              ordemItens={imagensHook.ordemItens}
              progressoUpload={imagensHook.uploadProgressByPendingId}
              imgUrlPrincipal={selectedLote.imgUrl ?? null}
              saving={isSubmitting}
              onPick={imagensHook.onPick}
              onUpload={imagensHook.uploadPendentes}
              onReordenar={imagensHook.reordenarItens}
              onRemoverPendente={imagensHook.removerImagemPendente}
              onDefinirPrincipal={imagensHook.definirImagemPrincipal}
              onRemover={imagensHook.removerImagem}
            />

            <TabsContent
              value="Pecas"
              className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                  titulo="Investimento no lote"
                  valor={formatarEmReal(pecasKpis.valorCompra)}
                  detalhe="Valor de compra do veículo"
                  icon={WalletCards}
                />
                <KpiCard
                  titulo="Valor das peças"
                  valor={formatarEmReal(pecasKpis.valorPecas)}
                  detalhe={`${pecasKpis.totalPecas} peça${pecasKpis.totalPecas === 1 ? "" : "s"} relacionada${pecasKpis.totalPecas === 1 ? "" : "s"}`}
                  icon={Package}
                />
                <KpiCard
                  titulo="Valor apurado"
                  valor={formatarEmReal(pecasKpis.valorApurado)}
                  detalhe="Somente vendas pagas ou finalizadas"
                  icon={DollarSign}
                  destaque={pecasKpis.valorApurado > 0 ? "success" : undefined}
                />
                <KpiCard
                  titulo="Valor a realizar"
                  valor={formatarEmReal(pecasKpis.valorDisponivel)}
                  detalhe="Preço anunciado das peças ainda não vendidas"
                  icon={TrendingUp}
                />
                <KpiCard
                  titulo="Peças vendidas"
                  valor={`${pecasKpis.pecasVendidas} / ${pecasKpis.totalPecas}`}
                  detalhe={`${pecasKpis.quantidadeVendida} unidade${pecasKpis.quantidadeVendida === 1 ? "" : "s"} em vendas concluídas`}
                  icon={ShoppingCart}
                />
                <KpiCard
                  titulo="Resultado atual"
                  valor={formatarEmReal(pecasKpis.resultadoApurado)}
                  detalhe={`Potencial: ${formatarEmReal(pecasKpis.resultadoPotencial)}`}
                  icon={PackageCheck}
                  destaque={pecasKpis.resultadoApurado >= 0 ? "success" : "danger"}
                />
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">Peças relacionadas</h3>
                      {isRefreshingPecas ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cada peça pode pertencer a apenas um lote de desmanche.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setProductSelectOpen(true)}
                    disabled={linkingProductId != null}
                  >
                    {linkingProductId != null ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <PackagePlus className="mr-2 h-4 w-4" />
                    )}
                    Vincular peça
                  </Button>
                </div>

                <ProductSelect
                  open={productSelectOpen}
                  setOpen={setProductSelectOpen}
                  OnSelect={vincularProduto}
                >
                  <span className="hidden" />
                </ProductSelect>

                {pecas.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Nenhuma peça vinculada a este lote.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {pecas.map((peca) => (
                      <div
                        key={peca.id}
                        className="group flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4 transition-colors hover:border-primary/40"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="shrink-0 rounded-lg bg-primary/10 p-2.5 text-primary">
                            <Package className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="min-w-0 truncate text-sm font-semibold">
                                {peca.produto?.titulo ?? "Produto não encontrado"}
                              </p>
                              {Number(peca.quantidade_vendida ?? 0) > 0 ? (
                                <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
                                  Vendida
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {[
                                peca.produto?.referencia ? `Ref. ${peca.produto.referencia}` : null,
                                peca.produto?.fabricante,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Sem referência informada"}
                            </p>
                          </div>
                          <ConservacaoBadge value={peca.produto?.conservacao} />
                        </div>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/40 p-3 text-xs">
                          <div>
                            <p className="text-muted-foreground">Preço anunciado</p>
                            <p className="mt-0.5 font-medium">
                              {formatarEmReal(Number(peca.produto?.precovenda ?? 0))}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Estoque atual</p>
                            <p className="mt-0.5 font-medium">{peca.produto?.estoque ?? 0}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Quantidade vendida</p>
                            <p className="mt-0.5 font-medium">{peca.quantidade_vendida ?? 0}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Valor apurado</p>
                            <p className="mt-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                              {formatarEmReal(Number(peca.valor_apurado ?? 0))}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 border-t pt-3">
                          <span className="text-[11px] text-muted-foreground">
                            {peca.vendas_realizadas ?? 0} venda
                            {peca.vendas_realizadas === 1 ? "" : "s"} concluída
                            {peca.vendas_realizadas === 1 ? "" : "s"}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => {
                                if (!peca.produto_id) return;
                                setEditingProductId(peca.produto_id);
                                setProductDialogOpen(true);
                              }}
                            >
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              Editar peça
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setPecaToRemove(peca)}
                              disabled={removingPecaId != null}
                              aria-label="Remover peça"
                            >
                              {removingPecaId === peca.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-destructive" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Lote não encontrado.
          </div>
        )}

        <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
          <div className="flex w-full flex-row justify-end gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 min-w-24 hover:cursor-pointer"
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={handleUpdateLote}
              disabled={isSubmitting || isLoadingLote || !selectedLote}
              className="h-9 min-w-24 text-sm hover:cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </div>
        </DialogFooter>
      </div>

      <AlertDialog
        open={Boolean(pecaToRemove)}
        onOpenChange={(open) => {
          if (!open && removingPecaId == null) setPecaToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover peça do lote?</AlertDialogTitle>
            <AlertDialogDescription>
              A peça <strong>{produtoLabel(pecaToRemove?.produto)}</strong> será removida da relação
              com este veículo. O produto continuará cadastrado no estoque.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingPecaId != null}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pecaToRemove || removingPecaId != null}
              onClick={(event) => {
                event.preventDefault();
                if (pecaToRemove) void removerPeca(pecaToRemove);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removingPecaId != null ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Removendo
                </span>
              ) : (
                "Remover relação"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DialogProduto
        productId={editingProductId}
        isOpen={productDialogOpen}
        setIsOpen={setProductDialogOpen}
        setSelectedProductId={setEditingProductId}
        onAfterSaveProduct={() => void atualizarSomentePecas()}
      />
    </DialogContent>
  );
}
