"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronsUpDown } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import ValueInput from "@/components/ui/value-input";
import { cn } from "@/lib/utils";
import {
  listCfopsForEmission,
  type NFeOperationDirection,
} from "@/lib/nfe/cfopOperation";
import type { ModeloDocumentoFiscal } from "@/lib/nfe/types";
import {
  getRequiredPisCofinsMode,
  PIS_COFINS_CST_OPTIONS,
} from "@/lib/nfe/taxRules";

import {
  type AssistedFiscalItem,
  type AssistedItemIssue,
  type ContextoBaseIcms,
  type FiscalSetup,
  calcularIcmsDoItem,
  inferPisCofinsMode,
  onlyDigits,
} from "./emissao-assistida-model";
import { NfeItemIcmsSection } from "./nfe-item-icms-section";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: AssistedFiscalItem | null;
  setup: FiscalSetup;
  issues: AssistedItemIssue[];
  modelo: ModeloDocumentoFiscal;
  tipoOperacao: NFeOperationDirection;
  parceiroUf?: string | null;
  /** Frete do item e decisão da nota sobre ele entrar na base do ICMS. */
  contextoBase?: ContextoBaseIcms;
  onChange: (patch: Partial<AssistedFiscalItem>) => void;
};


/**
 * Selo de procedência do valor que abriu no campo.
 *
 * Só aparece para o que não veio do cadastro do produto. Sem isso, quem emite
 * não distingue "o sistema preencheu pelo padrão de Configurações" de "alguém
 * cadastrou este produto assim" — e é essa diferença que decide se corrigir o
 * item resolve uma nota ou todas as próximas.
 */
const SELOS: Record<string, { texto: string; titulo: string }> = {
  NFE_ENTRADA: {
    texto: "NF-e de origem",
    titulo:
      "Copiado da NF-e que trouxe a mercadoria. A devolução tem de espelhar a compra, então este valor vale mais que o cadastro do produto.",
  },
  PADRAO: {
    texto: "padrão",
    titulo:
      "Veio do padrão fiscal em Configurações › Fiscal, porque o produto não tem este campo.",
  },
  PADRAO_NFE: {
    texto: "padrão NF-e",
    titulo:
      "A NFC-e ainda não tem padrão próprio, então aproveitou o da NF-e. Para separar os dois, preencha o padrão da NFC-e em Configurações › Fiscal.",
  },
  PADRAO_SAIDA_VENDA: {
    texto: "padrão de venda",
    titulo:
      "Esta saída não é venda, mas o padrão de saída sem venda ainda está em branco, então valeu o de venda. Confira: devolução e remessa costumam ter outra tributação. Cadastre em Configurações › Fiscal › NF-e · saída (não venda).",
  },
  REGRA: {
    texto: "regra",
    titulo: "Imposto pelo CST escolhido; alterar aqui seria recusado na validação.",
  },
};

function SeloProcedencia({ origem }: { origem?: string }) {
  const selo = origem ? SELOS[origem] : undefined;
  if (!selo) return null;
  return (
    <span
      className="ml-1 rounded border px-1 py-px align-middle text-[10px] font-normal text-muted-foreground"
      title={selo.titulo}
    >
      {selo.texto}
    </span>
  );
}

