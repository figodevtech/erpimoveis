"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import ValueInput from "@/components/ui/value-input";
import {
  getRequiredPisCofinsMode,
  PIS_COFINS_CST_OPTIONS,
} from "@/lib/nfe/taxRules";

import {
  type AssistedFiscalItem,
  type AssistedItemIssue,
  type FiscalSetup,
  inferPisCofinsMode,
  onlyDigits,
} from "./emissao-assistida-model";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: AssistedFiscalItem | null;
  setup: FiscalSetup;
  issues: AssistedItemIssue[];
  onChange: (patch: Partial<AssistedFiscalItem>) => void;
};

const CSOSN_DESCRIPTIONS: Record<string, string> = {
  "101": "Tributada pelo Simples com permissão de crédito",
  "102": "Tributada pelo Simples sem permissão de crédito",
  "103": "Isenção por faixa de receita",
  "201": "Tributada com crédito e ICMS-ST",
  "202": "Tributada sem crédito e com ICMS-ST",
  "203": "Isenção por faixa de receita e ICMS-ST",
  "300": "Imune",
  "400": "Não tributada",
  "500": "ICMS-ST cobrado anteriormente",
  "900": "Outros",
};

const CST_DESCRIPTIONS: Record<string, string> = {
  "00": "Tributada integralmente",
  "10": "Tributada com ICMS-ST",
  "20": "Redução de base de cálculo",
  "30": "Isenta/não tributada com ICMS-ST",
  "40": "Isenta",
  "41": "Não tributada",
  "50": "Suspensão",
  "51": "Diferimento",
  "60": "ICMS-ST cobrado anteriormente",
  "70": "Redução de base com ICMS-ST",
  "90": "Outras",
};

const ORIGENS = [
  ["0", "Nacional"],
  ["1", "Estrangeira — importação direta"],
  ["2", "Estrangeira — mercado interno"],
  ["3", "Nacional, conteúdo importado superior a 40%"],
  ["4", "Nacional, processo produtivo básico"],
  ["5", "Nacional, conteúdo importado até 40%"],
  ["6", "Estrangeira sem similar nacional"],
  ["7", "Estrangeira sem similar — mercado interno"],
  ["8", "Nacional, conteúdo importado superior a 70%"],
] as const;

