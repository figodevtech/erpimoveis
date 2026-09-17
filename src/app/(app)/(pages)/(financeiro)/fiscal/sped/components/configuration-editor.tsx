"use client";

import { Save, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";

import { updateSpedConfiguration } from "../api";
import type { SpedCompetenciaDetail, SpedGateStatus } from "../types";

type FormState = Record<string, string>;

const STATUS_OPTIONS: Array<{ value: SpedGateStatus; label: string }> = [
  { value: "PENDENTE", label: "Pendente" },
  { value: "CONFIRMADO", label: "Confirmado" },
  { value: "NAO_APLICAVEL", label: "Não aplicável" },
];

const GATES = [
  { id: "timezone", title: "Timezone", status: "timezone_status", value: "timezone_iana", kind: "timezone" },
  { id: "perfil", title: "Perfil EFD", status: "perfil_efd_status", value: "perfil_efd", kind: "profile" },
  { id: "atividade", title: "Indicador de atividade", status: "indicador_atividade_status", value: "indicador_atividade", kind: "activity" },
  { id: "bloco-k", title: "Obrigatoriedade do Bloco K", status: "bloco_k_status", value: "bloco_k_obrigatorio", kind: "boolean" },
  { id: "1400", title: "Aplicabilidade do registro 1400", status: "registro_1400_status", value: "registro_1400_aplicavel", kind: "boolean" },
  { id: "c176-c179", title: "Aplicabilidade de C176/C179", status: "c176_c179_status", value: "c176_c179_aplicavel", kind: "boolean" },
  { id: "1601", title: "Aplicabilidade do registro 1601", status: "registro_1601_status", value: "registro_1601_aplicavel", kind: "boolean" },
  { id: "inventario", title: "Aplicabilidade do inventário/Bloco H", status: "inventario_status", value: "inventario_aplicavel", kind: "boolean" },
  { id: "ipi", title: "Contribuinte de IPI", status: "contribuinte_ipi_status", value: "contribuinte_ipi", kind: "boolean" },
  { id: "efd-contribuicoes", title: "Entrega da EFD-Contribuições", status: "entrega_efd_contribuicoes_status", value: "entrega_efd_contribuicoes", kind: "boolean" },
] as const;

function evidenceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return String((value as { descricao?: unknown }).descricao ?? "");
  return "";
}

function initialState(competencia: SpedCompetenciaDetail): FormState {
  const config = competencia.configuracao;
  const values: FormState = {
    timezone_iana: config.timezoneIana,
    timezone_status: config.timezoneStatus,
    perfil_efd: config.perfil ?? "",
    perfil_efd_status: config.perfilStatus,
    indicador_atividade: config.indicadorAtividade ?? "",
    indicador_atividade_status: config.indicadorAtividadeStatus,
    bloco_k_obrigatorio: config.blocoKObrigatorio == null ? "" : String(config.blocoKObrigatorio),
    bloco_k_status: config.blocoKStatus,
    registro_1400_aplicavel: config.registro1400Aplicavel == null ? "" : String(config.registro1400Aplicavel),
    registro_1400_status: config.registro1400Status,
    c176_c179_aplicavel: config.c176C179Aplicavel == null ? "" : String(config.c176C179Aplicavel),
    c176_c179_status: config.c176C179Status,
    registro_1601_aplicavel: config.registro1601Aplicavel == null ? "" : String(config.registro1601Aplicavel),
    registro_1601_status: config.registro1601Status,
    inventario_aplicavel: config.inventarioAplicavel == null ? "" : String(config.inventarioAplicavel),
    inventario_status: config.inventarioStatus,
    inventario_fechamento_id: config.inventarioFechamentoId == null ? "" : String(config.inventarioFechamentoId),
    contribuinte_ipi: config.contribuinteIpi == null ? "" : String(config.contribuinteIpi),
    contribuinte_ipi_status: config.contribuinteIpiStatus,
    entrega_efd_contribuicoes: config.entregaEfdContribuicoes == null ? "" : String(config.entregaEfdContribuicoes),
    entrega_efd_contribuicoes_status: config.entregaEfdContribuicoesStatus,
  };
  for (const gate of GATES) values[`evidence:${gate.id}`] = evidenceText(config.evidencias[gate.id]);
  return values;
}

