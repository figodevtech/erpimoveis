"use client";

import { AlertCircle, CheckCircle2, FileText, HelpCircle, Save, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
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

export const INDICADORES_1010_FIELDS = [
  {
    campo: "IND_EXP",
    titulo: "Operações de exportação",
    subtitulo: "Registro 1100 — Exportação direta ou indireta de mercadorias no período",
    registroEfd: "1100",
  },
  {
    campo: "IND_CCRF",
    titulo: "Controle de créditos fiscais de ICMS",
    subtitulo: "Registro 1200 — Controle de créditos acumulados ou saldo credor de ICMS transferido",
    registroEfd: "1200",
  },
  {
    campo: "IND_COMB",
    titulo: "Operações com combustíveis",
    subtitulo: "Registro 1300 — Comercialização, produção ou transporte de combustíveis e derivados",
    registroEfd: "1300",
  },
  {
    campo: "IND_USINA",
    titulo: "Usinas de açúcar e álcool",
    subtitulo: "Registro 1390 — Controle de produção e entrada de cana-de-açúcar em usinas",
    registroEfd: "1390",
  },
  {
    campo: "IND_EE",
    titulo: "Operações com energia elétrica",
    subtitulo: "Registro 1500 — Atividades de geração, transmissão ou distribuição de energia elétrica",
    registroEfd: "1500",
  },
  {
    campo: "IND_FORM",
    titulo: "Formulário de segurança",
    subtitulo: "Registro 1700 — Emissão de documentos fiscais em formulário de segurança (FS-DA)",
    registroEfd: "1700",
  },
  {
    campo: "IND_AER",
    titulo: "Transporte aéreo",
    subtitulo: "Registro 1800 — Prestação de serviços de transporte aéreo de passageiros ou cargas",
    registroEfd: "1800",
  },
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

  // Gates normais
  for (const gate of GATES) {
    values[`evidence:${gate.id}`] = evidenceText(config.evidencias[gate.id]);
  }

  // Indicadores do Registro 1010
  const ind1010Data = (config.evidencias?.indicadores_1010 as Record<string, unknown> | undefined) ?? {};
  for (const item of INDICADORES_1010_FIELDS) {
    const raw = ind1010Data[item.campo];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const status = String(obj.status || "PENDENTE").toUpperCase();
      const val = String(obj.valor || "").toUpperCase();
      values[`1010:${item.campo}:valor`] = status === "CONFIRMADO" && (val === "S" || val === "N") ? val : "";
      values[`1010:${item.campo}:status`] = status;
      values[`1010:${item.campo}:evidence`] = typeof obj.descricao === "string" ? obj.descricao : "";
      values[`1010:${item.campo}:confirmadoEm`] = typeof obj.confirmadoEm === "string" ? obj.confirmadoEm : "";
    } else if (typeof raw === "string") {
      const val = raw.toUpperCase();
      values[`1010:${item.campo}:valor`] = val === "S" || val === "N" ? val : "";
      values[`1010:${item.campo}:status`] = "CONFIRMADO";
      values[`1010:${item.campo}:evidence`] = "Decisão fiscal confirmada pelo contador.";
      values[`1010:${item.campo}:confirmadoEm`] = "";
    } else {
      values[`1010:${item.campo}:valor`] = "";
      values[`1010:${item.campo}:status`] = "PENDENTE";
      values[`1010:${item.campo}:evidence`] = "";
      values[`1010:${item.campo}:confirmadoEm`] = "";
    }
  }

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
    // 1. Evidências dos gates do sistema
    const evidencias: Record<string, unknown> = Object.fromEntries(
      GATES.map((gate) => [gate.id, form[`evidence:${gate.id}`]?.trim() ?? ""])
    );

    // 2. Decisões auditáveis do Registro 1010
    const indicadores1010Payload: Record<string, unknown> = {};
    for (const item of INDICADORES_1010_FIELDS) {
      const valor = form[`1010:${item.campo}:valor`];
      const isConfirmed = valor === "S" || valor === "N";
      const status = isConfirmed ? "CONFIRMADO" : "PENDENTE";
      const descricao = form[`1010:${item.campo}:evidence`]?.trim() ?? "";

      if (isConfirmed && !descricao) {
        toast.error(`Evidência obrigatória para o indicador 1010: ${item.titulo}`, {
          description: "Informe o parecer contábil ou justificativa para confirmar a decisão.",
        });
        return;
      }

      indicadores1010Payload[item.campo] = {
        valor: isConfirmed ? valor : "N",
        status,
        descricao,
      };
    }

    evidencias.indicadores_1010 = indicadores1010Payload;

    const patch: Record<string, unknown> = {
      evidencias,
      indicadores_1010: indicadores1010Payload,
    };

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
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="size-4" aria-hidden="true" /> Configuração e gates
        </CardTitle>
        <CardDescription>
          Cada decisão confirmada ou não aplicável exige evidência textual auditável.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Seção 1: Gates do Sistema */}
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Parâmetros Gerais e Gates Fiscais
          </div>
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
        </div>

        {/* Seção 2: Registro 1010 — Informações complementares */}
        <div className="space-y-4 pt-6 border-t">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden="true" />
              <h3 className="text-base font-semibold tracking-tight">
                Registro 1010 — Informações complementares
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Definição da obrigatoriedade dos registros setoriais do Bloco 1 da EFD ICMS/IPI. Indicadores não decididos recebem valor provisório na prévia e geram bloqueio impeditivo para o fechamento definitivo. Confirme cada declaração com o contador responsável.
            </p>
          </div>

          <div className="space-y-3">
            {INDICADORES_1010_FIELDS.map((field) => {
              const currentVal = form[`1010:${field.campo}:valor`] ?? "";
              const currentStatus = (currentVal === "S" || currentVal === "N") ? "CONFIRMADO" : "PENDENTE";
              const isConfirmed = currentStatus === "CONFIRMADO";

              return (
                <div
                  key={field.campo}
                  className="grid gap-3 rounded-lg border bg-card p-3.5 transition-colors lg:grid-cols-[minmax(14rem,1.1fr)_minmax(13rem,0.9fr)_minmax(18rem,1.4fr)]"
                >
                  {/* Identificação e Descrição */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Label className="text-sm font-semibold">{field.titulo}</Label>
                      <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                        {field.campo} • Bloco 1
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {field.subtitulo}
                    </p>
                  </div>

                  {/* Seleção do Valor Fiscal */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Decisão fiscal</Label>
                      {isConfirmed ? (
                        <Badge variant="secondary" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">
                          <CheckCircle2 className="size-3" /> Confirmado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]">
                          <AlertCircle className="size-3" /> Pendente
                        </Badge>
                      )}
                    </div>
                    <Select
                      value={currentVal || "unset"}
                      onValueChange={(next) => {
                        const val = next === "unset" ? "" : next;
                        update(`1010:${field.campo}:valor`, val);
                        update(`1010:${field.campo}:status`, val ? "CONFIRMADO" : "PENDENTE");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">Não decidido (Pendente)</SelectItem>
                        <SelectItem value="S">Sim — Operação realizada (S)</SelectItem>
                        <SelectItem value="N">Não — Operação inexistente (N)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Evidência / Parecer contábil */}
                  <div className="space-y-1.5">
                    <Label htmlFor={`evidence-1010-${field.campo}`} className="text-xs text-muted-foreground">
                      Evidência fiscal / Parecer contábil
                    </Label>
                    <Textarea
                      id={`evidence-1010-${field.campo}`}
                      rows={2}
                      value={form[`1010:${field.campo}:evidence`] ?? ""}
                      onChange={(event) => update(`1010:${field.campo}:evidence`, event.target.value)}
                      placeholder="Parecer do contador, consulta fiscal, ausência de atividade..."
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Button
          type="button"
          disabled={!canManage || disabled || saving || competencia.status === "FECHADA"}
          onClick={() => void save()}
          className="mt-2"
        >
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
