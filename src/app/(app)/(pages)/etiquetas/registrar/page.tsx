"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import axios, { isAxiosError } from "axios";
import { AlertTriangle, CheckCircle2, Edit, LinkIcon, PackageSearch, Search } from "lucide-react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import ProductSelect from "@/app/(app)/components/productSelect";
import { DialogProduto } from "../../estoque/components/dialog-produto/dialog-produto";
import { QrCodeInput } from "../../estoque/components/dialog-produto/qr-code-input";
import type { Produto } from "../../estoque/types";
import { ItemDialog } from "../../usoconsumo/components/item-dialog";
import { ItemSelectDialog, type UsoConsumoItemOption } from "../../usoconsumo/components/item-select-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/lib/toast";
import { lookupInventoryLabel, type InventoryLabelLookup, type InventoryLabelMatch } from "@/lib/inventory-labels";
import type { UsoConsumoGrupo, UsoConsumoItem } from "@/types/usoconsumo";

function errorText(error: unknown) {
  return isAxiosError(error) ? error.response?.data?.error ?? error.message : error instanceof Error ? error.message : "Erro inesperado.";
}

function ItemCard({ match, canEdit, onEdit }: { match: InventoryLabelMatch; canEdit: boolean; onEdit: () => void }) {
  const item = match.item;
  const title = match.kind === "PRODUTO" ? "Produto" : "Uso/consumo";
  if (match.restricted || !item) {
    return (
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Etiqueta já utilizada</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Esta etiqueta pertence ao módulo {title}, ao qual seu perfil não possui acesso.</CardContent></Card>
    );
  }
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div><Badge variant="outline">{title}</Badge><CardTitle className="mt-2 text-base">{item.titulo || `${title} #${item.id}`}</CardTitle></div>
        {canEdit ? <Button size="sm" variant="outline" onClick={onEdit}><Edit className="mr-2 h-4 w-4" />Editar</Button> : null}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
        <p><strong>ID:</strong> #{item.id}</p><p><strong>Encontrado por:</strong> {match.matchBy === "CODIGOBARRAS" ? "Código de barras" : "Etiqueta"}</p>
        <p><strong>Referência:</strong> {item.referencia || "—"}</p><p><strong>Local:</strong> {item.local || "—"}</p>
        <p><strong>Estoque:</strong> {item.estoque ?? 0} {item.unidade || ""}</p><p><strong>Status:</strong> {item.status_estoque || "—"}</p>
      </CardContent>
    </Card>
  );
}

