"use client";

import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";

import { CfopCombobox } from "@/components/fiscal/cfop-combobox";
import { NcmCombobox } from "@/components/fiscal/ncm-combobox";
import { FiscalInformationBadge } from "@/components/fiscal/fiscal-information-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { NFeOperationDirection } from "@/lib/nfe/cfopOperation";
import type { ModeloDocumentoFiscal } from "@/lib/nfe/types";
import { alternarCienciaFiscal, classificarIssuesFiscais } from "@/lib/nfe/issuesFiscais";
import { FontesDoAvisoFiscal } from "@/components/fiscal/fontes-do-aviso-fiscal";
import { LIMITE_XPROD } from "@/lib/nfe/limites";
import { ALIQUOTAS_INTERESTADUAIS_VALIDAS } from "@/lib/nfe/difal";
import {
  getRequiredPisCofinsMode,
  PIS_COFINS_CST_OPTIONS,
} from "@/lib/nfe/taxRules";

import {
  type AssistedFiscalItem,
  type AssistedItemIssue,
  type ContextoBaseIcms,
  type DifalCampoManual,
  type FiscalSetup,
  type RegraResolvidaTela,
  calcularIcmsDoItem,
  inferPisCofinsMode,
  marcarDifalManual,
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

/**
 * Situação do DIFAL do item, num selo só.
 *
 * Existe porque "campo preenchido" não diz de onde veio o número. Um 0 que o
 * motor determinou e um 0 que alguém digitou produzem a mesma tela e
 * consequências fiscais diferentes.
 */
function StatusDifal({ item }: { item: AssistedFiscalItem }) {
  const resolucao = item.difalResolucao;
  const temManual = (item.difalCamposManuais?.length ?? 0) > 0;

  if (temManual) {
    return (
      <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
        Ajustado manualmente
      </span>
    );
  }
  if (resolucao?.resolvidoAutomaticamente) {
    return (
      <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
        Determinado automaticamente
      </span>
    );
  }
  return (
    <span className="rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
      Confirmação necessária
    </span>
  );
}

const ROTULO_ORIGEM: Record<string, string> = {
  REGRA_UF: "regra geral da UF",
  REGRA_NCM: "regra por NCM",
  REGRA_NCM_PREFIXO: "regra por faixa de NCM",
  REGRA_CEST: "regra por CEST",
  REGRA_NCM_CEST: "regra por NCM + CEST",
  REGRA_BENEFICIO: "benefício fiscal",
  REGRA_EXCECAO: "exceção cadastrada",
};

function dataBr(iso: string | null | undefined) {
  if (!iso) return null;
  const [ano, mes, dia] = iso.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * Linha discreta sob o campo: qual regra respondeu, de que vigência e com que
 * fundamento. É o que permite responder, meses depois, por que a nota usou
 * aquela alíquota — sem abrir o banco.
 */
function ProvenienciaDifal({
  campo,
  item,
  regra,
}: {
  campo: DifalCampoManual;
  item: AssistedFiscalItem;
  regra: RegraResolvidaTela | null;
}) {
  if (item.difalCamposManuais?.includes(campo)) {
    return (
      <p className="mt-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
        Valor informado manualmente — deixa de valer a regra automática.
      </p>
    );
  }
  if (!regra) return null;

  const vigencia = regra.vigenciaFim
    ? `${dataBr(regra.vigenciaInicio)} a ${dataBr(regra.vigenciaFim)}`
    : `desde ${dataBr(regra.vigenciaInicio)}`;

  return (
    <p
      className="mt-1 text-[11px] leading-snug text-muted-foreground"
      title={[regra.regraDescricao, regra.fundamentoLegal, regra.fonte].filter(Boolean).join(" · ")}
    >
      {regra.valor}% — {ROTULO_ORIGEM[regra.origem] ?? "regra fiscal"}, vigente {vigencia}
      {regra.fundamentoLegal ? ` (${regra.fundamentoLegal})` : ""}
    </p>
  );
}

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PERCENTUAL = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Resumo do que o DIFAL vai valer neste item, em reais.
 *
 * As alíquotas sozinhas não dizem quanto a nota vai pagar, e o campo "Base do
 * FCP" fica de propósito em branco — vazio ali significa "mesma base do DIFAL",
 * e preencher com um número o congelaria: mudar o desconto do item depois
 * deixaria a base do FCP defasada. Então o valor aparece aqui, calculado,
 * em vez de virar um campo editável que ninguém lembra de reconferir.
 */
function ResumoDifal({
  item,
  base,
}: {
  item: AssistedFiscalItem;
  /** Base do DIFAL pela composição canônica do motor, já com a regra do frete. */
  base: number;
}) {
  const numero = (texto: string) => {
    const valor = Number(String(texto).replace(",", "."));
    return Number.isFinite(valor) ? valor : null;
  };

  const interna = numero(item.difalAliquotaInterna);
  const interestadual = numero(item.difalAliquotaInterestadual);
  const fcp = numero(item.difalAliquotaFcp);
  const partilha = numero(item.difalPercentualPartilha) ?? 100;
  const baseFcp = numero(item.difalBaseFcp) ?? base;

  if (interna === null || interestadual === null || base <= 0) return null;

  const diferenca = Math.max(0, interna - interestadual);
  const valorDifal = Number(((base * (diferenca / 100) * partilha) / 100).toFixed(2));
  const valorFcp = fcp === null ? null : Number((baseFcp * (fcp / 100)).toFixed(2));

  const linha = (rotulo: string, valor: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="font-medium tabular-nums">{valor}</span>
    </div>
  );

  return (
    <div className="grid gap-x-6 gap-y-1 rounded-md border bg-muted/40 p-3 text-xs sm:grid-cols-2">
      {linha("Base do DIFAL", MOEDA.format(base))}
      {linha("Valor do DIFAL", MOEDA.format(valorDifal))}
      {linha("Base do FCP", MOEDA.format(baseFcp))}
      {linha(
        "Valor do FCP",
        valorFcp === null ? "—" : MOEDA.format(valorFcp),
      )}
      {linha("Partilha ao destino", `${PERCENTUAL.format(partilha)}%`)}
      {linha(
        "Diferença de alíquota",
        `${PERCENTUAL.format(diferenca)}%`,
      )}
    </div>
  );
}

/** O que falta para o DIFAL fechar, com a causa nomeada. */
function PendenciasDifal({ item }: { item: AssistedFiscalItem }) {
  const resolucao = item.difalResolucao;
  const mensagens: string[] = [];

  if (!item.difalAliquotaInterna.trim()) {
    mensagens.push(
      "Não foi possível determinar automaticamente a alíquota interna da UF de destino. Informe a alíquota vigente antes de emitir.",
    );
  }
  if (!item.difalAliquotaFcp.trim()) {
    mensagens.push(
      "Não foi possível determinar automaticamente o FCP desta mercadoria na UF de destino. Confirme a tributação e informe inclusive zero quando não devido.",
    );
  }
  for (const conflito of resolucao?.conflitos ?? []) {
    mensagens.push(
      `Regras fiscais conflitantes para ${conflito.campo}: ${conflito.regras
        .map((regra) => `#${regra.id} (${regra.valor}%)`)
        .join(" x ")}. Ajuste a vigência ou a prioridade de uma delas.`,
    );
  }
  if (resolucao?.pendencias?.includes("NCM_INVALIDO")) {
    mensagens.push(
      "NCM ausente ou inválido: sem os 8 dígitos não dá para saber se esta mercadoria tem regra própria na UF de destino.",
    );
  }
  if (resolucao?.pendencias?.includes("NCM_INEXISTENTE")) {
    mensagens.push(
      `O NCM ${onlyDigits(item.ncm) || "informado"} tem 8 dígitos mas não existe na Nomenclatura Comum do Mercosul. ` +
        "Um código inexistente nunca casa com regra por mercadoria e cairia na regra geral da UF. Corrija o NCM no cadastro do produto.",
    );
  }

  if (mensagens.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs text-destructive">
      {mensagens.map((mensagem) => (
        <li key={mensagem}>{mensagem}</li>
      ))}
    </ul>
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
  if (!item) return null;

  const rules = setup.regrasFiscais;
  // Procedência com que o servidor montou o item. Não acompanha a edição: o
  // selo descreve como o campo abriu, não o que o usuário digitou depois.
  const proc = item.procedenciaFiscal ?? {};
  // CEST é exigido quando o item retém ICMS-ST — o mesmo critério do XML.
  const icmsDoItem = calcularIcmsDoItem(item, setup, contextoBase);
  const needsCest = icmsDoItem.valores?.vBCST != null;
  // Base do DIFAL: a mesma que `resolverDifalDoItem` usa — a composição do
  // ICMS próprio, que já decidiu se o frete entra (modFrete 0/3 entram por lei,
  // nos demais vale a escolha do usuário). Repetir a fórmula aqui faria o
  // resumo divergir do imposto assim que houvesse frete na nota.
  const baseDifal =
    icmsDoItem.composicaoBase?.baseIcmsProprio ??
    Number(
      (
        item.quantidade * item.valorUnitario -
        (item.valorDesconto ?? 0) +
        Number(contextoBase?.valorFrete ?? 0)
      ).toFixed(2),
    );
  const issuesClassificadas = classificarIssuesFiscais(issues);

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

        {issuesClassificadas.bloqueios.length > 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>
              {issuesClassificadas.bloqueios.length}{" "}
              {issuesClassificadas.bloqueios.length === 1 ? "pendência fiscal" : "pendências fiscais"}
            </AlertTitle>
            <AlertDescription className="min-w-0">
              <ul className="mt-1 min-w-0 list-disc space-y-1 pl-4 [overflow-wrap:anywhere]">
                {issuesClassificadas.bloqueios.map((issue, index) => (
                  <li key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {issuesClassificadas.avisos.length > 0 ? (
          <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {issuesClassificadas.avisos.length === 1
                ? "Aviso fiscal — confirme a ciência"
                : `${issuesClassificadas.avisos.length} avisos fiscais — confirme a ciência`}
            </AlertTitle>
            <AlertDescription className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
              {issuesClassificadas.avisos.map((issue, index) => {
                const checkboxId = `ciencia-issue-${item.sourceItemId}-${issue.code}-${index}`;
                return (
                  <div key={`${issue.code}-${issue.field}-${index}`} className="space-y-2">
                    <p>{issue.message}</p>
                    <FontesDoAvisoFiscal fontes={issue.fontes} />
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id={checkboxId}
                        checked={false}
                        onCheckedChange={(checked) => {
                          if (!checked) return;
                          onChange({
                            avisosFiscaisConfirmados: alternarCienciaFiscal(
                              item.avisosFiscaisConfirmados,
                              issue,
                              true,
                            ),
                          });
                        }}
                      />
                      <Label htmlFor={checkboxId} className="text-xs font-normal leading-snug">
                        Li este aviso e confirmo que os dados da operação foram conferidos.
                      </Label>
                    </div>
                  </div>
                );
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <FiscalInformationBadge
          messages={issuesClassificadas.informativos.map((issue) => issue.message)}
        />

        {issuesClassificadas.pronto ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Produto pronto para emissão</AlertTitle>
            <AlertDescription>Os dados preenchidos são compatíveis com as regras atuais do motor.</AlertDescription>
          </Alert>
        ) : null}

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
            <Field label="Título na NF-e" required className="lg:col-span-5">
              {/* É o xProd da nota. Editar aqui vale só para este documento: o
                  cadastro do produto não é alterado, e a próxima nota volta a
                  nascer com o título dele. */}
              <Input
                value={item.descricao}
                maxLength={LIMITE_XPROD}
                onChange={(event) => onChange({ descricao: event.target.value })}
              />
            </Field>
            <Field label="NCM" required className="lg:col-span-2">
              {/* Trocar o NCM muda a assinatura fiscal do item, e o diálogo
                  refaz a resolução do DIFAL — o mesmo caminho de sempre, sem
                  um segundo motor. */}
              <NcmCombobox
                value={item.ncm}
                onValueChange={(ncm) => onChange({ ncm })}
                dataFiscal={contextoBase?.dataEmissao}
              />
            </Field>
            <Field label="CFOP" required origem={proc.cfop} className="lg:col-span-2">
              <CfopCombobox
                value={item.cfop}
                modelo={modelo}
                operation={tipoOperacao}
                emitterUf={setup.empresa?.uf}
                partnerUf={parceiroUf}
                onValueChange={(cfop) =>
                  onChange({
                    cfop,
                    cfopResolution: null,
                    // A ciência valia para o CFOP anterior.
                    avisosFiscaisConfirmados: [],
                    procedenciaFiscal: {
                      ...item.procedenciaFiscal,
                      cfop: "USUARIO",
                    },
                  })
                }
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
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">
                  DIFAL — partilha para a UF de destino
                  {parceiroUf ? ` (${parceiroUf})` : ""}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Venda interestadual a consumidor final não contribuinte. Os campos são
                  obrigatórios: sem eles a nota não sai.
                </p>
              </div>
              <StatusDifal item={item} />
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Alíquota interna do destino (%)" required>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="Informe a alíquota vigente"
                  value={item.difalAliquotaInterna}
                  onChange={(event) =>
                    onChange({
                      difalAliquotaInterna: event.target.value,
                      difalCamposManuais: marcarDifalManual(
                        item.difalCamposManuais,
                        "aliquotaInterna",
                      ),
                    })
                  }
                />
                <ProvenienciaDifal
                  campo="aliquotaInterna"
                  item={item}
                  regra={item.difalResolucao?.regraAliquotaInterna ?? null}
                />
              </Field>
              <Field label="Alíquota interestadual (%)" required>
                {/* Seleção, não número livre: o leiaute só aceita 4, 7 ou 12 em pICMSInter. */}
                <Select
                  value={item.difalAliquotaInterestadual}
                  onValueChange={(valor) =>
                    onChange({
                      difalAliquotaInterestadual: valor,
                      difalCamposManuais: marcarDifalManual(
                        item.difalCamposManuais,
                        "aliquotaInterestadual",
                      ),
                    })
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {ALIQUOTAS_INTERESTADUAIS_VALIDAS.map((aliquota) => (
                      <SelectItem key={aliquota} value={String(aliquota)}>{aliquota}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  Origem da mercadoria e UFs envolvidas (Resolução do Senado 13/2012).
                </p>
              </Field>
              <Field label="Partilha ao destino (%)">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max="100"
                  value={item.difalPercentualPartilha}
                  onChange={(event) =>
                    onChange({
                      difalPercentualPartilha: event.target.value,
                      difalCamposManuais: marcarDifalManual(
                        item.difalCamposManuais,
                        "percentualPartilha",
                      ),
                    })
                  }
                />
              </Field>
              <Field label="Alíquota FCP (%)" required>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max="100"
                  // Sem placeholder numérico: um "0" cinza é indistinguível de um
                  // zero informado, e a diferença entre os dois é justamente o
                  // que decide se a nota sai.
                  placeholder="Informe 0 se não devido"
                  value={item.difalAliquotaFcp}
                  onChange={(event) =>
                    onChange({
                      difalAliquotaFcp: event.target.value,
                      difalCamposManuais: marcarDifalManual(item.difalCamposManuais, "aliquotaFcp"),
                    })
                  }
                />
                <ProvenienciaDifal
                  campo="aliquotaFcp"
                  item={item}
                  regra={item.difalResolucao?.regraFcp ?? null}
                />
              </Field>
              <Field label="Base do FCP (R$)">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="Mesma do DIFAL"
                  value={item.difalBaseFcp}
                  onChange={(event) =>
                    onChange({
                      difalBaseFcp: event.target.value,
                      difalCamposManuais: marcarDifalManual(item.difalCamposManuais, "baseFcp"),
                    })
                  }
                />
              </Field>
            </div>
            <ResumoDifal item={item} base={baseDifal} />
            <PendenciasDifal item={item} />
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
            {issuesClassificadas.pronto ? "Concluir" : "Continuar depois"}
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