function Field({
  label,
  required,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 max-w-full space-y-1.5 [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:max-w-full [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:max-w-full [&_[data-slot=select-trigger]]:overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:overflow-hidden [&_[data-slot=select-value]]:text-ellipsis ${className}`}
    >
      <Label className="break-words text-xs">
        {label} {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function contributionModeOptions(cst: string) {
  const required = getRequiredPisCofinsMode(cst);
  const options = [
    { value: "PERCENTUAL", label: "Percentual" },
    { value: "QUANTIDADE", label: "Por quantidade" },
    { value: "NAO_TRIBUTADO", label: "Não tributado" },
  ] as const;
  return required
    ? options.filter((option) => option.value === required)
    : options.filter((option) => option.value !== "NAO_TRIBUTADO");
}

export function NfeItemFiscalEditor({
  open,
  onOpenChange,
  item,
  setup,
  issues,
  onChange,
}: Props) {
  if (!item) return null;

  const rules = setup.regrasFiscais;
  const needsIcmsRate =
    ["00", "10", "20", "51", "70", "90"].includes(item.cst) ||
    item.csosn === "900";
  const needsCest =
    ["10", "30", "70"].includes(item.cst) ||
    ["201", "202", "203"].includes(item.csosn);

  const updateQuantity = (value: string) => {
    const quantidade = Number(value);
    const next = Number.isFinite(quantidade) ? quantidade : 0;
    onChange({
      quantidade: next,
      ...(item.modoPis === "QUANTIDADE" ? { quantidadePis: value } : {}),
      ...(item.modoCofins === "QUANTIDADE" ? { quantidadeCofins: value } : {}),
    });
  };

  const updateContributionCst = (type: "PIS" | "COFINS", cst: string) => {
    const mode = inferPisCofinsMode(cst);
    if (type === "PIS") {
      onChange({
        cstPis: cst,
        modoPis: mode,
        ...(mode === "NAO_TRIBUTADO"
          ? {
              aliquotaPis: "",
              basePis: "",
              quantidadePis: "",
              aliquotaPorUnidadePis: "",
              valorPis: "",
            }
          : {}),
      });
      return;
    }
    onChange({
      cstCofins: cst,
      modoCofins: mode,
      ...(mode === "NAO_TRIBUTADO"
        ? {
            aliquotaCofins: "",
            baseCofins: "",
            quantidadeCofins: "",
            aliquotaPorUnidadeCofins: "",
            valorCofins: "",
          }
        : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] min-w-0 overflow-x-hidden overflow-y-auto p-3 sm:w-[96vw] sm:max-w-5xl sm:p-6">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="break-words leading-snug [overflow-wrap:anywhere]">
            Ajustar tributação — {item.titulo}
          </DialogTitle>
          <DialogDescription className="break-words">
            As alterações serão aplicadas somente a esta NF-e. O cadastro do produto não será modificado.
          </DialogDescription>
        </DialogHeader>

        {issues.length > 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{issues.length} pendência(s) fiscal(is)</AlertTitle>
            <AlertDescription className="min-w-0">
              <ul className="mt-1 min-w-0 list-disc space-y-1 pl-4 [overflow-wrap:anywhere]">
                {issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Produto pronto para emissão</AlertTitle>
            <AlertDescription>Os dados preenchidos são compatíveis com as regras atuais do motor.</AlertDescription>
          </Alert>
        )}

        <section className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4 bg-card">
          <h3 className="text-sm font-semibold">Produto</h3>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-12">
            <Field label="Descrição" required className="lg:col-span-5">
              <Input value={item.descricao} disabled />
            </Field>
            <Field label="NCM" required className="lg:col-span-2">
              <Input
                value={item.ncm}
                maxLength={8}
                inputMode="numeric"
                onChange={(event) => onChange({ ncm: onlyDigits(event.target.value) })}
              />
            </Field>
            <Field label="CFOP" required className="lg:col-span-2">
              <Input
                value={item.cfop}
                maxLength={4}
                inputMode="numeric"
                onChange={(event) => onChange({ cfop: onlyDigits(event.target.value) })}
              />
            </Field>
            <Field label="Unidade" required className="lg:col-span-3">
              <Select value={item.unidade} onValueChange={(unidade) => onChange({ unidade })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {setup.unidades.map((unidade) => (
                    <SelectItem key={unidade} value={unidade}>{unidade}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Quantidade na NF-e" required className="lg:col-span-3">
              <Input
                type="number"
                min="0.0001"
                step="0.0001"
                inputMode="decimal"
                value={item.quantidade}
                onChange={(event) => updateQuantity(event.target.value)}
              />
            </Field>
            <Field label="Valor unitário na NF-e" required className="lg:col-span-3">
              <ValueInput
                value={item.valorUnitario}
                onValueChange={(valorUnitario) => onChange({ valorUnitario })}
              />
            </Field>
            <Field label="Total do item na NF-e" className="lg:col-span-3">
              <Input
                value={(item.quantidade * item.valorUnitario).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
                disabled
              />
            </Field>
            <Field label="CEST" required={needsCest} className="lg:col-span-3">
              <Input
                value={item.cest}
                maxLength={7}
                inputMode="numeric"
                placeholder={needsCest ? "Obrigatório para ICMS-ST" : "Quando aplicável"}
                onChange={(event) => onChange({ cest: onlyDigits(event.target.value) })}
              />
            </Field>
          </div>
        </section>

        <section className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4 bg-card">
          <h3 className="text-sm font-semibold">ICMS</h3>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Origem da mercadoria" required className="sm:col-span-2">
              <Select value={item.orig} onValueChange={(orig) => onChange({ orig })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent className="w-[calc(100vw-2rem)] max-w-[32rem]">
                  {ORIGENS.map(([value, label]) => (
                    <SelectItem className="break-words whitespace-normal py-2 [overflow-wrap:anywhere]" key={value} value={value}>
                      {value} - {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {rules?.icms.csosn === "REQUIRED" ? (
              <Field label="CSOSN" required className="sm:col-span-2">
                <Select
                  value={item.csosn}
                  onValueChange={(csosn) => onChange({ csosn, cst: "" })}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent className="w-[calc(100vw-2rem)] max-w-[34rem]">
                    {rules.icms.csosnPermitidos.map((code) => (
                      <SelectItem className="break-words whitespace-normal py-2 [overflow-wrap:anywhere]" key={code} value={code}>
                        {code} - {CSOSN_DESCRIPTIONS[code] || code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            {rules?.icms.cst === "REQUIRED" ? (
              <Field label="CST ICMS" required className="sm:col-span-2">
                <Select value={item.cst} onValueChange={(cst) => onChange({ cst, csosn: "" })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent className="w-[calc(100vw-2rem)] max-w-[30rem]">
                    {rules.icms.cstPermitidos.map((code) => (
                      <SelectItem className="break-words whitespace-normal py-2 [overflow-wrap:anywhere]" key={code} value={code}>
                        {code} - {CST_DESCRIPTIONS[code] || code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            {needsIcmsRate ? (
              <Field label="Alíquota ICMS (%)" required>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={item.aliquotaIcms}
                  onChange={(event) => onChange({ aliquotaIcms: event.target.value })}
                />
              </Field>
            ) : null}
          </div>
        </section>

        <section className="min-w-0 space-y-4 rounded-lg border p-3 sm:p-4 bg-card">
          <h3 className="text-sm font-semibold">PIS e COFINS</h3>
          <ContributionFields
            type="PIS"
            cst={item.cstPis}
            mode={item.modoPis}
            rate={item.aliquotaPis}
            quantity={item.quantidadePis}
            unitRate={item.aliquotaPorUnidadePis}
            onCstChange={(value) => updateContributionCst("PIS", value)}
            onChange={onChange}
          />
          <Separator />
          <ContributionFields
            type="COFINS"
            cst={item.cstCofins}
            mode={item.modoCofins}
            rate={item.aliquotaCofins}
            quantity={item.quantidadeCofins}
            unitRate={item.aliquotaPorUnidadeCofins}
            onCstChange={(value) => updateContributionCst("COFINS", value)}
            onChange={onChange}
          />
        </section>

        <section className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4 bg-card">
          <h3 className="text-sm font-semibold">Reforma tributária (IBS/CBS)</h3>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <Field label="Aplicar IBS/CBS" required={rules?.rtc.status === "REQUIRED"}>
              <Select
                value={item.rtcHabilitado ? "SIM" : "NAO"}
                onValueChange={(value) => onChange({ rtcHabilitado: value === "SIM" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NAO">Não se aplica</SelectItem>
                  <SelectItem value="SIM">Aplicar</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {item.rtcHabilitado ? (
              <>
                <Field label="Classificação tributária" required className="sm:col-span-2 lg:col-span-2">
                  <Select
                    value={item.cClassTrib}
                    onValueChange={(cClassTrib) => {
                      const classification = setup.classificacoesRtc.find(
                        (entry) => entry.codigo === cClassTrib,
                      );
                      onChange({ cClassTrib, cstIbsCbs: classification?.cst ?? "" });
                    }}
                  >
                    <SelectTrigger
                      title={setup.classificacoesRtc.find((entry) => entry.codigo === item.cClassTrib)?.nome}
                    >
                      <SelectValue placeholder="Selecione o cClassTrib" />
                    </SelectTrigger>
                    <SelectContent className="w-[calc(100vw-2rem)] max-w-2xl">
                      {setup.classificacoesRtc.map((entry) => (
                        <SelectItem
                          className="break-words whitespace-normal py-2 pr-8 leading-snug [overflow-wrap:anywhere]"
                          key={`${entry.cst}-${entry.codigo}`}
                          value={entry.codigo}
                        >
                          {entry.cst} / {entry.codigo} - {entry.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="CST IBS/CBS" required>
                  <Input value={item.cstIbsCbs} disabled />
                </Field>
                <Field label="Base IBS/CBS" required>
                  <Input
                    value={item.baseRtc}
                    placeholder="Total do item"
                    onChange={(event) => onChange({ baseRtc: event.target.value })}
                  />
                </Field>
                <Field label="% IBS UF" required>
                  <Input value={item.aliquotaIbsUf} onChange={(event) => onChange({ aliquotaIbsUf: event.target.value })} />
                </Field>
                <Field label="% IBS Município" required>
                  <Input value={item.aliquotaIbsMunicipio} onChange={(event) => onChange({ aliquotaIbsMunicipio: event.target.value })} />
                </Field>
                <Field label="% CBS" required>
                  <Input value={item.aliquotaCbs} onChange={(event) => onChange({ aliquotaCbs: event.target.value })} />
                </Field>
              </>
            ) : null}
          </div>
        </section>

        <DialogFooter className="min-w-0">
          <Button type="button" className="h-auto min-h-9 w-full whitespace-normal sm:w-auto" onClick={() => onOpenChange(false)}>
            {issues.length === 0 ? "Concluir" : "Continuar depois"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContributionFields({
  type,
  cst,
  mode,
  rate,
  quantity,
  unitRate,
  onCstChange,
  onChange,
}: {
  type: "PIS" | "COFINS";
  cst: string;
  mode: AssistedFiscalItem["modoPis"];
  rate: string;
  quantity: string;
  unitRate: string;
  onCstChange: (value: string) => void;
  onChange: (patch: Partial<AssistedFiscalItem>) => void;
}) {
  const pis = type === "PIS";
  const options = PIS_COFINS_CST_OPTIONS.filter(
    (option) => option.operation === "SAIDA" || option.operation === "OUTROS",
  );
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={`CST ${type}`} required className="sm:col-span-2">
        <Select value={cst} onValueChange={onCstChange}>
          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent className="w-[calc(100vw-2rem)] max-w-[38rem]">
            {options.map((option) => (
              <SelectItem className="break-words whitespace-normal py-2 [overflow-wrap:anywhere]" key={option.value} value={option.value}>
                {option.value} - {option.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={`Modo ${type}`} required>
        <Select
          value={mode}
          onValueChange={(value: AssistedFiscalItem["modoPis"]) =>
            onChange(pis ? { modoPis: value } : { modoCofins: value })
          }
        >
          <SelectTrigger disabled={!cst}><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            {contributionModeOptions(cst).map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {mode === "PERCENTUAL" ? (
        <Field label={`Alíquota ${type} (%)`} required>
          <Input
            type="number"
            inputMode="decimal"
            value={rate}
            onChange={(event) =>
              onChange(pis ? { aliquotaPis: event.target.value } : { aliquotaCofins: event.target.value })
            }
          />
        </Field>
      ) : null}
      {mode === "QUANTIDADE" ? (
        <>
          <Field label={`Quantidade base ${type}`} required>
            <Input
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(event) =>
                onChange(pis ? { quantidadePis: event.target.value } : { quantidadeCofins: event.target.value })
              }
            />
          </Field>
          <Field label={`Alíquota por unidade ${type}`} required>
            <Input
              type="number"
              inputMode="decimal"
              value={unitRate}
              onChange={(event) =>
                onChange(
                  pis
                    ? { aliquotaPorUnidadePis: event.target.value }
                    : { aliquotaPorUnidadeCofins: event.target.value },
                )
              }
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}