function RegistrarEtiquetaContent() {
  const searchParams = useSearchParams();
  const origin = searchParams.get("origem")?.toLowerCase();
  const { data: session } = useSession();
  const permissions = (session?.user as { permissoes?: unknown })?.permissoes;
  const canEditProduct = permissionSetHas(permissions, PERMS.ESTOQUE_EDITAR);
  const canEditUse = permissionSetHas(permissions, PERMS.USOCONSUMO_EDITAR);

  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<InventoryLabelLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Produto | null>(null);
  const [selectedUse, setSelectedUse] = useState<UsoConsumoItemOption | null>(null);
  const [productSelectOpen, setProductSelectOpen] = useState(false);
  const [useSelectOpen, setUseSelectOpen] = useState(false);
  const [productEditId, setProductEditId] = useState<number | null>(null);
  const [useEditItem, setUseEditItem] = useState<UsoConsumoItem | null>(null);
  const [groups, setGroups] = useState<UsoConsumoGrupo[]>([]);

  const loadGroups = useCallback(async () => {
    if (!permissionSetHas(permissions, PERMS.USOCONSUMO)) return;
    const { data } = await axios.get("/api/usoconsumo/grupos");
    setGroups(data.data ?? []);
  }, [permissions]);

  useEffect(() => { void loadGroups().catch(() => undefined); }, [loadGroups]);

  const runLookup = useCallback(async (notify = true) => {
    const normalized = code.trim();
    if (!normalized) return null;
    setLoading(true);
    try {
      const result = await lookupInventoryLabel(normalized);
      setLookup(result);
      setSelectedProduct(null);
      setSelectedUse(null);
      if (notify) {
        const hasProductLabel = result.matches.some((match) => match.kind === "PRODUTO" && match.matchBy !== "CODIGOBARRAS");
        const hasUseLabel = result.matches.some((match) => match.kind === "USOCONSUMO" && match.matchBy !== "CODIGOBARRAS");
        if (origin === "produto" && hasUseLabel) toast.error("Etiqueta já utilizada", { description: "Já existe um item de uso e consumo com esta etiqueta." });
        else if (origin === "usoconsumo" && hasProductLabel) toast.error("Etiqueta já utilizada", { description: "Já existe um produto com esta etiqueta." });
        else if (result.status === "CONFLICT") toast.error("Etiqueta ambígua", { description: "O código está vinculado a mais de um item. Corrija o conflito antes de continuar." });
      }
      return result;
    } catch (error) {
      toast.error("Não foi possível consultar a etiqueta.", { description: errorText(error) });
      return null;
    } finally {
      setLoading(false);
    }
  }, [code, origin]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await runLookup(true);
  }

  async function bindProduct() {
    if (!selectedProduct?.id || !lookup || lookup.status !== "AVAILABLE") return;
    setSaving(true);
    try {
      const { data } = await axios.get(`/api/products/${selectedProduct.id}`);
      const current = data.data as Produto;
      await axios.patch(`/api/products/${selectedProduct.id}`, { changes: { etiqueta: { original: current.etiqueta ?? null, value: lookup.code } } });
      toast.success("Etiqueta vinculada ao produto.");
      await runLookup(false);
    } catch (error) { toast.error("Não foi possível vincular a etiqueta.", { description: errorText(error) }); }
    finally { setSaving(false); }
  }

  async function bindUse() {
    if (!selectedUse?.id || !lookup || lookup.status !== "AVAILABLE") return;
    setSaving(true);
    try {
      const { data } = await axios.get(`/api/usoconsumo/itens/${selectedUse.id}`);
      const current = data.data as UsoConsumoItem;
      await axios.patch(`/api/usoconsumo/itens/${selectedUse.id}`, { etiqueta: lookup.code, expectedUpdatedAt: current.updated_at });
      toast.success("Etiqueta vinculada ao item de uso/consumo.");
      await runLookup(false);
    } catch (error) { toast.error("Não foi possível vincular a etiqueta.", { description: errorText(error) }); }
    finally { setSaving(false); }
  }

  const found = lookup?.matches ?? [];
  const available = lookup?.status === "AVAILABLE";
  const canChooseAny = canEditProduct || canEditUse;
  const description = useMemo(() => origin === "usoconsumo"
    ? "Consulte ou vincule uma etiqueta a um produto ou item de uso/consumo."
    : "Leia o QR Code e identifique automaticamente a qual estoque a etiqueta pertence.", [origin]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div><h1 className="text-xl font-semibold">Registro/Consulta de Etiqueta</h1><p className="text-sm text-muted-foreground">{description}</p></div>
      <form className="space-y-3 rounded-lg border bg-card p-4" onSubmit={submit}>
        <QrCodeInput id="consultar-etiqueta-compartilhada" label="Etiqueta ou código de barras" value={code} placeholder="Leia o QR Code ou informe o código" loading={loading} loadingLabel="Consultando" uppercase onChange={(value) => { setCode(value); setLookup(null); }} />
        <Button className="w-full" type="submit" disabled={!code.trim() || loading}><Search className="mr-2 h-4 w-4" />Consultar</Button>
      </form>

      {lookup?.status === "CONFLICT" ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Conflito de identificação</AlertTitle><AlertDescription>Este código corresponde a mais de um registro. Nenhuma alteração será permitida até que as etiquetas duplicadas sejam corrigidas.</AlertDescription></Alert> : null}
      {found.map((match, index) => <ItemCard key={`${match.kind}-${match.item?.id ?? "restricted"}-${index}`} match={match} canEdit={match.kind === "PRODUTO" ? canEditProduct : canEditUse} onEdit={() => match.kind === "PRODUTO" ? setProductEditId(match.item?.id ?? null) : setUseEditItem(match.item as UsoConsumoItem)} />)}

      {available ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Etiqueta disponível</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!canChooseAny ? <p className="text-sm text-muted-foreground">Seu perfil pode consultar, mas não possui permissão para vincular etiquetas.</p> : null}
            {canEditProduct ? <div className="flex flex-col gap-2 sm:flex-row"><ProductSelect open={productSelectOpen} setOpen={setProductSelectOpen} OnSelect={(item) => setSelectedProduct(item)}><Button type="button" variant="outline" className="flex-1 justify-start"><PackageSearch className="mr-2 h-4 w-4" />{selectedProduct?.titulo || "Selecionar produto"}</Button></ProductSelect><Button type="button" disabled={!selectedProduct || saving} onClick={bindProduct}><LinkIcon className="mr-2 h-4 w-4" />Vincular ao produto</Button></div> : null}
            {canEditUse ? <div className="flex flex-col gap-2 sm:flex-row"><ItemSelectDialog open={useSelectOpen} setOpen={setUseSelectOpen} onSelect={setSelectedUse}><Button type="button" variant="outline" className="flex-1 justify-start"><PackageSearch className="mr-2 h-4 w-4" />{selectedUse?.titulo || "Selecionar item de uso/consumo"}</Button></ItemSelectDialog><Button type="button" disabled={!selectedUse || saving} onClick={bindUse}><LinkIcon className="mr-2 h-4 w-4" />Vincular ao uso/consumo</Button></div> : null}
          </CardContent>
        </Card>
      ) : null}

      {productEditId ? <DialogProduto productId={productEditId} isOpen setIsOpen={(open) => !open && setProductEditId(null)} onAfterSaveProduct={() => void runLookup(false)} /> : null}
      <ItemDialog open={useEditItem !== null} item={useEditItem} grupos={groups} onOpenChange={(open) => !open && setUseEditItem(null)} onSaved={async () => { await runLookup(false); }} onGroupsChanged={loadGroups} />
    </div>
  );
}

export default function RegistrarEtiquetaPage() {
  return <Suspense fallback={<div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">Carregando leitor de etiquetas...</div>}><RegistrarEtiquetaContent /></Suspense>;
}
