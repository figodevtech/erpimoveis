"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import axios, { isAxiosError } from "axios";
import { AlertTriangle, CheckCircle2, LinkIcon, PackageSearch, Search } from "lucide-react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import ProductSelect from "@/app/(app)/components/productSelect";
import { DialogProduto } from "../../estoque/components/dialog-produto/dialog-produto";
import { InventoryItemFoundCard } from "../../estoque/components/inventory-item-found-card";
import { QrCodeInput } from "../../estoque/components/dialog-produto/qr-code-input";
import DialogSaida from "../../estoque/components/dialog-saida/dialog-saida-unica";
import type { Produto } from "../../estoque/types";
import { ItemDialog } from "../../usoconsumo/components/item-dialog";
import { ItemSelectDialog, type UsoConsumoItemOption } from "../../usoconsumo/components/item-select-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/lib/toast";
import { rotuloDeEscopo } from "@/lib/usoconsumo/escopo";
import {
  crossInventoryLabelMessage,
  inventoryTargetLabel,
  inventoryTargetOf,
  lookupInventoryLabel,
  type InventoryLabelLookup,
  type InventoryLabelMatch,
  type InventoryTarget,
} from "@/lib/inventory-labels";

/**
 * `?origem=` diz de qual estoque o operador saiu, e e contra ele que a etiqueta
 * repetida e comparada. Sem o parametro, so o conflito ambiguo e avisado.
 */
const ORIGEM_DA_URL: Record<string, InventoryTarget | undefined> = {
  produto: "PRODUTO",
  usoconsumo: "USOCONSUMO",
  geral: "GERAL",
};
import type { UsoConsumoGrupo, UsoConsumoItem } from "@/types/usoconsumo";

function errorText(error: unknown) {
  return isAxiosError(error) ? error.response?.data?.error ?? error.message : error instanceof Error ? error.message : "Erro inesperado.";
}

function ItemCard({
  match,
  canEdit,
  onEdit,
  canBaixa,
  onBaixa,
}: {
  match: InventoryLabelMatch;
  canEdit: boolean;
  onEdit: () => void;
  canBaixa: boolean;
  onBaixa: () => void;
}) {
  const item = match.item;
  const title = inventoryTargetLabel(inventoryTargetOf(match));
  if (match.restricted || !item) {
    return (
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Etiqueta já utilizada</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Esta etiqueta pertence ao módulo {title}, ao qual seu perfil não possui acesso.</CardContent></Card>
    );
  }
  return (
    <InventoryItemFoundCard
      estoque={inventoryTargetOf(match)}
      item={item}
      matchBy={match.matchBy}
      subtitle="Resultado da consulta de etiqueta"
      showPurchaseValues
      onEdit={canEdit ? onEdit : undefined}
      onBaixa={canBaixa ? onBaixa : undefined}
    />
  );
}

