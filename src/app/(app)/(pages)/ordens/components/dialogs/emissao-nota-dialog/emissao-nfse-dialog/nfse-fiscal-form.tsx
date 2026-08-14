import type { FormEventHandler } from "react";
import {
  AlertCircle,
  ArrowLeft,
  FileCheck2,
  Info,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
  CodigosFiscaisForm,
  ModeloEmissao,
  ServicoOS,
  ValoresServicosForm,
} from "./types";

function getModeloLabel(modelo: ModeloEmissao) {
  if (modelo === "NACIONAL") return "NFS-e Nacional";
  if (modelo === "MUNICIPAL_CABEDELO") return "NFS-e Cabedelo";
  return "NFS-e João Pessoa";
}

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const inputClassName = "h-11 rounded-sm font-mono tabular-nums";

function numeroMonetario(value: string) {
  return Number(value.replace(",", "."));
}

function RequiredMark() {
  return <span className="text-destructive" aria-hidden="true">*</span>;
}

export function NfseFiscalForm({
  servicos,
  valores,
  modelo,
  codigos,
  validationError,
  loading,
  onChange,
  onValueChange,
  onBack,
  onRefresh,
  onSubmit,
}: {
  servicos: ServicoOS[];
  valores: ValoresServicosForm;
  modelo: ModeloEmissao;
  codigos: CodigosFiscaisForm;
  validationError?: string | null;
  loading: boolean;
  onChange: (campo: keyof CodigosFiscaisForm, valor: string) => void;
  onValueChange: (servicoId: number, valor: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const isNacional = modelo === "NACIONAL";
  const isCabedelo = modelo === "MUNICIPAL_CABEDELO";
  const pendencias = [...new Map(
    servicos
      .flatMap((servico) => servico.pendenciasCadastro ?? [])
      .map((pendencia) => [pendencia.mensagem, pendencia] as const),
  ).values()];
  const total = servicos.reduce((sum, servico) => {
    const value = numeroMonetario(valores[servico.servicoid] ?? "");
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  return (
    <div className="space-y-6">
      <section className="border border-l-4 border-l-amber-500 bg-card p-4 shadow-sm" aria-labelledby="servicos-selecionados-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center border bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <FileCheck2 aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Nota em revisão</p>
                <Badge variant="outline" className="rounded-sm">{getModeloLabel(modelo)}</Badge>
              </div>
              <h2 id="servicos-selecionados-title" className="mt-1 text-base font-bold">
                {servicos.length} {servicos.length === 1 ? "serviço selecionado" : "serviços consolidados"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Total informado: {BRL_FORMATTER.format(total)}</p>
            </div>
          </div>

          <Button type="button" variant="outline" className="min-h-11 rounded-sm" disabled={loading} onClick={onBack}>
            <ArrowLeft aria-hidden="true" className="mr-2 size-4" />
            Alterar seleção
          </Button>
        </div>
      </section>

      {pendencias.length > 0 ? (
        <section className="space-y-4" aria-labelledby="pendencias-cadastro-title">
          <Alert variant="destructive" className="rounded-sm border-l-4">
            <ShieldAlert aria-hidden="true" className="size-4" />
            <AlertTitle id="pendencias-cadastro-title">Cadastros obrigatórios incompletos</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {pendencias.map((pendencia) => <li key={pendencia.mensagem}>{pendencia.mensagem}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
          <Button type="button" variant="outline" className="min-h-11 rounded-sm" disabled={loading} onClick={onRefresh}>
            <RefreshCw aria-hidden="true" className="mr-2 size-4" />
            Verificar novamente
          </Button>
        </section>
      ) : (
        <form className="space-y-6" onSubmit={onSubmit}>
          {validationError && (
            <Alert variant="destructive" className="rounded-sm border-l-4" role="alert">
              <AlertCircle aria-hidden="true" className="size-4" />
              <AlertTitle>Revise os dados da nota</AlertTitle>
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          <fieldset className="space-y-4 border bg-card p-4 sm:p-5">
            <legend className="px-2 text-sm font-bold">Serviços e valores da nota</legend>
            <Alert className="rounded-sm border-l-4">
              <Info aria-hidden="true" className="size-4" />
              <AlertDescription>
                Os serviços serão discriminados separadamente, mas a prefeitura receberá uma única classificação fiscal e o valor total consolidado.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              {servicos.map((servico, index) => (
                <div key={servico.servicoid} className="grid gap-3 border bg-muted/20 p-3 sm:grid-cols-[1fr_180px] sm:items-end">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Item {index + 1} · Serviço #{servico.servicoid}</p>
                    <p className="mt-1 truncate text-sm font-semibold">{servico.servico?.descricao || "Descrição não cadastrada"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Quantidade registrada: {Number(servico.quantidade)}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`nfse-valor-${servico.servicoid}`}>Valor na NFS-e <RequiredMark /></Label>
                    <Input
                      id={`nfse-valor-${servico.servicoid}`}
                      className={inputClassName}
                      value={valores[servico.servicoid] ?? ""}
                      onChange={(event) => onValueChange(servico.servicoid, event.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <span className="text-sm font-semibold">Total da NFS-e</span>
              <span className="text-lg font-bold tabular-nums">{BRL_FORMATTER.format(total)}</span>
            </div>
          </fieldset>

          <fieldset className="space-y-4 border bg-card p-4 sm:p-5">
            <legend className="px-2 text-sm font-bold">Classificação fiscal</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {isNacional ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="nfse-codigo-nacional">Código de Tributação Nacional do ISS <RequiredMark /></Label>
                  <Input
                    id="nfse-codigo-nacional"
                    className={inputClassName}
                    value={codigos.codigoTributacaoNacionalIss}
                    onChange={(event) => onChange("codigoTributacaoNacionalIss", event.target.value)}
                    placeholder="Ex.: 140101"
                    inputMode="numeric"
                    maxLength={12}
                    required
                    disabled={loading}
                  />
                  <p className="text-xs text-muted-foreground">Informe os 6 dígitos da tabela nacional.</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="nfse-item-lista">Item da Lista de Serviço <RequiredMark /></Label>
                    <Input
                      id="nfse-item-lista"
                      className={inputClassName}
                      value={codigos.itemListaServico}
                      onChange={(event) => onChange("itemListaServico", event.target.value)}
                      placeholder="Ex.: 14.01"
                      maxLength={8}
                      required
                      disabled={loading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nfse-cnae">CNAE <RequiredMark /></Label>
                    <Input
                      id="nfse-cnae"
                      className={inputClassName}
                      value={codigos.codigoCnae}
                      onChange={(event) => onChange("codigoCnae", event.target.value)}
                      placeholder={modelo === "MUNICIPAL_JOAO_PESSOA" ? "9 dígitos" : "7 a 9 dígitos"}
                      inputMode="numeric"
                      maxLength={12}
                      required
                      disabled={loading}
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="nfse-aliquota">Alíquota do ISS (%) {!isNacional && <RequiredMark />}</Label>
                <Input
                  id="nfse-aliquota"
                  className={inputClassName}
                  value={codigos.aliquotaIss}
                  onChange={(event) => onChange("aliquotaIss", event.target.value)}
                  placeholder={isNacional ? "Quando exigida" : "Ex.: 3,00"}
                  inputMode="decimal"
                  required={!isNacional}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nfse-nbs">Código NBS</Label>
                <Input
                  id="nfse-nbs"
                  className={inputClassName}
                  value={codigos.codigoNbs}
                  onChange={(event) => onChange("codigoNbs", event.target.value)}
                  placeholder="9 dígitos, quando aplicável"
                  inputMode="numeric"
                  maxLength={14}
                  disabled={loading}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-4 border bg-card p-4 sm:p-5">
            <legend className="px-2 text-sm font-bold">Tributação do ISS</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {isNacional ? (
                <>
                  <SelectField
                    id="nfse-tributacao-iss"
                    label="Tributação do ISS"
                    value={codigos.tributacaoIss}
                    required
                    disabled={loading}
                    onValueChange={(value) => onChange("tributacaoIss", value)}
                    options={[
                      ["1", "Operação tributável"],
                      ["2", "Imunidade"],
                      ["3", "Exportação de serviço"],
                      ["4", "Não incidência"],
                    ]}
                  />
                  <SelectField
                    id="nfse-retencao-iss"
                    label="Retenção do ISS"
                    value={codigos.tipoRetencaoIss}
                    required
                    disabled={loading}
                    onValueChange={(value) => onChange("tipoRetencaoIss", value)}
                    options={[
                      ["1", "Não retido"],
                      ["2", "Retido pelo tomador"],
                      ["3", "Retido pelo intermediário"],
                    ]}
                  />
                </>
              ) : (
                <>
                  <SelectField
                    id="nfse-natureza-operacao"
                    label="Natureza da operação"
                    value={codigos.naturezaOperacao}
                    required
                    disabled={loading}
                    onValueChange={(value) => onChange("naturezaOperacao", value)}
                    options={[
                      ["1", "Tributação no município"],
                      ["2", "Tributação fora do município"],
                      ["3", "Isenção"],
                      ["4", "Imunidade"],
                      ["5", "Exigibilidade suspensa — decisão judicial"],
                      ["6", "Exigibilidade suspensa — processo administrativo"],
                    ]}
                  />
                  <SelectField
                    id="nfse-iss-retido"
                    label="ISS retido"
                    value={codigos.issRetido}
                    required
                    disabled={loading}
                    onValueChange={(value) => onChange("issRetido", value)}
                    options={[["false", "Não"], ["true", "Sim"]]}
                  />
                </>
              )}
            </div>
          </fieldset>

          {(isNacional || isCabedelo) && (
            <fieldset className="space-y-4 border bg-card p-4 sm:p-5">
              <legend className="px-2 text-sm font-bold">Reforma Tributária 2026</legend>
              {isCabedelo && (
                <Alert className="rounded-sm border-l-4">
                  <Info aria-hidden="true" className="size-4" />
                  <AlertDescription>
                    Em Cabedelo estes campos são condicionais. Se iniciar o preenchimento, complete todo o grupo aplicável.
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="nfse-finalidade"
                  label="Finalidade da emissão"
                  value={codigos.finalidadeEmissao}
                  required={isNacional}
                  disabled={loading}
                  onValueChange={(value) => onChange("finalidadeEmissao", value)}
                  options={[["0", "NFS-e regular"]]}
                />
                <SelectField
                  id="nfse-consumidor-final"
                  label="Operação de uso ou consumo pessoal"
                  value={codigos.consumidorFinal}
                  required={isNacional}
                  disabled={loading}
                  onValueChange={(value) => onChange("consumidorFinal", value)}
                  options={[["0", "Não"], ["1", "Sim"]]}
                />
                <SelectField
                  id="nfse-indicador-destinatario"
                  label="Destinatário do serviço"
                  value={codigos.indicadorDestinatario}
                  required={isNacional}
                  disabled={loading}
                  onValueChange={(value) => onChange("indicadorDestinatario", value)}
                  options={[["0", "O próprio tomador"]]}
                />
                <div className="space-y-2">
                  <Label htmlFor="nfse-indicador-operacao">Código indicador da operação</Label>
                  <Input
                    id="nfse-indicador-operacao"
                    className={inputClassName}
                    value={codigos.codigoIndicadorOperacao}
                    onChange={(event) => onChange("codigoIndicadorOperacao", event.target.value)}
                    placeholder="6 dígitos, quando aplicável"
                    inputMode="numeric"
                    maxLength={6}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nfse-cst-ibs-cbs">CST do IBS/CBS {isNacional && <RequiredMark />}</Label>
                  <Input
                    id="nfse-cst-ibs-cbs"
                    className={inputClassName}
                    value={codigos.ibsCbsSituacaoTributaria}
                    onChange={(event) => onChange("ibsCbsSituacaoTributaria", event.target.value)}
                    placeholder="3 dígitos"
                    inputMode="numeric"
                    maxLength={3}
                    required={isNacional}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nfse-classificacao-ibs-cbs">Classificação Tributária do IBS/CBS {isNacional && <RequiredMark />}</Label>
                  <Input
                    id="nfse-classificacao-ibs-cbs"
                    className={inputClassName}
                    value={codigos.ibsCbsClassificacaoTributaria}
                    onChange={(event) => onChange("ibsCbsClassificacaoTributaria", event.target.value)}
                    placeholder="6 dígitos"
                    inputMode="numeric"
                    maxLength={6}
                    required={isNacional}
                    disabled={loading}
                  />
                </div>
              </div>
            </fieldset>
          )}

          <fieldset className="space-y-3 border bg-card p-4 sm:p-5">
            <legend className="px-2 text-sm font-bold">Informações complementares</legend>
            <Label htmlFor="nfse-informacoes-complementares">Texto livre da nota</Label>
            <Textarea
              id="nfse-informacoes-complementares"
              value={codigos.informacoesComplementares}
              onChange={(event) => onChange("informacoesComplementares", event.target.value)}
              placeholder="Informações adicionais que devem constar na NFS-e..."
              maxLength={2000}
              rows={5}
              disabled={loading}
            />
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {codigos.informacoesComplementares.length}/2000
            </p>
          </fieldset>

          <Separator />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[60ch] text-xs leading-relaxed text-muted-foreground">
              Revise os valores e a classificação. Após o envio, alterações exigem cancelamento e nova emissão.
            </p>
            <Button type="submit" className="min-h-11 rounded-sm px-5" disabled={loading}>
              {loading ? <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" /> : <Send aria-hidden="true" className="mr-2 size-4" />}
              {loading ? "Enviando..." : `Emitir ${BRL_FORMATTER.format(total)}`}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  required,
  disabled,
  options,
  onValueChange,
}: {
  id: string;
  label: string;
  value: string;
  required?: boolean;
  disabled: boolean;
  options: Array<[string, string]>;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label} {required && <RequiredMark />}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled} required={required}>
        <SelectTrigger id={id} className="h-11 rounded-sm">
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
