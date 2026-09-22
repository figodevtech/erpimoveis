"use client";

import { useEffect, useState } from "react";
import { Calculator, FileText, Landmark } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { NcmCombobox } from "@/components/fiscal/ncm-combobox";
import { getRequiredPisCofinsMode } from "@/lib/nfe/taxRules";

import { Produto } from "../../../types";
import { CSOSN_OPTIONS, CST_OPTIONS, CST_PIS_OPTIONS } from "../lib/options-fiscais";
import { onlyDigits } from "../lib/utils";

type Props = {
  produto: Produto;
  onChange: (field: keyof Produto, value: any) => void;
  ncmObrigatorio?: boolean;
};

type FiscalSetup = {
  empresa?: { crt?: string | number | null } | null;
  regrasFiscais?: {
    icms: { csosn: string; cst: string; csosnPermitidos: string[]; cstPermitidos: string[] };
    rtc: { status: string };
  } | null;
  classificacoesRtc?: Array<{ codigo: string; cst: string; nome: string }>;
};

const MODES = [
  { value: "PERCENTUAL", label: "Percentual" },
  { value: "QUANTIDADE", label: "Por quantidade" },
  { value: "NAO_TRIBUTADO", label: "Não tributado" },
] as const;

function SectionTitle({ icon: Icon, children }: { icon: typeof FileText; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
    </div>
  );
}