function RegistrarEtiquetaContent() {
  const searchParams = useSearchParams();
  const origin = searchParams.get("origem")?.toLowerCase();
  const { data: session } = useSession();
  const permissions = (session?.user as { permissoes?: unknown })?.permissoes;
  const canEditProduct = permissionSetHas(permissions, PERMS.ESTOQUE_EDITAR);
  const canEditUse = permissionSetHas(permissions, PERMS.USOCONSUMO_EDITAR);
  // Baixa de produto usa a mesma permissão do "Editar" (o backend de /api/estoque/saidas
  // exige ESTOQUE_EDITAR); baixa de uso/consumo tem permissão própria e independente
  // (USOCONSUMO_SAIDA), então não pode reaproveitar canEditUse.
  const canBaixaUse = permissionSetHas(permissions, PERMS.USOCONSUMO_SAIDA);

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
  const [baixaTarget, setBaixaTarget] = useState<{
    alvo: InventoryTarget;
    id: number;
    nome: string;
    estoque: number;
  } | null>(null);
  const [groups, setGroups] = useState<UsoConsumoGrupo[]>([]);

  const loadGroups = useCallback(async () => {
    if (!permissionSetHas(permissions, PERMS.USOCONSUMO)) return;
    const { data } = await axios.get("/api/usoconsumo/grupos");
    setGroups(data.data ?? []);
  }, [permissions]);

  useEffect(() => { void loadGroups().catch(() => undefined); }, [loadGroups]);

  const runLookup = useCallback(async (notify = true, scannedCode?: string) => {
    const normalized = (scannedCode ?? code).trim();
    if (!normalized) return null;
    setLoading(true);
    try {
      const result = await lookupInventoryLabel(normalized);
      setLookup(result);
      setSelectedProduct(null);
      setSelectedUse(null);
      if (notify) {
        // De qual estoque a consulta veio, quando a URL diz. Sem `origem`, so o
        // conflito ambiguo e avisado: nao ha alvo contra o qual comparar.
        const alvo = ORIGEM_DA_URL[origin ?? ""];
        const conflito = alvo ? crossInventoryLabelMessage(alvo, result) : null;
        if (conflito) toast.error("Etiqueta já utilizada", { description: conflito });
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
      toast.success(`Etiqueta vinculada ao item de ${rotuloDeEscopo(current.escopo).nome.toLocaleLowerCase("pt-BR")}.`);
      await runLookup(false);
    } catch (error) { toast.error("Não foi possível vincular a etiqueta.", { description: errorText(error) }); }
    finally { setSaving(false); }
  }

  const found = lookup?.matches ?? [];
  const available = lookup?.status === "AVAILABLE";
  const canChooseAny = canEditProduct || canEditUse;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <form className="space-y-3 rounded-lg border bg-card p-4" onSubmit={submit}>
        <QrCodeInput
          id="consultar-etiqueta-compartilhada"
          label="Etiqueta"
          value={code}
          placeholder="Leia o QR Code"
          loading={loading}
          loadingLabel="Consultando"
          uppercase
          onChange={(value) => {
            setCode(value);
            setLookup(null);
          }}
          onScan={(value) => void runLookup(true, value)}
        />
        <Button className="w-full" type="submit" disabled={!code.trim() || loading}><Search className="mr-2 h-4 w-4" />Consultar</Button>
      </form>

      {lookup?.status === "CONFLICT" ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Conflito de identificação</AlertTitle><AlertDescription>Este código corresponde a mais de um registro. Nenhuma alteração será permitida até que as etiquetas duplicadas sejam corrigidas.</AlertDescription></Alert> : null}
      {found.map((match, index) => (
        <ItemCard
          key={`${inventoryTargetOf(match)}-${match.item?.id ?? "restricted"}-${index}`}
          match={match}
          canEdit={match.kind === "PRODUTO" ? canEditProduct : canEditUse}
          onEdit={() => (match.kind === "PRODUTO" ? setProductEditId(match.item?.id ?? null) : setUseEditItem(match.item as UsoConsumoItem))}
          canBaixa={match.kind === "PRODUTO" ? canEditProduct : canBaixaUse}
          onBaixa={() => {
            if (!match.item) return;
            setBaixaTarget({
              alvo: inventoryTargetOf(match),
              id: match.item.id,
              nome: match.item.titulo || inventoryTargetLabel(inventoryTargetOf(match)),
              estoque: Number(match.item.estoque ?? 0),
            });
          }}
        />
      ))}

      {available ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Etiqueta disponível</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!canChooseAny ? <p className="text-sm text-muted-foreground">Seu perfil pode consultar, mas não possui permissão para vincular etiquetas.</p> : null}
            {canEditProduct ? <div className="flex flex-col gap-2 sm:flex-row"><ProductSelect open={productSelectOpen} setOpen={setProductSelectOpen} OnSelect={(item) => setSelectedProduct(item)}><Button type="button" variant="outline" className="flex-1 justify-start"><PackageSearch className="mr-2 h-4 w-4" />{selectedProduct?.titulo || "Selecionar produto"}</Button></ProductSelect><Button type="button" disabled={!selectedProduct || saving} onClick={bindProduct}><LinkIcon className="mr-2 h-4 w-4" />Vincular ao produto</Button></div> : null}
            {canEditUse ? <div className="flex flex-col gap-2 sm:flex-row"><ItemSelectDialog open={useSelectOpen} setOpen={setUseSelectOpen} onSelect={setSelectedUse} permitirTrocaDeEscopo><Button type="button" variant="outline" className="flex-1 justify-start"><PackageSearch className="mr-2 h-4 w-4" />{selectedUse?.titulo || "Selecionar item de uso/consumo ou geral"}</Button></ItemSelectDialog><Button type="button" disabled={!selectedUse || saving} onClick={bindUse}><LinkIcon className="mr-2 h-4 w-4" />Vincular ao item</Button></div> : null}
          </CardContent>
        </Card>
      ) : null}

      {productEditId ? <DialogProduto productId={productEditId} isOpen setIsOpen={(open) => !open && setProductEditId(null)} onAfterSaveProduct={() => void runLookup(false)} /> : null}
      <ItemDialog open={useEditItem !== null} item={useEditItem} grupos={groups} onOpenChange={(open) => !open && setUseEditItem(null)} onSaved={async () => { await runLookup(false); }} onGroupsChanged={loadGroups} />
      {baixaTarget ? (
        <DialogSaida
          isOpen
          setIsOpen={(open) => !open && setBaixaTarget(null)}
          inventory={baixaTarget.alvo === "PRODUTO" ? "produto" : "usoconsumo"}
          escopo={baixaTarget.alvo === "GERAL" ? "GERAL" : "USOCONSUMO"}
          productId={baixaTarget.id}
          productDescription={baixaTarget.nome}
          currentQuantity={baixaTarget.estoque}
          onSuccess={async () => { await runLookup(false); }}
        />
      ) : null}
    </div>
  );
}

export default function RegistrarEtiquetaPage() {
  return <Suspense fallback={<div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">Carregando leitor de etiquetas...</div>}><RegistrarEtiquetaContent /></Suspense>;
}
