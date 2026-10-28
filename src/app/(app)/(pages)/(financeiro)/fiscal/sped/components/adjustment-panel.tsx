"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UppercaseInput } from "@/components/ui/uppercase-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";

import { createSpedAssessmentAdjustment, deactivateSpedAssessmentAdjustment } from "../api";
import { formatCurrency } from "../formatters";
import type { SpedCompetenciaDetail } from "../types";

const NATURES: Record<string, Array<{ value: string; label: string }>> = {
  E111: [
    { value: "DEBITO", label: "Ajuste a débito" },
    { value: "CREDITO", label: "Ajuste a crédito" },
    { value: "ESTORNO_CREDITO", label: "Estorno de crédito" },
    { value: "ESTORNO_DEBITO", label: "Estorno de débito" },
    { value: "DEDUCAO", label: "Dedução" },
    { value: "DEBITO_ESPECIAL", label: "Débito especial" },
  ],
  E115: [{ value: "INFORMATIVO", label: "Informação adicional" }],
  E116: [{ value: "RECOLHIMENTO", label: "Recolhimento de ICMS" }],
  E311: [
    { value: "DEBITO", label: "Ajuste a débito" },
    { value: "CREDITO", label: "Ajuste a crédito" },
    { value: "ESTORNO_CREDITO", label: "Estorno de crédito" },
    { value: "ESTORNO_DEBITO", label: "Estorno de débito" },
    { value: "DEDUCAO", label: "Dedução" },
    { value: "DEBITO_ESPECIAL", label: "Débito especial" },
  ],
  E316: [{ value: "RECOLHIMENTO", label: "Recolhimento de DIFAL/FCP" }],
};

export function AdjustmentPanel({
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
  const [destination, setDestination] = useState("E111");
  const natureOptions = useMemo(() => NATURES[destination] ?? [], [destination]);
  const [nature, setNature] = useState("DEBITO");
  const [code, setCode] = useState("");
  const [uf, setUf] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tax, setTax] = useState("DIFAL");
  const [saving, setSaving] = useState(false);
  const requiresUf = destination === "E311" || destination === "E316";
  const requiresDueDate = destination === "E116" || destination === "E316";
  const requiresTax = destination === "E311";

  function changeDestination(next: string) {
    setDestination(next);
    setNature(NATURES[next]?.[0]?.value ?? "");
    if (next !== "E311" && next !== "E316") setUf("");
    if (next !== "E116" && next !== "E316") setDueDate("");
  }

  async function save() {
    setSaving(true);
    try {
      await createSpedAssessmentAdjustment(competencia.id, {
        destination,
        nature,
        code,
        uf: requiresUf ? uf : null,
        value: Number(value.replace(",", ".")),
        description,
        evidence,
        reference: {
          ...(requiresDueDate ? { dataVencimento: dueDate } : {}),
          ...(requiresTax ? { tributo: tax } : {}),
        },
      });
      toast.success("Lançamento fiscal salvo.", { description: "Valide novamente para recalcular o Bloco E." });
      setCode("");
      setValue("");
      setDescription("");
      setEvidence("");
      setDueDate("");
      onSaved();
    } catch (error) {
      toast.error("Não foi possível salvar o lançamento fiscal", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(adjustmentId: string) {
    setSaving(true);
    try {
      await deactivateSpedAssessmentAdjustment(competencia.id, adjustmentId);
      toast.success("Lançamento fiscal desativado.", { description: "Valide novamente para recalcular a apuração." });
      onSaved();
    } catch (error) {
      toast.error("Não foi possível desativar o lançamento", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setSaving(false);
    }
  }

  const formDisabled = disabled || !canManage || competencia.status === "FECHADA";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ajustes e recolhimentos auditados</CardTitle>
        <CardDescription>Não infira códigos fiscais: registre somente valores, códigos e vencimentos confirmados pelo responsável fiscal.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {competencia.ajustes.length ? (
          <div className="divide-y rounded-lg border">
            {competencia.ajustes.map((adjustment) => (
              <div key={adjustment.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{adjustment.registroDestino} · {adjustment.codigo} · {adjustment.natureza}</p>
                  <p className="text-xs text-muted-foreground">{adjustment.descricao}{adjustment.uf ? ` · ${adjustment.uf}` : ""}</p>
                  <p className="mt-1 text-xs">{formatCurrency(adjustment.valor)} · Evidência: {adjustment.evidencia}</p>
                </div>
                <Button type="button" size="icon" variant="ghost" disabled={formDisabled || saving} aria-label={`Desativar ajuste ${adjustment.codigo}`} onClick={() => remove(adjustment.id)}><Trash2 aria-hidden="true" /></Button>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">Nenhum ajuste manual ativo.</p>}

        <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5"><Label>Registro</Label><Select value={destination} onValueChange={changeDestination} disabled={formDisabled}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.keys(NATURES).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Natureza</Label><Select value={nature} onValueChange={setNature} disabled={formDisabled}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{natureOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="sped-adjustment-code">Código fiscal</Label><Input id="sped-adjustment-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={formDisabled} /></div>
          <div className="space-y-1.5"><Label htmlFor="sped-adjustment-value">Valor</Label><Input id="sped-adjustment-value" value={value} onChange={(event) => setValue(event.target.value)} disabled={formDisabled} inputMode="decimal" placeholder="0,00" /></div>
          {requiresUf ? <div className="space-y-1.5"><Label htmlFor="sped-adjustment-uf">UF</Label><UppercaseInput id="sped-adjustment-uf" value={uf} format={(valor) => valor.replace(/[^A-Z]/g, "").slice(0, 2)} onValueChange={setUf} disabled={formDisabled} maxLength={2} /></div> : null}
          {requiresTax ? <div className="space-y-1.5"><Label>Tributo</Label><Select value={tax} onValueChange={setTax} disabled={formDisabled}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="DIFAL">DIFAL</SelectItem><SelectItem value="FCP">FCP</SelectItem></SelectContent></Select></div> : null}
          {requiresDueDate ? <div className="space-y-1.5"><Label htmlFor="sped-adjustment-due">Vencimento</Label><Input id="sped-adjustment-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={formDisabled} /></div> : null}
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="sped-adjustment-description">Descrição</Label><Input id="sped-adjustment-description" value={description} onChange={(event) => setDescription(event.target.value)} disabled={formDisabled} /></div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-3"><Label htmlFor="sped-adjustment-evidence">Evidência</Label><Textarea id="sped-adjustment-evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} disabled={formDisabled} rows={2} placeholder="Parecer, guia, memória de cálculo ou confirmação do contador" /></div>
          <div className="flex items-end"><Button type="button" onClick={save} disabled={formDisabled || saving || !code.trim() || !description.trim() || !evidence.trim() || !value.trim() || (requiresUf && uf.length !== 2) || (requiresDueDate && !dueDate)}><Plus aria-hidden="true" /> {saving ? "Salvando" : "Adicionar"}</Button></div>
        </div>
      </CardContent>
    </Card>
  );
}
