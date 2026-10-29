"use client";

import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FiscalInformationBadge } from "@/components/fiscal/fiscal-information-badge";
import { FontesDoAvisoFiscal } from "@/components/fiscal/fontes-do-aviso-fiscal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { resolverTratamentoIcms } from "@/lib/nfe/icms";
import { alternarCienciaFiscal, avisoFiscalConfirmado } from "@/lib/nfe/issuesFiscais";
import { CSOSN_DESCRICOES, CST_ICMS_DESCRICOES, ORIGENS_MERCADORIA } from "@/lib/nfe/rotulosFiscais";

import {
  calcularIcmsDoItem,
  destacaIcmsProprio,
  reteIcmsSt,
  tratamentoIcmsDoItem,
  valoresSemUsoNoCodigo,
  type AssistedFiscalItem,
  type ContextoBaseIcms,
  type FiscalSetup,
} from "./emissao-assistida-model";

/** Modalidade da base do ICMS-ST (modBCST), leiaute 4.00. */
const MODALIDADES_BC_ST = [
  ["0", "Preço tabelado ou máximo sugerido"],
  ["1", "Lista negativa (valor)"],
  ["2", "Lista positiva (valor)"],
  ["3", "Lista neutra (valor)"],
  ["4", "Margem de valor agregado (%)"],
  ["5", "Pauta (valor)"],
  ["6", "Valor da operação"],
] as const;

type Props = {
  item: AssistedFiscalItem;
  setup: FiscalSetup;
  /** Frete do item e decisão da nota sobre ele entrar na base (mesmos dados do servidor). */
  contextoBase?: ContextoBaseIcms;
  procedencia: Record<string, string>;
  onChange: (patch: Partial<AssistedFiscalItem>) => void;
  Field: (props: {
    label: string;
    required?: boolean;
    hint?: string;
    origem?: string;
    className?: string;
    children: React.ReactNode;
  }) => React.ReactElement;
};

