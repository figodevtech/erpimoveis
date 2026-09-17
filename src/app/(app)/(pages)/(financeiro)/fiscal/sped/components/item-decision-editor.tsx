"use client";

import { Save, Tags } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";

import { configureSpedFiscalItem } from "../api";
import type { SpedCompetenciaDetail, SpedDocumento } from "../types";
import { EmptyState } from "./empty-state";

type FiscalItem = SpedDocumento["itens"][number];

export function ItemDecisionEditor({
  competencia,
  canManage,
  disabled,
  onSaved,
}: {
  competencia: SpedCompetenciaDetail;
  canManage: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const documents = competencia.documentos.filter((document) => document.situacao !== "02" && document.itens.length > 0);
  if (!documents.length) return (
    <EmptyState
      icon={Tags}
      title="Nenhum item projetado"
      description="Execute a validação para projetar os itens documentais antes de registrar as decisões fiscais."
    />
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Tags className="size-4" aria-hidden="true" /> Decisões por item</CardTitle>
          <CardDescription>O código 0200 exige produto interno vinculado. Créditos de entrada só entram na apuração após decisão explícita e evidenciada.</CardDescription>
        </CardHeader>
      </Card>
      {documents.map((document) => (
        <Card key={document.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{document.direcao} · {document.modelo} {document.serie}/{document.numero}</CardTitle>
            <CardDescription className="break-all font-mono text-[10px]">{document.chave}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {document.itens.map((item) => (
              <FiscalItemDecisionRow
                key={item.id}
                competenciaId={competencia.id}
                document={document}
                item={item}
                canManage={canManage}
                disabled={disabled || competencia.status === "FECHADA"}
                onSaved={onSaved}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FiscalItemDecisionRow({
  competenciaId,
  document,
  item,
  canManage,
  disabled,
  onSaved,
}: {
  competenciaId: string;
  document: SpedDocumento;
  item: FiscalItem;
  canManage: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const isInput = document.direcao === "ENTRADA";
  const [canonicalCode, setCanonicalCode] = useState(item.itemConfigId ? item.codigo : item.codigoXml ?? "");
  const [itemType, setItemType] = useState(item.tipoItem ?? "");
  const [creditTreatment, setCreditTreatment] = useState(isInput && item.tratamentoCredito !== "PENDENTE" ? item.tratamentoCredito : "");
  const [evidence, setEvidence] = useState("");
  const [saving, setSaving] = useState(false);
  const cannotConfigureProduct = item.produtoId == null;

  async function save() {
    setSaving(true);
    try {
      await configureSpedFiscalItem(competenciaId, {
        itemSnapshotId: item.id,
        canonicalCode,
        itemType,
        creditTreatment: isInput ? creditTreatment : undefined,
        evidence,
      });
      toast.success("Decisão fiscal salva.", { description: "Valide novamente a competência para renovar os snapshots." });
      onSaved();
    } catch (error) {
      toast.error("Não foi possível salvar a decisão do item", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3 xl:grid-cols-[minmax(12rem,1fr)_minmax(8rem,0.5fr)_minmax(12rem,0.8fr)_minmax(18rem,1.3fr)_auto] xl:items-end">
      <div className="space-y-1.5">
        <Label htmlFor={`code-${item.id}`}>Item {item.numero} · {item.descricao}</Label>
        <Input id={`code-${item.id}`} value={canonicalCode} onChange={(event) => setCanonicalCode(event.target.value)} disabled={disabled || !canManage || cannotConfigureProduct} placeholder="Código canônico 0200" />
        <p className="text-[10px] text-muted-foreground">cProd: {item.codigoXml || "ausente"} · produto interno: {item.produtoId ?? "não vinculado"}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`type-${item.id}`}>Tipo do item</Label>
        <Input id={`type-${item.id}`} value={itemType} onChange={(event) => setItemType(event.target.value.replace(/\D/g, "").slice(0, 2))} disabled={disabled || !canManage || cannotConfigureProduct} inputMode="numeric" maxLength={2} placeholder="00" />
      </div>
      <div className="space-y-1.5">
        <Label>Crédito de ICMS</Label>
        {isInput ? (
          <Select value={creditTreatment || undefined} onValueChange={setCreditTreatment} disabled={disabled || !canManage}>
            <SelectTrigger><SelectValue placeholder="Decisão pendente" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="CREDITAVEL">Creditável</SelectItem>
              <SelectItem value="SEM_CREDITO">Sem crédito</SelectItem>
              <SelectItem value="USO_CONSUMO">Uso e consumo</SelectItem>
              <SelectItem value="ATIVO_IMOBILIZADO">Ativo imobilizado</SelectItem>
            </SelectContent>
          </Select>
        ) : <Input value="Não aplicável à saída" disabled />}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`evidence-${item.id}`}>Evidência fiscal</Label>
        <Textarea id={`evidence-${item.id}`} value={evidence} onChange={(event) => setEvidence(event.target.value)} disabled={disabled || !canManage} rows={2} placeholder="Parecer, regra, documento ou confirmação do contador" />
      </div>
      <Button type="button" size="sm" onClick={save} disabled={disabled || !canManage || saving || !evidence.trim() || (!isInput && item.produtoId == null) || (isInput && !creditTreatment) || (item.produtoId != null && (!canonicalCode.trim() || itemType.length !== 2))}>
        <Save aria-hidden="true" /> {saving ? "Salvando" : "Salvar"}
      </Button>
    </div>
  );
}