function Field({ label, children, className = "", required = false }: { label: string; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <div className={`min-w-0 space-y-2 ${className}`}>
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

export function TabFiscal({ produto, onChange, ncmObrigatorio = false }: Props) {
  const [setup, setSetup] = useState<FiscalSetup | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/nfe/emissao-assistida/setup", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active) setSetup(data);
      })
      .catch(() => {
        if (active) setSetup(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const cstIcms = onlyDigits(String(produto.cst ?? ""));
  const cstIcmsNormalizado = cstIcms ? cstIcms.padStart(2, "0").slice(-2) : "Selecione";
  const showCsosn = !setup?.regrasFiscais || setup.regrasFiscais.icms.csosn === "REQUIRED";
  const showCst = !setup?.regrasFiscais || setup.regrasFiscais.icms.cst === "REQUIRED";
  const rtcRequired = setup?.regrasFiscais?.rtc.status === "REQUIRED";
  const rtcEnabled = rtcRequired || Boolean(produto.rtc_habilitado);

  const updateContributionCst = (type: "PIS" | "COFINS", value: string) => {
    const cst = value === "Selecione" ? "" : value;
    const requiredMode = getRequiredPisCofinsMode(cst);
    if (type === "PIS") {
      onChange("cst_pis", cst);
      onChange("modo_pis", requiredMode || undefined);
      if (requiredMode === "NAO_TRIBUTADO") {
        onChange("aliquota_pis", undefined);
        onChange("aliquota_por_unidade_pis", undefined);
      }
      return;
    }
    onChange("cst_cofins", cst);
    onChange("modo_cofins", requiredMode || undefined);
    if (requiredMode === "NAO_TRIBUTADO") {
      onChange("aliquota_cofins", undefined);
      onChange("aliquota_por_unidade_cofins", undefined);
    }
  };

  return (
    <TabsContent value="Fiscal" className="h-full min-h-0 w-full min-w-0 max-w-full space-y-6 overflow-x-hidden overflow-y-auto px-2 py-3 dark:bg-muted-foreground/5 md:px-6 md:py-6">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle icon={FileText}>Classificação fiscal</SectionTitle>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Origem da mercadoria" className="lg:col-span-2">
            <Select
              value={produto.origem_mercadoria || "Selecione"}
              onValueChange={(value) => onChange("origem_mercadoria", value === "Selecione" ? "" : value)}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Selecione">Selecione</SelectItem>
                <SelectItem value="0">0 - Nacional</SelectItem>
                <SelectItem value="1">1 - Estrangeira, importação direta</SelectItem>
                <SelectItem value="2">2 - Estrangeira, adquirida no mercado interno</SelectItem>
                <SelectItem value="3">3 - Nacional, conteúdo importado superior a 40%</SelectItem>
                <SelectItem value="4">4 - Nacional, processo produtivo básico</SelectItem>
                <SelectItem value="5">5 - Nacional, conteúdo importado até 40%</SelectItem>
                <SelectItem value="6">6 - Estrangeira, sem similar nacional</SelectItem>
                <SelectItem value="7">7 - Estrangeira sem similar, mercado interno</SelectItem>
                <SelectItem value="8">8 - Nacional, conteúdo importado superior a 70%</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="NCM" required={ncmObrigatorio} className="lg:col-span-2">
            {/* Só o código é gravado em produto.ncm; a descrição vem do
                catálogo na hora de exibir, e por isso não é duplicada aqui. */}
            <NcmCombobox
              value={produto.ncm || ""}
              onValueChange={(codigo) => onChange("ncm", codigo)}
              mostrarProveniencia
            />
          </Field>
          <Field label="CFOP padrão">
            <Input value={produto.cfop || ""} maxLength={4} inputMode="numeric" placeholder="5102" onChange={(event) => onChange("cfop", onlyDigits(event.target.value))} />
          </Field>
          {showCsosn ? (
            <Field label="CSOSN padrão" className="lg:col-span-2">
              <Select value={produto.csosn || "Selecione"} onValueChange={(value) => onChange("csosn", value === "Selecione" ? "" : value)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)] sm:w-[34rem]">
                  <SelectItem value="Selecione">Selecione</SelectItem>
                  {CSOSN_OPTIONS
                    .filter((option) => !setup?.regrasFiscais || setup.regrasFiscais.icms.csosnPermitidos.includes(option.cod))
                    .map((option) => (
                      <SelectItem className="whitespace-normal py-2" key={option.cod} value={option.cod}>{option.cod} - {option.desc}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle icon={Calculator}>Impostos e tributações</SectionTitle>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h4 className="border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ICMS</h4>
            {showCst ? (
              <Field label="CST ICMS padrão">
                <Select value={cstIcmsNormalizado} onValueChange={(value) => onChange("cst", value === "Selecione" ? "" : value)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)] sm:w-[32rem]">
                    <SelectItem value="Selecione">Selecione</SelectItem>
                    {CST_OPTIONS
                      .filter((option) => !setup?.regrasFiscais || setup.regrasFiscais.icms.cstPermitidos.includes(option.cod))
                      .map((option) => (
                        <SelectItem className="whitespace-normal py-2" key={option.cod} value={option.cod}>{option.cod} - {option.desc}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Alíquota padrão (%)">
                <Input type="number" inputMode="decimal" value={produto.aliquotaicms ?? ""} placeholder="18,00" onChange={(event) => onChange("aliquotaicms", event.target.value)} />
              </Field>
              <Field label="CEST">
                <Input value={produto.cest || ""} maxLength={7} inputMode="numeric" placeholder="Quando aplicável" onChange={(event) => onChange("cest", onlyDigits(event.target.value))} />
              </Field>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h4 className="border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">PIS e COFINS</h4>
            <ContributionDefaults type="PIS" produto={produto} onChange={onChange} onCstChange={(value) => updateContributionCst("PIS", value)} />
            <div className="border-t" />
            <ContributionDefaults type="COFINS" produto={produto} onChange={onChange} onCstChange={(value) => updateContributionCst("COFINS", value)} />
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle icon={Landmark}>Reforma tributária (IBS/CBS)</SectionTitle>
        <p className="text-xs text-muted-foreground">
          Estes valores são padrões. A classificação será revalidada na tabela oficial vigente ao gerar a NF-e.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
          <Field label={rtcRequired ? "Aplicar IBS/CBS (obrigatório)" : "Aplicar IBS/CBS"}>
            <Select value={rtcEnabled ? "SIM" : "NAO"} onValueChange={(value) => onChange("rtc_habilitado", value === "SIM")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {!rtcRequired ? <SelectItem value="NAO">Não se aplica</SelectItem> : null}
                <SelectItem value="SIM">Aplicar</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {rtcEnabled ? (
            <>
              <Field label="Classificação tributária" className="md:col-span-2">
                <Select
                  value={produto.cclass_trib || "Selecione"}
                  onValueChange={(value) => {
                    const classification = setup?.classificacoesRtc?.find((entry) => entry.codigo === value);
                    onChange("cclass_trib", value === "Selecione" ? "" : value);
                    onChange("cst_ibscbs", classification?.cst || "");
                  }}
                >
                  <SelectTrigger className="w-full" title={setup?.classificacoesRtc?.find((entry) => entry.codigo === produto.cclass_trib)?.nome}>
                    <SelectValue placeholder="Selecione o cClassTrib" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)] sm:max-w-2xl">
                    <SelectItem value="Selecione">Selecione</SelectItem>
                    {setup?.classificacoesRtc?.map((entry) => (
                      <SelectItem className="whitespace-normal py-2" key={`${entry.cst}-${entry.codigo}`} value={entry.codigo}>
                        {entry.cst} / {entry.codigo} - {entry.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="CST IBS/CBS"><Input value={produto.cst_ibscbs || ""} disabled /></Field>
              <Field label="% IBS UF"><Input type="number" value={produto.aliquota_ibs_uf ?? ""} onChange={(event) => onChange("aliquota_ibs_uf", event.target.value)} /></Field>
              <Field label="% IBS Município"><Input type="number" value={produto.aliquota_ibs_municipio ?? ""} onChange={(event) => onChange("aliquota_ibs_municipio", event.target.value)} /></Field>
              <Field label="% CBS"><Input type="number" value={produto.aliquota_cbs ?? ""} onChange={(event) => onChange("aliquota_cbs", event.target.value)} /></Field>
            </>
          ) : null}
        </div>
      </section>
    </TabsContent>
  );
}

function ContributionDefaults({
  type,
  produto,
  onChange,
  onCstChange,
}: {
  type: "PIS" | "COFINS";
  produto: Produto;
  onChange: Props["onChange"];
  onCstChange: (value: string) => void;
}) {
  const pis = type === "PIS";
  const cst = (pis ? produto.cst_pis : produto.cst_cofins) || "Selecione";
  const requiredMode = getRequiredPisCofinsMode(cst);
  const mode = (pis ? produto.modo_pis : produto.modo_cofins) || requiredMode || undefined;
  const visibleModes = requiredMode ? MODES.filter((entry) => entry.value === requiredMode) : MODES.filter((entry) => entry.value !== "NAO_TRIBUTADO");

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={`CST ${type}`}>
        <Select value={cst} onValueChange={onCstChange}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-2rem)] sm:w-[36rem]">
            <SelectItem value="Selecione">Selecione</SelectItem>
            {CST_PIS_OPTIONS.map((option) => (
              <SelectItem className="whitespace-normal py-2" key={option.cod} value={option.cod}>{option.cod} - {option.desc}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={`Modo ${type}`}>
        <Select
          value={mode || "Selecione"}
          onValueChange={(value) => onChange(pis ? "modo_pis" : "modo_cofins", value === "Selecione" ? undefined : value)}
        >
          <SelectTrigger className="w-full" disabled={cst === "Selecione"}><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Selecione">Selecione</SelectItem>
            {visibleModes.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {mode === "PERCENTUAL" ? (
        <Field label={`Alíquota ${type} (%)`}>
          <Input type="number" inputMode="decimal" value={(pis ? produto.aliquota_pis : produto.aliquota_cofins) ?? ""} onChange={(event) => onChange(pis ? "aliquota_pis" : "aliquota_cofins", event.target.value)} />
        </Field>
      ) : null}
      {mode === "QUANTIDADE" ? (
        <Field label={`Alíquota por unidade ${type}`}>
          <Input type="number" inputMode="decimal" value={(pis ? produto.aliquota_por_unidade_pis : produto.aliquota_por_unidade_cofins) ?? ""} onChange={(event) => onChange(pis ? "aliquota_por_unidade_pis" : "aliquota_por_unidade_cofins", event.target.value)} />
        </Field>
      ) : null}
    </div>
  );
}