function moeda(valor: number | null | undefined) {
  return Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function tituloDoAvisoFiscal(code: string, rotuloCodigo: string) {
  if (code.startsWith("NFE_CFOP_")) {
    return `Aviso fiscal — confira o CFOP e o ${rotuloCodigo}`;
  }
  return "Aviso fiscal — confirme a ciência";
}

function tituloDoInformativoFiscal(code: string) {
  if (code === "NFE_ST_RETIDA_POLITICA_UF") {
    return "Informações opcionais de ICMS-ST anteriormente retido";
  }
  if (code === "NFE_ICMS_EFETIVO_POLITICA_UF") {
    return "Informações opcionais de ICMS efetivo";
  }
  return "Informação fiscal";
}

type TrocaPendente = {
  patch: Partial<AssistedFiscalItem>;
  codigo: string;
  sobras: Array<{ rotulo: string; valor: string }>;
  perdeCiencia: boolean;
};

export function NfeItemIcmsSection({ item, setup, contextoBase, procedencia, onChange, Field }: Props) {
  const [trocaPendente, setTrocaPendente] = useState<TrocaPendente | null>(null);
  const rules = setup.regrasFiscais;
  const crt = Number(setup.empresa?.crt ?? 0);
  const tratamento = tratamentoIcmsDoItem(item, setup);
  const calculo = calcularIcmsDoItem(item, setup, contextoBase);
  const composicao = calculo.composicaoBase;
  const valores = calculo.valores;
  const sobras = valoresSemUsoNoCodigo(item, tratamento);
  const proprio = destacaIcmsProprio(item, tratamento);
  const st = reteIcmsSt(item, tratamento);
  const regra = tratamento?.blocos;
  const rotuloCodigo = tratamento ? `${tratamento.regime === "SIMPLES" ? "CSOSN" : "CST"} ${tratamento.codigo}` : "";

  /**
   * Trocar o CST muda o que o grupo aceita. Antes de aplicar, a tela mostra o
   * que deixa de valer e pede confirmação — os valores continuam guardados no
   * item, mas não entram no cálculo do novo código.
   */
  function trocarCodigo(patch: Pick<AssistedFiscalItem, "cst" | "csosn">) {
    const novo = { ...item, ...patch };
    const novoTratamento = resolverTratamentoIcms({ crt: crt as 1 | 2 | 3 | 4, cst: novo.cst, csosn: novo.csosn });
    const antes = new Set(sobras.map((sobra) => `${sobra.rotulo}|${sobra.valor}`));
    const novasSobras = valoresSemUsoNoCodigo(novo, novoTratamento).filter(
      (sobra) => !antes.has(`${sobra.rotulo}|${sobra.valor}`),
    );
    const perdeCiencia = item.avisosFiscaisConfirmados.length > 0;
    // A ciência foi dada para a combinação antiga de CFOP e CST.
    const completo = { ...patch, avisosFiscaisConfirmados: [] as string[] };
    if (!item.cst && !item.csosn) {
      onChange(completo);
      return;
    }
    if (novasSobras.length === 0 && !perdeCiencia) {
      onChange(completo);
      return;
    }
    setTrocaPendente({
      patch: completo,
      codigo: patch.cst ? `CST ${patch.cst}` : `CSOSN ${patch.csosn}`,
      sobras: novasSobras,
      perdeCiencia,
    });
  }

  function numero(campo: keyof AssistedFiscalItem, label: string, opcoes: { required?: boolean; hint?: string; origem?: string } = {}) {
    return (
      <Field label={label} required={opcoes.required} hint={opcoes.hint} origem={opcoes.origem}>
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          value={String(item[campo] ?? "")}
          onChange={(event) => onChange({ [campo]: event.target.value } as Partial<AssistedFiscalItem>)}
        />
      </Field>
    );
  }


  return (
    <section className="min-w-0 space-y-4 rounded-lg border p-3 sm:p-4 bg-card">
      <h3 className="text-sm font-semibold">ICMS</h3>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Origem da mercadoria" required origem={procedencia.origem_mercadoria} className="sm:col-span-2">
          <Select value={item.orig} onValueChange={(orig) => onChange({ orig })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent className="w-[calc(100vw-2rem)] max-w-[32rem]">
              {ORIGENS_MERCADORIA.map(([value, label]) => (
                <SelectItem className="break-words whitespace-normal py-2 [overflow-wrap:anywhere]" key={value} value={value}>
                  {value} - {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {rules?.icms.csosn === "REQUIRED" ? (
          <Field label="CSOSN" required origem={procedencia.csosn} className="sm:col-span-2">
            <Select value={item.csosn} onValueChange={(csosn) => trocarCodigo({ csosn, cst: "" })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent className="w-[calc(100vw-2rem)] max-w-[34rem]">
                {rules.icms.csosnPermitidos.map((code) => (
                  <SelectItem className="break-words whitespace-normal py-2 [overflow-wrap:anywhere]" key={code} value={code}>
                    {code} - {CSOSN_DESCRICOES[code] || code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {rules?.icms.cst === "REQUIRED" ? (
          <Field label="CST ICMS" required origem={procedencia.cst} className="sm:col-span-2">
            <Select value={item.cst} onValueChange={(cst) => trocarCodigo({ cst, csosn: "" })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent className="w-[calc(100vw-2rem)] max-w-[30rem]">
                {rules.icms.cstPermitidos.map((code) => (
                  <SelectItem className="break-words whitespace-normal py-2 [overflow-wrap:anywhere]" key={code} value={code}>
                    {code} - {CST_ICMS_DESCRICOES[code] || code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {regra?.proprio === "OPCIONAL" ? (
          <div className="flex min-w-0 items-center gap-2 sm:col-span-2">
            <Switch
              id={`destacar-${item.sourceItemId}`}
              checked={item.icmsDestacarProprio}
              onCheckedChange={(checked) => onChange({ icmsDestacarProprio: checked })}
            />
            <Label htmlFor={`destacar-${item.sourceItemId}`} className="text-xs">
              Destacar ICMS próprio neste item
            </Label>
          </div>
        ) : null}

        {proprio ? (
          <>
            {numero("aliquotaIcms", "Alíquota do ICMS próprio (%)", { required: true, origem: procedencia.aliquotaicms })}
            {regra && regra.reducaoBase !== "PROIBIDO"
              ? numero("pRedBC", "Redução da base (%)", { required: regra.reducaoBase === "OBRIGATORIO" })
              : null}
            {regra && regra.diferimento !== "PROIBIDO" ? numero("pDif", "Diferimento (%)", { hint: "Em branco: sem diferimento." }) : null}
            {regra && regra.fcp !== "PROIBIDO" ? numero("pFCP", "FCP (%)", { hint: "Só quando a UF exige FCP sobre o ICMS próprio." }) : null}
          </>
        ) : null}
      </div>

      {regra?.st === "OPCIONAL" ? (
        <div className="flex min-w-0 items-center gap-2">
          <Switch
            id={`reter-st-${item.sourceItemId}`}
            checked={item.icmsReterSt}
            onCheckedChange={(checked) => onChange({ icmsReterSt: checked })}
          />
          <Label htmlFor={`reter-st-${item.sourceItemId}`} className="text-xs">
            Reter ICMS-ST nesta operação
          </Label>
        </div>
      ) : null}

      {st ? (
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium">ICMS-ST retido nesta operação</p>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Modalidade da BC ST" required className="sm:col-span-2">
              <Select value={item.modBCST || (item.pMVAST.trim() ? "4" : "")} onValueChange={(modBCST) => onChange({ modBCST })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {MODALIDADES_BC_ST.map(([value, label]) => (
                    <SelectItem key={value} value={value}>{value} - {label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {numero("pMVAST", "MVA ST (%)", { hint: "Com a MVA o ERP calcula a base; ou informe a base." })}
            {numero("pRedBCST", "Redução da BC ST (%)")}
            {numero("vBCST", "BC ST (R$)", { hint: "Em branco: calculada pela MVA." })}
            {numero("pICMSST", "Alíquota ST (%)", { required: true })}
            {numero("vICMSST", "ICMS-ST (R$)", {
              required: !proprio,
              hint: proprio
                ? "Em branco: BC ST × alíquota − ICMS próprio."
                : "Obrigatório: sem ICMS próprio no item, a dedução depende da legislação.",
            })}
            {regra && regra.fcpSt !== "PROIBIDO" ? numero("pFCPST", "FCP-ST (%)") : null}
          </div>
        </div>
      ) : null}

      {regra && regra.stRetida !== "PROIBIDO" ? (
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium">Informações opcionais de ICMS-ST anteriormente retido</p>
          <p className="text-[11px] text-muted-foreground">
            Use os dados da operação ou do documento de origem quando forem aplicáveis. O ERP não calcula nem
            estima esses valores; o grupo pode permanecer totalmente em branco.
          </p>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {numero("vBCSTRet", "BC ST retida (R$)")}
            {numero("pST", "Alíquota suportada pelo consumidor final (%)")}
            {numero("vICMSSubstituto", "ICMS próprio do substituto (R$)")}
            {numero("vICMSSTRet", "ICMS-ST retido (R$)")}
            {numero("vBCFCPSTRet", "BC FCP-ST retido (R$)")}
            {numero("pFCPSTRet", "FCP-ST retido (%)")}
            {numero("vFCPSTRet", "FCP-ST retido (R$)")}
          </div>
        </div>
      ) : null}

      {regra && regra.desoneracao !== "PROIBIDO" ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {numero("vICMSDeson", "ICMS desonerado (R$)")}
          <Field label="Motivo da desoneração" hint="Código do motivo (motDesICMS) do leiaute.">
            <Input value={item.motDesICMS} inputMode="numeric" onChange={(event) => onChange({ motDesICMS: event.target.value })} />
          </Field>
        </div>
      ) : null}

      {regra && regra.creditoSn !== "PROIBIDO" ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {numero("pCredSN", "Crédito do Simples (%)", { required: regra.creditoSn === "OBRIGATORIO" })}
        </div>
      ) : null}

      {valores ? (
        <p className="rounded border bg-muted/40 px-3 py-2 text-xs">
          <strong>{valores.grupoXml}</strong>
          {valores.vICMS !== null
            ? ` · BC própria ${moeda(valores.vBC)} · ICMS próprio ${moeda(valores.vICMS)}`
            : " · sem ICMS próprio nesta nota"}
          {valores.vICMSST !== null ? ` · BC ST ${moeda(valores.vBCST)} · ICMS-ST ${moeda(valores.vICMSST)}` : ""}
          {valores.vICMSSTRet !== null ? ` · ICMS-ST retido anteriormente ${moeda(valores.vICMSSTRet)}` : ""}
          {composicao && composicao.frete > 0 && (valores.vBC !== null || valores.vBCST !== null)
            ? ` · frete de ${moeda(composicao.frete)} ${composicao.freteIntegraBaseIcms ? "incluído" : "fora"} da base própria${valores.vBCST !== null ? " e incluído na base da ST" : ""}`
            : ""}
        </p>
      ) : null}

      {calculo.camposIgnorados.length > 0 || sobras.length > 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Valores guardados que não entram no cálculo</AlertTitle>
          <AlertDescription className="min-w-0">
            <ul className="mt-1 list-disc space-y-1 pl-4 [overflow-wrap:anywhere]">
              {calculo.camposIgnorados.map((ignorado) => (
                <li key={ignorado.campo}>{ignorado.motivo}</li>
              ))}
              {sobras.map((sobra) => (
                <li key={sobra.rotulo}>
                  {sobra.rotulo}: {sobra.valor} — o {rotuloCodigo} não usa este campo.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <FiscalInformationBadge
        messages={calculo.informativos.map(
          (informativo) => `${tituloDoInformativoFiscal(informativo.code)}: ${informativo.message}`,
        )}
      />

      {calculo.avisos.map((aviso) => (
        <Alert
          key={aviso.code}
          className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{tituloDoAvisoFiscal(aviso.code, rotuloCodigo)}</AlertTitle>
          <AlertDescription className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
            <p>{aviso.message}</p>
            <FontesDoAvisoFiscal fontes={aviso.fontes} />
            <div className="flex items-start gap-2">
              <Checkbox
                id={`ciencia-${item.sourceItemId}-${aviso.code}`}
                checked={avisoFiscalConfirmado(aviso, item.avisosFiscaisConfirmados)}
                onCheckedChange={(checked) =>
                  onChange({
                    avisosFiscaisConfirmados: alternarCienciaFiscal(
                      item.avisosFiscaisConfirmados,
                      aviso,
                      checked === true,
                    ),
                  })
                }
              />
              <Label htmlFor={`ciencia-${item.sourceItemId}-${aviso.code}`} className="text-xs font-normal leading-snug">
                Li este aviso e confirmo que os dados da operação foram conferidos.
              </Label>
            </div>
          </AlertDescription>
        </Alert>
      ))}

      <AlertDialog open={Boolean(trocaPendente)} onOpenChange={(aberto) => !aberto && setTrocaPendente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar para {trocaPendente?.codigo}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {trocaPendente?.sobras.length ? (
                  <>
                    <p>O novo código não usa estes valores. Eles ficam guardados no item, mas não entram no cálculo:</p>
                    <ul className="list-disc pl-4">
                      {trocaPendente.sobras.map((sobra) => (
                        <li key={sobra.rotulo}>{sobra.rotulo}: {sobra.valor}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {trocaPendente?.perdeCiencia ? (
                  <p>A ciência dada aos avisos fiscais valia para o código anterior e será pedida de novo.</p>
                ) : null}
                <p>O ERP não troca o CST por conta própria: a escolha continua sendo sua.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter o código atual</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (trocaPendente) onChange(trocaPendente.patch);
                setTrocaPendente(null);
              }}
            >
              Trocar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
