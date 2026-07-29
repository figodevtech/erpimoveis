"use client";

import axios, { isAxiosError } from "axios";
import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Boxes, Image as ImageIcon, Info, MapPin, Package, Plus, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toast } from "@/lib/toast";
import type { UsoConsumoGrupo, UsoConsumoItem } from "@/types/usoconsumo";
import { useConfig } from "../../config-context";
import ValueInput from "../../estoque/components/dialog-produto/entrada-valor";
import { ProductDialogLayout } from "../../estoque/components/dialog-produto/tabs/dialog-layout";
import { QrCodeInput } from "../../estoque/components/dialog-produto/qr-code-input";
import { TagInput } from "../../estoque/components/dialog-produto/tag-input";
import { ItemImagesTab } from "./item-images-tab";
import { useItemImages } from "./use-item-images";
import { ItemMovementsTab, type UsoConsumoEntradaMovimento, type UsoConsumoSaidaMovimento } from "./item-movements-tab";

type Detail = UsoConsumoItem & {
  entradas?: UsoConsumoEntradaMovimento[];
  saidas?: UsoConsumoSaidaMovimento[];
};

type Props = {
  open: boolean;
  item: UsoConsumoItem | null;
  grupos: UsoConsumoGrupo[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  onGroupsChanged: () => Promise<void>;
  initialValues?: Partial<Form>;
  onSelectedItemId?: (id: number) => void;
};

type Form = Record<string, string | number | null> & {
  titulo: string;
  grupo_id: string | number | null;
  estoqueInicial: number;
};

const EMPTY: Form = {
  titulo: "",
  descricao: "",
  referencia: "",
  fabricante: "",
  grupo_id: "",
  unidade: "UN",
  conservacao: "NOVO",
  codigobarras: "",
  etiqueta: "",
  local: "",
  estoqueInicial: 0,
  estoqueminimo: 0,
  precocompra: 0,
  ncm: "",
  cest: "",
  cfop_entrada: "",
  origem_mercadoria: "",
  csosn: "",
  cst: "",
  aliquotaicms: "",
  cst_pis: "",
  aliquota_pis: "",
  modo_pis: "",
  aliquota_por_unidade_pis: "",
  cst_cofins: "",
  aliquota_cofins: "",
  modo_cofins: "",
  aliquota_por_unidade_cofins: "",
  cst_ibscbs: "",
  cclass_trib: "",
  aliquota_ibs_uf: "",
  aliquota_ibs_municipio: "",
  aliquota_cbs: "",
};

const TAB_THEME =
  "group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground";

function errorText(error: unknown) {
  return isAxiosError(error)
    ? error.response?.data?.error ?? error.message
    : "Ocorreu um erro inesperado.";
}

function statusBadge(status: UsoConsumoItem["status_estoque"] | "SEM_ESTOQUE") {
  if (status === "CRITICO") return <Badge variant="destructive">CRITICO</Badge>;
  if (status === "BAIXO") return <Badge variant="secondary" className="bg-yellow-600 not-dark:text-white">BAIXO</Badge>;
  if (status === "SEM_ESTOQUE") return <Badge variant="secondary" className="bg-purple-800 not-dark:text-white">SEM_ESTOQUE</Badge>;
  return <Badge variant="outline">OK</Badge>;
}

function ItemDialogContent({ item, grupos, onOpenChange, onSaved, onGroupsChanged, initialValues, onSelectedItemId, isDesktop }: Omit<Props, "open"> & { isDesktop: boolean }) {
  const [form, setForm] = useState<Form>({ ...EMPTY });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(Boolean(item));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentTab, setCurrentTab] = useState("Geral");

  const loadDetail = useCallback(async (id: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await axios.get(`/api/usoconsumo/itens/${id}`);
      const loaded = data.data as Detail;
      setDetail(loaded);
      const next = { ...EMPTY } as Form;
      for (const key of Object.keys(EMPTY)) {
        if (key === "estoqueInicial") continue;
        next[key] = (loaded as unknown as Record<string, string | number | null>)[key] ?? "";
      }
      next.grupo_id = loaded.grupo_id ?? "";
      next.estoqueInicial = 0;
      setForm(next);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshMetadata = useCallback(async () => {
    if (!item) return;
    const { data } = await axios.get(`/api/usoconsumo/itens/${item.id}`);
    const fresh = data.data as Detail;
    setDetail((current) => current ? {
      ...current,
      img_url: fresh.img_url,
      updated_at: fresh.updated_at,
    } : fresh);
  }, [item]);

  const imageHook = useItemImages({ itemId: item?.id, onAfterMutation: refreshMetadata });

  useEffect(() => {
    setCurrentTab("Geral");
    setDetail(null);
    setLoadError(null);
    if (item) {
      void loadDetail(item.id);
    } else {
      setLoading(false);
      const definedInitialValues = Object.fromEntries(
        Object.entries(initialValues ?? {}).filter(([, value]) => value !== undefined),
      );
      setForm({ ...EMPTY, ...definedInitialValues } as Form);
    }
  }, [item, initialValues, loadDetail]);

  const field = useCallback((name: string, value: string | number | null) => {
    setForm((current) => ({ ...current, [name]: value }));
  }, []);

  async function save(registerAgain = false) {
    if (!String(form.titulo).trim()) {
      setCurrentTab("Geral");
      toast.error("Informe o título do item.");
      return;
    }

    setSaving(true);
    try {
      const payload = { ...form, grupo_id: form.grupo_id || null };
      if (item) {
        const { estoqueInicial: _, ...changes } = payload;
        void _;
        const { data } = await axios.patch(`/api/usoconsumo/itens/${item.id}`, {
          ...changes,
          expectedUpdatedAt: detail?.updated_at ?? item.updated_at,
        });
        if (imageHook.orderChanged && imageHook.pending.length === 0) {
          await imageHook.persistOrder();
        }
        toast.success("Item atualizado.");
        await loadDetail(Number(data.data.id));
        await onSaved();
        return;
      }

      const { data } = await axios.post("/api/usoconsumo/itens", payload);
      const createdId = Number(data.data.id);
      await imageHook.upload(createdId);
      onSelectedItemId?.(createdId);
      toast.success("Item cadastrado.");
      await onSaved();

      if (registerAgain) {
        setForm({ ...EMPTY });
        setCurrentTab("Geral");
      } else {
        onOpenChange(false);
      }
    } catch (error) {
      toast.error("Não foi possível salvar o item.", { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  async function createGroup() {
    const nome = window.prompt("Nome do novo grupo:")?.trim();
    if (!nome) return;
    try {
      const { data } = await axios.post("/api/usoconsumo/grupos", { nome });
      await onGroupsChanged();
      field("grupo_id", Number(data.data.id));
      toast.success("Grupo criado.");
    } catch (error) {
      toast.error("Grupo não criado.", { description: errorText(error) });
    }
  }

  const titleLength = String(form.titulo).length;
  const descriptionLength = String(form.descricao).length;
  const manufacturerLength = String(form.fabricante).length;
  const currentStatus = detail?.status_estoque ?? "SEM_ESTOQUE";

  const tabs = item ? (
    <>
      <TabsTrigger onClick={() => setCurrentTab("Geral")} value="Geral" className={TAB_THEME}><span className="flex items-center gap-2"><Package className="h-3.5 w-3.5" />Geral</span></TabsTrigger>
      <TabsTrigger onClick={() => setCurrentTab("Imagens")} value="Imagens" className={TAB_THEME}><span className="flex items-center gap-2"><ImageIcon className="h-3.5 w-3.5" />Imagens</span></TabsTrigger>
      <TabsTrigger onClick={() => setCurrentTab("Etiquetas")} value="Etiquetas" className={TAB_THEME}><span className="flex items-center gap-2"><Tag className="h-3.5 w-3.5" />Localização</span></TabsTrigger>
      <TabsTrigger onClick={() => setCurrentTab("Estoque")} value="Estoque" className={TAB_THEME}><span className="flex items-center gap-2"><Boxes className="h-3.5 w-3.5" />Estoque</span></TabsTrigger>
      <TabsTrigger onClick={() => setCurrentTab("Fluxo")} value="Fluxo" className={TAB_THEME}><span className="flex items-center gap-2"><ArrowRightLeft className="h-3.5 w-3.5" />Movimentação</span></TabsTrigger>
    </>
  ) : (
    <>
      <TabsTrigger onClick={() => setCurrentTab("Geral")} value="Geral" className={TAB_THEME}><span className="flex items-center gap-2"><Package className="h-3.5 w-3.5" />Geral</span></TabsTrigger>
      <TabsTrigger onClick={() => setCurrentTab("Estoque")} value="Estoque" className={TAB_THEME}><span className="flex items-center gap-2"><Boxes className="h-3.5 w-3.5" />Estoque</span></TabsTrigger>
      <TabsTrigger onClick={() => setCurrentTab("Imagens")} value="Imagens" className={TAB_THEME}><span className="flex items-center gap-2"><ImageIcon className="h-3.5 w-3.5" />Imagens</span></TabsTrigger>
      <TabsTrigger onClick={() => setCurrentTab("Etiquetas")} value="Etiquetas" className={TAB_THEME}><span className="flex items-center gap-2"><Tag className="h-3.5 w-3.5" />Localização</span></TabsTrigger>
    </>
  );

  return (
    <ProductDialogLayout
      isDesktop={isDesktop}
      title={<>{item ? `Item #${item.id}` : "Item"}<span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">| {item ? "Edição" : "Novo"}</span></>}
      description={item ? "Preencha dados para editar um item" : "Preencha dados para registrar um novo item"}
      defaultTab="Geral"
      currentTab={currentTab}
      loading={loading}
      tabs={tabs}
      submitLabel="Salvar"
      submitLabel2={item ? undefined : "Salvar e Continuar"}
      submitting={saving}
      submitDisabled={loading || Boolean(loadError) || !String(form.titulo).trim()}
      onSubmit={save}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!loading && !loadError && (!item || detail) ? (
          <>
            <TabsContent value="Geral" className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 md:px-6 md:py-6">
              <div className="space-y-4">
                <div className="rounded-lg border bg-card p-4">
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
                    <div className="col-span-2 flex items-center space-y-2 lg:col-span-2">
                      <Label>Status do Estoque: <span className="ml-1">{statusBadge(currentStatus)}</span></Label>
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <Label>Grupo</Label>
                      <div className="flex gap-2">
                        <Select value={String(form.grupo_id || "none")} onValueChange={(value) => field("grupo_id", value === "none" ? "" : value)}>
                          <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent><SelectItem value="none">Sem grupo</SelectItem>{grupos.map((grupo) => <SelectItem className="cursor-pointer" key={grupo.id} value={String(grupo.id)}>{grupo.nome}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" title="Criar grupo" onClick={createGroup}><Plus className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <Label>Conservação</Label>
                      <Select value={String(form.conservacao)} onValueChange={(value) => field("conservacao", value)}>
                        <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>{["NOVO", "USADO", "RECONDICIONADO"].map((value) => <SelectItem className="cursor-pointer" key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border bg-card p-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2"><Label htmlFor="usoconsumo-titulo">Título *</Label><span className={`text-xs ${titleLength >= 100 ? "text-destructive" : "text-muted-foreground"}`}>{titleLength}/100</span></div>
                    <Input id="usoconsumo-titulo" value={String(form.titulo)} onChange={(event) => field("titulo", event.target.value.toLocaleUpperCase("pt-BR"))} placeholder={item ? "Nome do item" : "Título interno"} maxLength={100} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2"><Label htmlFor="usoconsumo-descricao">Descrição</Label><span className={`text-xs ${descriptionLength >= 300 ? "text-destructive" : "text-muted-foreground"}`}>{descriptionLength}/300</span></div>
                    <Textarea id="usoconsumo-descricao" value={String(form.descricao)} onChange={(event) => field("descricao", event.target.value)} placeholder="Descrição do item" maxLength={300} />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                    <div className="space-y-2 lg:col-span-2">
                      <div className="flex items-center justify-between"><Label htmlFor="usoconsumo-fabricante">Fabricante</Label><span className={`text-xs ${manufacturerLength >= 50 ? "text-destructive" : "text-muted-foreground"}`}>{manufacturerLength}/50</span></div>
                      <Input id="usoconsumo-fabricante" value={String(form.fabricante)} onChange={(event) => field("fabricante", event.target.value)} placeholder="Fabricante" maxLength={50} />
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <Label htmlFor="usoconsumo-codigo">Código de Barras</Label>
                      <Input id="usoconsumo-codigo" value={String(form.codigobarras)} onChange={(event) => field("codigobarras", event.target.value.replace(/\D/g, ""))} placeholder="7891234567890" inputMode="numeric" maxLength={14} />
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <Label>Unidade</Label>
                      <Select value={String(form.unidade)} onValueChange={(value) => field("unidade", value)}><SelectTrigger className="h-9 w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{["UN", "JGO", "KIT", "PAR", "CX", "PCT"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <Label>Valor Médio de Compra</Label>
                      <ValueInput price={Number(form.precocompra)} setPrice={(value) => field("precocompra", value)} />
                    </div>
                    <div className="space-y-2 lg:col-span-2">
                      <Label>Último Valor de Compra</Label>
                      <ValueInput disabled price={Number(detail?.ultimovalordecompra ?? 0)} />
                      <p className="text-xs text-muted-foreground">Atualizado automaticamente pelas entradas.</p>
                    </div>
                  </div>

                  <div className="space-y-2 sm:col-span-4">
                    <div className="flex items-center gap-2"><Label>Referência</Label><span className="flex items-center gap-1 text-xs italic text-muted-foreground"><Info className="h-3 w-3" />Insira ou cole tags de busca separadas por espaço.</span></div>
                    <TagInput value={String(form.referencia).split(" ").filter(Boolean)} onChange={(tags) => field("referencia", tags.join(" "))} placeholder="Ex: BOTA EPI-001" />
                  </div>
                </div>

                {item && detail ? <><Separator /><div className="grid grid-cols-1 gap-4 text-nowrap sm:grid-cols-3"><div className="flex items-center space-x-1 text-xs text-muted-foreground"><Label>Criado em:</Label><span>{new Date(detail.created_at).toLocaleString("pt-BR")}</span></div><div className="flex items-center space-x-1 text-xs text-muted-foreground"><Label>Última modificação:</Label><span>{new Date(detail.updated_at).toLocaleString("pt-BR")}</span></div></div></> : null}
              </div>
            </TabsContent>

            <TabsContent value="Estoque" className="h-full min-h-0 overflow-auto px-2 py-3 dark:bg-muted-foreground/5 md:px-6 md:py-6">
              <div className="space-y-4">
                <div className="rounded-lg border bg-card p-3 md:p-4">
                  <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
                    <div className="space-y-2"><Label>{item ? "Estoque (Qtd) *" : "Estoque Inicial (Qtd) *"}</Label><Input disabled={Boolean(item)} type="number" min={0} value={item ? item.estoque : Number(form.estoqueInicial)} onChange={(event) => field("estoqueInicial", Number(event.target.value))} /></div>
                    <div className="space-y-2"><Label>Estoque Mínimo *</Label><Input type="number" min={0} value={Number(form.estoqueminimo)} onChange={(event) => field("estoqueminimo", Number(event.target.value))} /></div>
                  </div>
                </div>
                <Separator />
                <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground"><span className="font-medium text-foreground">Regra de estoque</span><ul className="mt-2 grid gap-1 sm:grid-cols-2"><li><strong>OK:</strong> estoque acima do estoque mínimo.</li><li><strong>BAIXO:</strong> estoque igual ou abaixo do estoque mínimo.</li><li><strong>CRÍTICO:</strong> estoque atingiu a metade do estoque mínimo.</li><li><strong>SEM ESTOQUE:</strong> estoque indisponível.</li></ul></div>
              </div>
            </TabsContent>

            <ItemImagesTab
              mode={item ? "edit" : "create"}
              images={imageHook.images}
              pending={imageHook.pending}
              orderKeys={imageHook.orderKeys}
              progress={imageHook.progress}
              mainImageUrl={detail?.img_url}
              loading={imageHook.loading}
              uploading={imageHook.uploading}
              savingOrder={imageHook.savingOrder}
              removingId={imageHook.removingId}
              definingMainId={imageHook.definingMainId}
              saving={saving}
              onPick={imageHook.pick}
              onUpload={() => void imageHook.upload()}
              onReorder={imageHook.reorder}
              onRemovePending={imageHook.removePending}
              onDefineMain={(id) => void imageHook.defineMain(id)}
              onRemove={(id) => void imageHook.remove(id)}
            />

            <TabsContent value="Etiquetas" className="h-full min-h-0 space-y-4 overflow-auto px-2 py-3 dark:bg-muted-foreground/5 md:px-6 md:py-6">
              <div className="rounded-lg border bg-card p-4"><div className="mb-4 flex items-center gap-2"><Tag className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Etiquetagem</h3></div><div className="grid gap-4 md:grid-cols-2"><QrCodeInput id="usoconsumo-etiqueta" label="Etiqueta do item" value={String(form.etiqueta)} placeholder="Ex: USC-000123" uppercase onChange={(value) => field("etiqueta", value)} /><QrCodeInput id="usoconsumo-local" label="Local" value={String(form.local)} placeholder="Ex: CX-001" onChange={(value) => field("local", value)} /></div></div>
              <div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg border bg-card p-4"><div className="mb-2 flex items-center gap-2"><Tag className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-medium">Etiqueta vinculada</span></div><p className="text-sm text-muted-foreground">{String(form.etiqueta) || "Nenhuma etiqueta informada."}</p></div><div className="rounded-lg border bg-card p-4"><div className="mb-2 flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-medium">Local atual</span></div><p className="text-sm text-muted-foreground">{String(form.local) || "Nenhum local informado."}</p></div></div>
            </TabsContent>

            {item ? <ItemMovementsTab entradas={detail?.entradas} saidas={detail?.saidas} onAfterChange={async () => { await loadDetail(item.id); await onSaved(); }} /> : null}
          </>
        ) : null}

        {(loading || loadError || (item && !detail)) ? (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/95">
            {loading ? <><div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" /><span className="text-primary">Carregando...</span></> : loadError ? <><p className="font-medium text-destructive">Falha ao carregar</p><p className="max-w-[520px] text-center text-sm text-muted-foreground">{loadError}</p><Button variant="outline" onClick={() => item && void loadDetail(item.id)}>Tentar novamente</Button></> : <span className="text-muted-foreground">Item não encontrado.</span>}
          </div>
        ) : null}
      </div>
    </ProductDialogLayout>
  );
}

export function ItemDialog({ open, item, grupos, onOpenChange, onSaved, onGroupsChanged, initialValues, onSelectedItemId }: Props) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const config = useConfig();
  const desktopShell = isDesktop || !config?.habilitar_drawers;
  const key = `${item?.id ?? "new"}-${open ? "open" : "closed"}`;

  if (desktopShell) {
    return <Dialog open={open} onOpenChange={onOpenChange}>{open ? <ItemDialogContent key={key} item={item} grupos={grupos} onOpenChange={onOpenChange} onSaved={onSaved} onGroupsChanged={onGroupsChanged} initialValues={initialValues} onSelectedItemId={onSelectedItemId} isDesktop /> : null}</Dialog>;
  }

  return <Drawer open={open} onOpenChange={onOpenChange}>{open ? <ItemDialogContent key={key} item={item} grupos={grupos} onOpenChange={onOpenChange} onSaved={onSaved} onGroupsChanged={onGroupsChanged} initialValues={initialValues} onSelectedItemId={onSelectedItemId} isDesktop={false} /> : null}</Drawer>;
}
