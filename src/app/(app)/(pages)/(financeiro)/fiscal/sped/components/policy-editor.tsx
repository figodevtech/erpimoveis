"use client";

import { useState } from "react";
import { Save, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";

import { updateSpedConfiguration } from "../api";
import { formatTimestamp } from "../formatters";
import type { SpedCompetenciaDetail } from "../types";

type Policy = { status?: string; aplicavel?: boolean; mapa?: Record<string, string>; descricao?: string; confirmadoEm?: string };

/** Ponto de partida comum; só passa a valer depois de confirmado pelo contador. */
const CSOSN_SUGGESTION: Record<string, string> = {
  "101": "90", "102": "90", "103": "40", "201": "10", "202": "10",
  "203": "30", "300": "41", "400": "40", "500": "60", "900": "90",
};

/**
 * Decisões fiscais tomadas uma vez e reaproveitadas em todas as competências:
 * o crédito nas compras para revenda e o de-para CSOSN→CST das entradas.
 */
export function PolicyEditor({
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
  const evidence = competencia.configuracao.evidencias as Record<string, Policy | undefined>;
  const credit = evidence.politica_credito_revenda;
  const csosn = evidence.politica_csosn_entrada;
  const [creditApplies, setCreditApplies] = useState(credit?.aplicavel === false ? "false" : "true");
  const [creditEvidence, setCreditEvidence] = useState(credit?.descricao ?? "");
  const [map, setMap] = useState<Record<string, string>>({ ...CSOSN_SUGGESTION, ...(csosn?.mapa ?? {}) });
  const [mapEvidence, setMapEvidence] = useState(csosn?.descricao ?? "");
  const [vigencia, setVigencia] = useState("");
  const [saving, setSaving] = useState<"credit" | "csosn" | null>(null);
  const locked = !canManage || disabled || saving != null;

  async function save(kind: "credit" | "csosn") {
    setSaving(kind);
    try {
      const politicas = kind === "credit"
        ? { creditoRevenda: { aplicavel: creditApplies === "true", descricao: creditEvidence } }
        : { csosnEntrada: { mapa: map, descricao: mapEvidence } };
      await updateSpedConfiguration(competencia.configuracao.empresaId, { politicas, vigenciaInicio: vigencia || null });
      toast.success("Política fiscal confirmada.", { description: "Ela vale para as próximas gerações automáticas." });
      onSaved();
    } catch (error: unknown) {
      toast.error("Não foi possível salvar a política", { description: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Políticas para a geração automática</CardTitle>
        </div>
        <CardDescription>
          Decisões do contador, confirmadas uma vez. Com elas, o ERP decide sozinho o crédito e o CST das entradas;
          sem elas, cada caso aparece como pendência.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5 sm:max-w-xs">
          <Label htmlFor="politica-vigencia">Aplicar a partir de (opcional)</Label>
          <Input id="politica-vigencia" type="month" value={vigencia} onChange={(event) => setVigencia(event.target.value)} disabled={locked} />
          <p className="text-xs text-muted-foreground">Em branco, corrige a configuração vigente. Com data, competências anteriores mantêm a configuração da época.</p>
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Crédito de ICMS nas compras para revenda</h3>
            <Status policy={credit} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="politica-credito">ICMS destacado gera crédito?</Label>
              <Select value={creditApplies} onValueChange={setCreditApplies} disabled={locked}>
                <SelectTrigger id="politica-credito" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sim, regime normal</SelectItem>
                  <SelectItem value="false">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="politica-credito-evidencia">Evidência</Label>
              <Textarea id="politica-credito-evidencia" rows={2} value={creditEvidence} onChange={(event) => setCreditEvidence(event.target.value)} disabled={locked} placeholder="Ex.: apuração pelo regime normal confirmada pelo contador em 10/2026" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Não se aplica a mercadoria com ICMS-ST (CST 60) nem a ativo imobilizado, que continuam como pendência.</p>
          <Button type="button" size="sm" onClick={() => save("credit")} disabled={locked || !creditEvidence.trim()}>
            <Save aria-hidden="true" /> Confirmar política de crédito
          </Button>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">CST das entradas de fornecedores do Simples Nacional</h3>
            <Status policy={csosn} />
          </div>
          <p className="text-xs text-muted-foreground">A EFD exige CST; o XML do fornecedor optante pelo Simples traz CSOSN. Os valores iniciais são uma sugestão comum e só valem depois de confirmados.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Object.keys(CSOSN_SUGGESTION).map((code) => (
              <div key={code} className="space-y-1">
                <Label htmlFor={`csosn-${code}`} className="text-xs">CSOSN {code}</Label>
                <Input
                  id={`csosn-${code}`}
                  inputMode="numeric"
                  maxLength={2}
                  value={map[code] ?? ""}
                  onChange={(event) => setMap((current) => ({ ...current, [code]: event.target.value.replace(/\D/g, "").slice(0, 2) }))}
                  disabled={locked}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="politica-csosn-evidencia">Evidência</Label>
            <Textarea id="politica-csosn-evidencia" rows={2} value={mapEvidence} onChange={(event) => setMapEvidence(event.target.value)} disabled={locked} placeholder="Ex.: de-para definido pelo escritório contábil" />
          </div>
          <Button type="button" size="sm" onClick={() => save("csosn")} disabled={locked || !mapEvidence.trim()}>
            <Save aria-hidden="true" /> Confirmar de-para CSOSN → CST
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}

function Status({ policy }: { policy?: Policy }) {
  if (policy?.status !== "CONFIRMADO") return <Badge variant="outline">Pendente</Badge>;
  return <Badge variant="secondary">Confirmada {policy.confirmadoEm ? `em ${formatTimestamp(policy.confirmadoEm)}` : ""}</Badge>;
}