export function ConfigurationEditor({
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
  const [form, setForm] = useState<FormState>(() => initialState(competencia));
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(initialState(competencia)), [competencia]);

  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    const evidencias = Object.fromEntries(GATES.map((gate) => [gate.id, form[`evidence:${gate.id}`]?.trim() ?? ""]));
    const patch: Record<string, unknown> = { evidencias };
    for (const gate of GATES) {
      patch[gate.status] = form[gate.status] || "PENDENTE";
      const raw = form[gate.value] ?? "";
      patch[gate.value] = gate.kind === "boolean"
        ? raw === "" ? null : raw === "true"
        : raw || null;
    }
    patch.inventario_fechamento_id = form.inventario_fechamento_id ? Number(form.inventario_fechamento_id) : null;
    setSaving(true);
    try {
      await updateSpedConfiguration(competencia.configuracao.empresaId, patch);
      toast.success("Configuração fiscal salva.");
      onSaved();
    } catch (error) {
      toast.error("Não foi possível salvar a configuração fiscal", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="size-4" aria-hidden="true" /> Configuração e gates</CardTitle>
        <CardDescription>Cada decisão confirmada ou não aplicável exige evidência textual auditável.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {GATES.map((gate) => (
          <div key={gate.id} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(12rem,0.8fr)_minmax(18rem,1.4fr)]">
            <div className="space-y-1.5">
              <Label>{gate.title}</Label>
              <GateValue gate={gate} value={form[gate.value] ?? ""} onChange={(value) => update(gate.value, value)} />
              {gate.id === "inventario" && form.inventario_aplicavel === "true" ? (
                <Input
                  aria-label="ID do fechamento de inventário aprovado"
                  value={form.inventario_fechamento_id ?? ""}
                  onChange={(event) => update("inventario_fechamento_id", event.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder="ID do fechamento aprovado"
                />
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={form[gate.status] || "PENDENTE"} onValueChange={(value) => update(gate.status, value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`evidence-${gate.id}`}>Evidência</Label>
              <Textarea id={`evidence-${gate.id}`} rows={2} value={form[`evidence:${gate.id}`] ?? ""} onChange={(event) => update(`evidence:${gate.id}`, event.target.value)} placeholder="Parecer, consulta cadastral, protocolo ou orientação do contador" />
            </div>
          </div>
        ))}
        <Button type="button" disabled={!canManage || disabled || saving || competencia.status === "FECHADA"} onClick={() => void save()}>
          <Save aria-hidden="true" /> {saving ? "Salvando..." : "Salvar configuração"}
        </Button>
      </CardContent>
    </Card>
  );
}

function GateValue({ gate, value, onChange }: { gate: typeof GATES[number]; value: string; onChange: (value: string) => void }) {
  if (gate.kind === "timezone") return <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="America/Fortaleza" />;
  if (gate.kind === "profile") return <Select value={value || undefined} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{["A", "B", "C"].map((profile) => <SelectItem key={profile} value={profile}>Perfil {profile}</SelectItem>)}</SelectContent></Select>;
  if (gate.kind === "activity") return <Select value={value || undefined} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="0">Industrial/equiparado</SelectItem><SelectItem value="1">Outros</SelectItem></SelectContent></Select>;
  return <Select value={value || "unset"} onValueChange={(next) => onChange(next === "unset" ? "" : next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unset">Não decidido</SelectItem><SelectItem value="true">Sim</SelectItem><SelectItem value="false">Não</SelectItem></SelectContent></Select>;
}