function Field({
  label,
  required,
  hint,
  origem,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  hint?: string;
  /** Procedência do valor inicial: 'PRODUTO', 'PADRAO', 'REGRA' ou 'VAZIO'. */
  origem?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 max-w-full space-y-1.5 [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:max-w-full [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:max-w-full [&_[data-slot=select-trigger]]:overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:overflow-hidden [&_[data-slot=select-value]]:text-ellipsis ${className}`}
    >
      <Label className="break-words text-xs">
        {label} {required ? <span className="text-destructive">*</span> : null}
        <SeloProcedencia origem={origem} />
      </Label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
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
  modelo,
  tipoOperacao,
  parceiroUf,
  contextoBase,
  onChange,
}: Props) {
  const [cfopOpen, setCfopOpen] = useState(false);
  const cfops = useMemo(
    () =>
      listCfopsForEmission({
        modelo,
        operation: tipoOperacao,
        emitterUf: setup.empresa?.uf,
        partnerUf: parceiroUf,
      }),
    [modelo, parceiroUf, setup.empresa?.uf, tipoOperacao],
  );
  if (!item) return null;

  const rules = setup.regrasFiscais;
  // Procedência com que o servidor montou o item. Não acompanha a edição: o
  // selo descreve como o campo abriu, não o que o usuário digitou depois.
  const proc = item.procedenciaFiscal ?? {};
  // CEST é exigido quando o item retém ICMS-ST — o mesmo critério do XML.
  const needsCest = calcularIcmsDoItem(item, setup, contextoBase).valores?.vBCST != null;
  // Avisos de CFOP × CST têm seção própria, com a caixa de ciência.
  const pendencias = issues.filter((issue) => !issue.requerCiencia);
  const avisosPendentes = issues.length - pendencias.length;

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

        {pendencias.length > 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{pendencias.length} pendência(s) fiscal(is)</AlertTitle>
            <AlertDescription className="min-w-0">
              <ul className="mt-1 min-w-0 list-disc space-y-1 pl-4 [overflow-wrap:anywhere]">
                {pendencias.map((issue, index) => (
                  <li key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : avisosPendentes > 0 ? (
          <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Confirme a ciência do aviso de CFOP × CST</AlertTitle>
            <AlertDescription>Veja o aviso na seção ICMS abaixo.</AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Produto pronto para emissão</AlertTitle>
            <AlertDescription>Os dados preenchidos são compatíveis com as regras atuais do motor.</AlertDescription>
          </Alert>
        )}

        {item.cfopResolution?.warning ? (
          <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>CFOP substituído automaticamente</AlertTitle>
            <AlertDescription>{item.cfopResolution.warning}</AlertDescription>
          </Alert>
        ) : null}

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
            <Field label="CFOP" required origem={proc.cfop} className="lg:col-span-2">
              <Popover open={cfopOpen} onOpenChange={setCfopOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={cfopOpen}
                    className="w-full justify-between px-3 font-normal"
                  >
                    <span className="truncate">{item.cfop || "Selecione"}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[min(34rem,calc(100vw-2rem))] p-0"
                >
                  <Command>
                    <CommandInput placeholder="Buscar por código ou descrição..." />
                    <CommandList className="max-h-72">
                      <CommandEmpty>Nenhum CFOP permitido para esta operação.</CommandEmpty>
                      <CommandGroup>
                        {cfops.map((entry) => (
                          <CommandItem
                            key={entry.codigo}
                            value={`${entry.codigo} ${entry.descricao}`}
                            onSelect={() => {
                              onChange({
                                cfop: entry.codigo,
                                cfopResolution: null,
                                // A ciência valia para o CFOP anterior.
                                avisosFiscaisConfirmados: [],
                                procedenciaFiscal: {
                                  ...item.procedenciaFiscal,
                                  cfop: "USUARIO",
                                },
                              });
                              setCfopOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4 shrink-0",
                                item.cfop === entry.codigo ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="min-w-0">
                              <strong>{entry.codigo}</strong> — {entry.descricao}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
            <Field
              label="Desconto do item na NF-e"
              hint="Já traz o desconto do item somado ao rateio do desconto geral. Vai para vDesc e abate a base dos tributos."
              className="lg:col-span-3"
            >
              <ValueInput
                value={item.valorDesconto}
                onValueChange={(valorDesconto) => onChange({ valorDesconto })}
              />
            </Field>
            <Field label="Total do item na NF-e" className="lg:col-span-3">
              <Input
                value={Math.max(
                  0,
                  item.quantidade * item.valorUnitario - item.valorDesconto,
                ).toLocaleString("pt-BR", {
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

        <NfeItemIcmsSection
          item={item}
          setup={setup}
          contextoBase={contextoBase}
          procedencia={proc}
          onChange={onChange}
          Field={Field}
        />

        <section className="min-w-0 space-y-4 rounded-lg border p-3 sm:p-4 bg-card">
          <h3 className="text-sm font-semibold">PIS e COFINS</h3>
          <ContributionFields
            type="PIS"
            cst={item.cstPis}
            mode={item.modoPis}
            rate={item.aliquotaPis}
            quantity={item.quantidadePis}
            unitRate={item.aliquotaPorUnidadePis}
            procedencia={proc}
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
            procedencia={proc}
            onCstChange={(value) => updateContributionCst("COFINS", value)}
            onChange={onChange}
          />
        </section>

        {item.difalHabilitado ? (
          <section className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4 bg-card">
            <div>
              <h3 className="text-sm font-semibold">DIFAL — partilha para a UF de destino</h3>
              <p className="text-xs text-muted-foreground">
                Venda interestadual a consumidor final não contribuinte. Os valores abaixo são
                sugestões: confira a legislação vigente da UF de destino e ajuste se necessário.
              </p>
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Alíquota interna do destino (%)" required>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="Pesquise a alíquota vigente"
                  value={item.difalAliquotaInterna}
                  onChange={(event) => onChange({ difalAliquotaInterna: event.target.value })}
                />
              </Field>
              <Field label="Alíquota interestadual (%)" required>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={item.difalAliquotaInterestadual}
                  onChange={(event) => onChange({ difalAliquotaInterestadual: event.target.value })}
                />
              </Field>
              <Field label="Partilha ao destino (%)">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={item.difalPercentualPartilha}
                  onChange={(event) => onChange({ difalPercentualPartilha: event.target.value })}
                />
              </Field>
              <Field label="Alíquota FCP (%)">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="0"
                  value={item.difalAliquotaFcp}
                  onChange={(event) => onChange({ difalAliquotaFcp: event.target.value })}
                />
              </Field>
              <Field label="Base do FCP (R$)">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  placeholder="Mesma do DIFAL"
                  value={item.difalBaseFcp}
                  onChange={(event) => onChange({ difalBaseFcp: event.target.value })}
                />
              </Field>
            </div>
            {!item.difalAliquotaInterna.trim() ? (
              <p className="text-xs text-destructive">
                Informe a alíquota interna da UF de destino para calcular o DIFAL.
              </p>
            ) : null}
          </section>
        ) : null}

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
                <Field
                  label="Classificação tributária"
                  required
                  origem={proc.cclass_trib}
                  className="sm:col-span-2 lg:col-span-2"
                >
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
                <Field label="CST IBS/CBS" required origem={proc.cst_ibscbs}>
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
  procedencia,
  onCstChange,
  onChange,
}: {
  type: "PIS" | "COFINS";
  cst: string;
  mode: AssistedFiscalItem["modoPis"];
  rate: string;
  quantity: string;
  unitRate: string;
  procedencia?: Record<string, string>;
  onCstChange: (value: string) => void;
  onChange: (patch: Partial<AssistedFiscalItem>) => void;
}) {
  const pis = type === "PIS";
  // Nome da coluna correspondente, para ler a procedência que o servidor mandou.
  const chave = pis ? "pis" : "cofins";
  const options = PIS_COFINS_CST_OPTIONS.filter(
    (option) => option.operation === "SAIDA" || option.operation === "OUTROS",
  );
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field
        label={`CST ${type}`}
        required
        origem={procedencia?.[`cst_${chave}`]}
        className="sm:col-span-2"
      >
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
      <Field label={`Modo ${type}`} required origem={procedencia?.[`modo_${chave}`]}>
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
        <Field label={`Alíquota ${type} (%)`} required origem={procedencia?.[`aliquota_${chave}`]}>
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
          <Field
            label={`Alíquota por unidade ${type}`}
            required
            origem={procedencia?.[`aliquota_por_unidade_${chave}`]}
          >
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
