"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  ListChecks,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { CustomerDialog } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/customerDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { rotuloModeloNFSe } from "@/lib/services/fiscais/nfse-politica";
import { NfseClienteCard } from "./nfse-cliente-card";
import { NfseFiscalForm } from "./nfse-fiscal-form";
import { NfseServiceCard } from "./nfse-service-card";
import { montarCodigosDaRevisao } from "./codigos-da-revisao";
import {
  blocosDeObservacao,
  concatenarBloco,
  type AlvoFiscal,
} from "@/lib/fiscal/blocosDeObservacao";
import {
  EMPTY_CODIGOS,
  LIMITE_INFORMACOES_COMPLEMENTARES,
  type ClienteResumo,
  type CodigosFiscaisForm,
  type ContextoEmissaoResponse,
  type DescontoOrigemNfse,
  type ModeloEmissao,
  type PoliticaEmissaoResumo,
  type ServicoOS,
  type ServicosOSResponse,
  type ValoresServicosForm,
} from "./types";

type EmissaoNfseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  osId: number | null;
  /**
   * Outras OS do MESMO cliente que esta nota tambem documenta, vindas da
   * selecao multipla. Delas entram todos os servicos; a selecao fina de
   * servicos vale para a OS ancora.
   */
  osIdsAdicionais?: number[];
  onAfterGenerate?: () => void;
};

function isStatus(status: string | null | undefined, values: string[]) {
  return values.includes(String(status ?? "").toUpperCase());
}

function numero(value: string) {
  return Number(value.replace(",", "."));
}

function valorOriginal(servico: ServicoOS) {
  const quantidade = Number(servico.quantidade);
  const preco = Number(servico.precounitario);
  const total = quantidade * preco;
  return Number.isFinite(total) && total > 0 ? total.toFixed(2).replace(".", ",") : "";
}

function validarFormulario(
  modelo: ModeloEmissao,
  exigeRtc: boolean,
  codigos: CodigosFiscaisForm,
  servicos: ServicoOS[],
  valores: ValoresServicosForm,
) {
  if (servicos.length === 0) return "Selecione ao menos um serviço.";
  for (const servico of servicos) {
    const value = numero(valores[servico.servicoid] ?? "");
    if (!Number.isFinite(value) || value <= 0) {
      return `Informe um valor maior que zero para o serviço ${servico.servicoid}.`;
    }
  }

  if (modelo === "NACIONAL") {
    if (codigos.codigoTributacaoNacionalIss.replace(/\D/g, "").length !== 6) return "Informe o Código de Tributação Nacional do ISS com 6 dígitos.";
    const municipal = codigos.codigoTributacaoMunicipalIss.trim();
    if (municipal && !/^\d{3}$/.test(municipal)) return "Quando informado, o Código de Tributação Municipal do padrão Nacional deve possuir 3 dígitos.";
    if (!["1", "2", "3", "4"].includes(codigos.tributacaoIss)) return "Selecione a tributação do ISS.";
    if (!["1", "2", "3"].includes(codigos.tipoRetencaoIss)) return "Selecione a retenção do ISS.";
    // Mesma regra do servidor: o grupo da Reforma é exigido quando a política
    // diz; fora disso, se começou, precisa terminar.
    const informouReforma = [
      codigos.finalidadeEmissao,
      codigos.consumidorFinal,
      codigos.indicadorDestinatario,
      codigos.codigoIndicadorOperacao,
      codigos.ibsCbsSituacaoTributaria,
      codigos.ibsCbsClassificacaoTributaria,
    ].some((valor) => valor.trim() !== "");
    if (exigeRtc || informouReforma) {
      if (codigos.finalidadeEmissao !== "0") return "Selecione a finalidade da emissão.";
      if (!["0", "1"].includes(codigos.consumidorFinal)) return "Informe se a operação é de consumo final.";
      if (codigos.indicadorDestinatario !== "0") return "Confirme que o destinatário é o próprio tomador.";
      if (exigeRtc && codigos.codigoIndicadorOperacao.replace(/\D/g, "").length !== 6) return "Informe o Código Indicador da Operação (cIndOp) com 6 dígitos.";
      if (codigos.ibsCbsSituacaoTributaria.replace(/\D/g, "").length !== 3) return "Informe o CST do IBS/CBS com 3 dígitos.";
      if (codigos.ibsCbsClassificacaoTributaria.replace(/\D/g, "").length !== 6) return "Informe a Classificação Tributária do IBS/CBS com 6 dígitos.";
    }
  } else {
    const itemLista = codigos.itemListaServico.replace(/\D/g, "");
    if (itemLista.length < 4 || itemLista.length > 6) return "Informe um Item da Lista de Serviço válido, por exemplo 14.01.";
    const cnae = codigos.codigoCnae.replace(/\D/g, "");
    const cnaeValido = modelo === "MUNICIPAL_JOAO_PESSOA" ? cnae.length === 9 : cnae.length >= 7 && cnae.length <= 9;
    if (!cnaeValido) return modelo === "MUNICIPAL_JOAO_PESSOA" ? "Informe a variação do CNAE com 9 dígitos exigida por João Pessoa." : "Informe um CNAE com 7 a 9 dígitos.";
    if (!["1", "2", "3", "4", "5", "6"].includes(codigos.naturezaOperacao)) return "Selecione a natureza da operação.";
    if (!["true", "false"].includes(codigos.issRetido)) return "Informe se o ISS será retido.";
    const aliquota = numero(codigos.aliquotaIss);
    if (!Number.isFinite(aliquota) || aliquota < 0 || aliquota > 100) return "Informe uma alíquota de ISS válida entre 0 e 100%.";
  }

  const nbs = codigos.codigoNbs.replace(/\D/g, "");
  if (codigos.codigoNbs.trim() && nbs.length !== 9) return "Quando informado, o Código NBS deve possuir 9 dígitos.";
  const indicadorOperacao = codigos.codigoIndicadorOperacao.replace(/\D/g, "");
  if (codigos.codigoIndicadorOperacao.trim() && indicadorOperacao.length !== 6) return "Quando informado, o Código Indicador da Operação deve possuir 6 dígitos.";
  if (codigos.informacoesComplementares.length > 2000) return "As informações complementares devem possuir no máximo 2.000 caracteres.";

  if (modelo === "MUNICIPAL_CABEDELO") {
    const informouReforma = [
      codigos.finalidadeEmissao,
      codigos.consumidorFinal,
      codigos.indicadorDestinatario,
      codigos.codigoIndicadorOperacao,
      codigos.ibsCbsSituacaoTributaria,
      codigos.ibsCbsClassificacaoTributaria,
    ].some(Boolean);
    if (informouReforma) {
      if (codigos.finalidadeEmissao !== "0" || !["0", "1"].includes(codigos.consumidorFinal) || codigos.indicadorDestinatario !== "0") {
        return "Complete finalidade, consumo final e destinatário dos dados da Reforma Tributária.";
      }
      if (codigos.ibsCbsSituacaoTributaria.replace(/\D/g, "").length !== 3 || codigos.ibsCbsClassificacaoTributaria.replace(/\D/g, "").length !== 6) {
        return "Complete o CST e a Classificação Tributária do IBS/CBS.";
      }
    }
  }

  return null;
}

function DialogStepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const steps = ["Selecionar", "Revisar", "Enviar"];
  return (
    <ol className="flex items-start gap-2" aria-label={`Etapa ${currentStep} de 3`}>
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isActive = currentStep === stepNumber;
        const isComplete = currentStep > stepNumber;
        return (
          <li key={step} className="min-w-0 flex-1">
            <div className={`h-1 ${isActive || isComplete ? "bg-amber-500" : "bg-border"}`} aria-hidden="true" />
            <div className="mt-2 flex items-center gap-1.5">
              {isComplete ? <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600" /> : (
                <span className={`grid size-4 place-items-center border text-[9px] font-bold ${isActive ? "border-amber-500 text-amber-700" : "border-border text-muted-foreground"}`} aria-hidden="true">{stepNumber}</span>
              )}
              <span className={`truncate text-[11px] font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>{step}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ServiceListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Carregando serviços">
      {[0, 1, 2].map((item) => (
        <div key={item} className="border border-l-4 border-l-border bg-card p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 space-y-3"><Skeleton className="h-5 w-28 rounded-sm" /><Skeleton className="h-4 w-2/3 rounded-sm" /><Skeleton className="h-3 w-40 rounded-sm" /></div>
            <Skeleton className="h-11 w-full rounded-sm sm:w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmissaoNfseDialog({
  open,
  onOpenChange,
  osId,
  osIdsAdicionais,
  onAfterGenerate,
}: EmissaoNfseDialogProps) {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [servicos, setServicos] = useState<ServicoOS[]>([]);
  const [modeloEmissao, setModeloEmissao] = useState<ModeloEmissao | null>(null);
  const [politicaEmissao, setPoliticaEmissao] = useState<PoliticaEmissaoResumo | null>(null);
  /** O modelo da revisão não tem padrão cadastrado — a tela avisa. */
  const [padraoAusente, setPadraoAusente] = useState(false);
  const [preparandoRevisao, setPreparandoRevisao] = useState(false);
  const [observacoesFiscaisOs, setObservacoesFiscaisOs] = useState("");
  const [alvo, setAlvo] = useState<AlvoFiscal | null>(null);
  const [descontoOrigem, setDescontoOrigem] = useState<DescontoOrigemNfse | null>(null);
  const [cliente, setCliente] = useState<ClienteResumo | null>(null);
  const [editandoCliente, setEditandoCliente] = useState(false);
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [valores, setValores] = useState<ValoresServicosForm>({});
  const [revisando, setRevisando] = useState(false);
  const [codigosFiscais, setCodigosFiscais] = useState<CodigosFiscaisForm>(EMPTY_CODIGOS);
  const [validationError, setValidationError] = useState<string | null>(null);

  const servicosSelecionados = useMemo(
    () => selecionados.map((id) => servicos.find((servico) => servico.servicoid === id)).filter((servico): servico is ServicoOS => Boolean(servico)),
    [selecionados, servicos],
  );

  const carregarServicos = useCallback(async () => {
    if (!osId) return;
    setFetching(true);
    try {
      const response = await fetch(`/api/nfse/servicos-de-os/${osId}`);
      const payload = await response.json() as ServicosOSResponse;
      if (!response.ok || !payload.ok) {
        setModeloEmissao(null);
        setPoliticaEmissao(null);
        toast.error(payload.message || "Erro ao carregar serviços da OS");
        return;
      }
      const nextServices = payload.servicos ?? [];
      setServicos(nextServices);
      setModeloEmissao(payload.modeloEmissao ?? null);
      setPoliticaEmissao(payload.politicaEmissao ?? null);
      setAlvo(payload.alvo ?? null);
      setDescontoOrigem(payload.descontoOrigem ?? null);
      setCliente(payload.cliente ?? null);
      setSelecionados((current) => current.filter((id) => nextServices.some((item) => item.servicoid === id)));
    } catch {
      toast.error("Erro ao carregar serviços da OS");
    } finally {
      setFetching(false);
    }
  }, [osId]);

  useEffect(() => {
    if (open && osId) {
      void carregarServicos();
      return;
    }
    setServicos([]);
    setModeloEmissao(null);
    setPoliticaEmissao(null);
    setPadraoAusente(false);
    setPreparandoRevisao(false);
    setObservacoesFiscaisOs("");
    setAlvo(null);
    setDescontoOrigem(null);
    setCliente(null);
    setEditandoCliente(false);
    setSelecionados([]);
    setValores({});
    setRevisando(false);
    setCodigosFiscais(EMPTY_CODIGOS);
    setValidationError(null);
  }, [open, osId, carregarServicos]);

  const alternarServico = (servico: ServicoOS, selected: boolean) => {
    setValidationError(null);
    setSelecionados((current) => selected
      ? current.includes(servico.servicoid) ? current : [...current, servico.servicoid]
      : current.filter((id) => id !== servico.servicoid));
    if (selected) {
      setValores((current) => ({ ...current, [servico.servicoid]: current[servico.servicoid] ?? valorOriginal(servico) }));
    }
  };

  /**
   * Abre a revisão com o modelo e o padrão dos serviços SELECIONADOS.
   *
   * O modelo da listagem é o da OS inteira e serve só ao cabeçalho: numa OS que
   * mistura item comum e exceção de João Pessoa, selecionar só a exceção muda o
   * emissor. Por isso a política é resolvida de novo no servidor — pela mesma
   * função que a emissão vai usar — e só então o formulário é preenchido.
   */
  const iniciarRevisao = async () => {
    if (!osId || servicosSelecionados.length === 0) {
      toast.error("Selecione ao menos um serviço para continuar.");
      return;
    }
    const pendenciasListagem = [...new Set(
      servicosSelecionados.flatMap((servico) => servico.pendenciasCadastro ?? []).map((item) => item.mensagem),
    )];
    if (pendenciasListagem.length) {
      toast.error(`Preencha os dados obrigatórios antes de emitir: ${pendenciasListagem.join(", ")}.`);
      return;
    }

    setPreparandoRevisao(true);
    try {
      const response = await fetch(`/api/nfse/contexto-emissao/${osId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicos: selecionados,
          ...(osIdsAdicionais?.length ? { osIdsAdicionais } : {}),
        }),
      });
      const contexto = await response.json().catch(() => ({})) as ContextoEmissaoResponse;
      if (!response.ok || !contexto.ok || !contexto.modeloEmissao) {
        toast.error(contexto.message || "Não foi possível preparar a revisão da NFS-e.");
        return;
      }
      const pendencias = [...new Set((contexto.pendenciasCadastro ?? []).map((item) => item.mensagem))];
      if (pendencias.length) {
        toast.error(`Preencha os dados obrigatórios antes de emitir: ${pendencias.join(", ")}.`);
        return;
      }

      const observacoes = (contexto.observacoesFiscais ?? "").trim();
      setModeloEmissao(contexto.modeloEmissao);
      setPoliticaEmissao(contexto.politicaEmissao ?? null);
      setPadraoAusente(Boolean(contexto.padraoAusente));
      setObservacoesFiscaisOs(observacoes);
      setCodigosFiscais(montarCodigosDaRevisao({
        modelo: contexto.modeloEmissao,
        padraoFiscal: contexto.padraoFiscal,
        servicos: servicosSelecionados,
        observacoes,
      }));
      setValidationError(null);
      setRevisando(true);
    } catch {
      toast.error("Não foi possível preparar a revisão da NFS-e.");
    } finally {
      setPreparandoRevisao(false);
    }
  };

  // O que falta no tomador vale para a nota inteira, não para um serviço só:
  // junta a lista de todos os serviços e mostra uma vez, no card do cliente.
  const pendenciasCliente = useMemo(
    () => [...new Set(
      servicos
        .flatMap((servico) => servico.pendenciasCadastro ?? [])
        .filter((pendencia) => pendencia.origem === "CLIENTE")
        .map((pendencia) => pendencia.mensagem),
    )],
    [servicos],
  );

  const atualizarCodigo = (campo: keyof CodigosFiscaisForm, valor: string) => {
    setValidationError(null);
    setCodigosFiscais((current) => ({ ...current, [campo]: valor }));
  };

  // Botões do texto livre: mesmos blocos que a NF-e de produto oferece, para os
  // dois documentos da mesma OS saírem com a descrição no mesmo formato.
  const blocosDoTextoLivre = useMemo(
    () => blocosDeObservacao(alvo, cliente),
    [alvo, cliente],
  );

  const adicionarBloco = (bloco: string) => {
    setValidationError(null);
    const { texto, truncado } = concatenarBloco(
      codigosFiscais.informacoesComplementares,
      bloco,
      LIMITE_INFORMACOES_COMPLEMENTARES,
    );
    setCodigosFiscais((current) => ({ ...current, informacoesComplementares: texto }));
    if (truncado) {
      toast.warning(
        `O texto ultrapassou o limite de ${LIMITE_INFORMACOES_COMPLEMENTARES} caracteres. Reduza-o antes de emitir.`,
      );
    }
  };

  const atualizarValor = (servicoId: number, valor: string) => {
    setValidationError(null);
    setValores((current) => ({ ...current, [servicoId]: valor }));
  };

  const handleEmitir = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!osId || !modeloEmissao) return;
    const error = validarFormulario(
      modeloEmissao,
      Boolean(politicaEmissao?.exigeRtc),
      codigosFiscais,
      servicosSelecionados,
      valores,
    );
    if (error) {
      setValidationError(error);
      toast.error(error);
      return;
    }

    setValidationError(null);
    setLoading(true);
    const toastId = toast.loading("Enviando NFS-e para a Focus NFe...");
    const optionalNumber = (value: string) => value === "" ? undefined : Number(value);

    try {
      const response = await fetch(`/api/nfse/de-os/${osId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicos: servicosSelecionados.map((servico) => ({
            osservicoId: servico.servicoid,
            valor: numero(valores[servico.servicoid]),
          })),
          ...(osIdsAdicionais?.length ? { osIdsAdicionais } : {}),
          codigosFiscais: {
            item_lista_servico: codigosFiscais.itemListaServico,
            codigo_cnae: codigosFiscais.codigoCnae,
            codigo_tributacao_nacional_iss: codigosFiscais.codigoTributacaoNacionalIss,
            codigo_tributacao_municipal_iss: codigosFiscais.codigoTributacaoMunicipalIss,
            codigo_nbs: codigosFiscais.codigoNbs,
            aliquota_iss: codigosFiscais.aliquotaIss === "" ? undefined : numero(codigosFiscais.aliquotaIss),
            natureza_operacao: optionalNumber(codigosFiscais.naturezaOperacao),
            iss_retido: codigosFiscais.issRetido === "" ? undefined : codigosFiscais.issRetido === "true",
            tributacao_iss: optionalNumber(codigosFiscais.tributacaoIss),
            tipo_retencao_iss: optionalNumber(codigosFiscais.tipoRetencaoIss),
            finalidade_emissao: optionalNumber(codigosFiscais.finalidadeEmissao),
            consumidor_final: optionalNumber(codigosFiscais.consumidorFinal),
            indicador_destinatario: optionalNumber(codigosFiscais.indicadorDestinatario),
            codigo_indicador_operacao: codigosFiscais.codigoIndicadorOperacao,
            ibs_cbs_situacao_tributaria: codigosFiscais.ibsCbsSituacaoTributaria,
            ibs_cbs_classificacao_tributaria: codigosFiscais.ibsCbsClassificacaoTributaria,
            informacoes_complementares: codigosFiscais.informacoesComplementares,
          },
        }),
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        const message = payload.message || "Erro ao emitir NFS-e";
        setValidationError(message);
        toast.error(message, { id: toastId });
        return;
      }
      toast.success("NFS-e enviada para processamento.", { id: toastId });
      onAfterGenerate?.();
      onOpenChange(false);
    } catch (networkError: unknown) {
      const message = networkError instanceof Error ? networkError.message : "Erro de rede ao conectar à API";
      setValidationError(message);
      toast.error(message, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const autorizadas = servicos.filter((servico) => isStatus(servico.notaFiscalStatus, ["AUTORIZADA", "AUTORIZADO", "EMITIDA"])).length;
  const comPendencias = servicos.filter((servico) => Boolean(servico.pendenciasCadastro?.length)).length;
  const rejeitadas = servicos.filter((servico) => isStatus(servico.notaFiscalStatus, ["REJEITADA", "ERRO", "ERRO_AUTORIZACAO"])).length;
  const currentStep: 1 | 2 | 3 = loading ? 3 : revisando ? 2 : 1;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 [&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:place-items-center sm:h-[min(92dvh,880px)] sm:w-[calc(100vw-2rem)] sm:max-w-[1080px] sm:rounded-sm sm:border">
        <DialogHeader className="shrink-0 border-b bg-card pb-5 pl-5 pr-16 pt-[max(1.5rem,env(safe-area-inset-top))] text-left sm:pl-7 sm:pt-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center border-2 border-amber-500 bg-amber-500/10 text-amber-700"><FileText aria-hidden="true" className="size-6" /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">Documento fiscal de serviço</p><Badge variant="outline" className="rounded-sm">OS #{osId ?? "—"}</Badge></div>
                <DialogTitle className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">Emitir NFS-e</DialogTitle>
                <DialogDescription className="mt-1 max-w-[68ch] text-sm leading-relaxed">Selecione um ou mais serviços, informe os valores da nota e revise a tributação antes do envio.</DialogDescription>
              </div>
            </div>
            <div className="w-full lg:max-w-80"><DialogStepIndicator currentStep={currentStep} /></div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck aria-hidden="true" className="size-4 text-emerald-600" />{rotuloModeloNFSe(modeloEmissao)}</span>
            <span>{servicos.length} serviços</span><span>{autorizadas} autorizadas</span><span>{selecionados.length} selecionados</span>
            <span className={comPendencias ? "font-medium text-amber-700" : undefined}>{comPendencias} com pendências</span>
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <main className="px-4 py-5 sm:px-7 sm:py-6">
            <div className="mx-auto max-w-4xl space-y-5">
              {!modeloEmissao && !fetching && <Alert variant="destructive" className="rounded-sm border-l-4"><AlertCircle aria-hidden="true" className="size-4" /><AlertTitle>Emissão não configurada</AlertTitle><AlertDescription>Preencha o código IBGE e o regime tributário da empresa.</AlertDescription></Alert>}
              {rejeitadas > 0 && !revisando && <Alert variant="destructive" className="rounded-sm border-l-4"><AlertCircle aria-hidden="true" className="size-4" /><AlertTitle>{rejeitadas} emissões rejeitadas</AlertTitle><AlertDescription>Os serviços rejeitados podem ser selecionados novamente após a correção.</AlertDescription></Alert>}

              {cliente && (
                <NfseClienteCard
                  cliente={cliente}
                  pendencias={pendenciasCliente}
                  loading={loading}
                  onEditar={() => setEditandoCliente(true)}
                />
              )}

              {revisando && modeloEmissao ? (
                <NfseFiscalForm
                  servicos={servicosSelecionados}
                  valores={valores}
                  modelo={modeloEmissao}
                  exigeRtc={Boolean(politicaEmissao?.exigeRtc)}
                  padraoAusente={padraoAusente}
                  motivoModelo={politicaEmissao?.motivo ?? null}
                  codigos={codigosFiscais}
                  validationError={validationError}
                  loading={loading}
                  herdouObservacoesDaOs={
                    Boolean(observacoesFiscaisOs)
                    && codigosFiscais.informacoesComplementares === observacoesFiscaisOs
                  }
                  descontoOrigem={descontoOrigem}
                  blocosDoTextoLivre={blocosDoTextoLivre}
                  onAdicionarBloco={adicionarBloco}
                  onChange={atualizarCodigo}
                  onValueChange={atualizarValor}
                  onBack={() => { setRevisando(false); setValidationError(null); }}
                  onRefresh={() => void carregarServicos()}
                  onSubmit={handleEmitir}
                />
              ) : (
                <section aria-labelledby="selecao-servico-title">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div><p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><ListChecks aria-hidden="true" className="size-4" />Etapa 1 de 3</p><h2 id="selecao-servico-title" className="mt-1 text-lg font-bold">Serviços que irão compor a nota</h2><p className="mt-1 text-sm text-muted-foreground">Serviços selecionados serão consolidados em uma única NFS-e.</p></div>
                    <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-sm" disabled={fetching} onClick={() => void carregarServicos()}><RefreshCw aria-hidden="true" className={`mr-2 size-4 ${fetching ? "animate-spin" : ""}`} />Atualizar</Button>
                  </div>

                  {fetching ? <ServiceListSkeleton /> : servicos.length === 0 ? (
                    <div className="border border-dashed px-6 py-12 text-center"><FileText aria-hidden="true" className="mx-auto size-8 text-muted-foreground" /><h3 className="mt-3 text-sm font-semibold">Nenhum serviço encontrado</h3></div>
                  ) : (
                    <div className="space-y-3">
                      {servicos.map((servico) => <NfseServiceCard key={servico.servicoid} servico={servico} selected={selecionados.includes(servico.servicoid)} loading={loading} onToggle={alternarServico} />)}
                    </div>
                  )}

                  <div className="sticky bottom-0 mt-5 flex flex-col gap-3 border bg-card p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground"><strong className="text-foreground">{selecionados.length}</strong> {selecionados.length === 1 ? "serviço selecionado" : "serviços selecionados"}</p>
                    <Button type="button" className="min-h-11 rounded-sm px-5" disabled={!modeloEmissao || selecionados.length === 0 || fetching || preparandoRevisao} onClick={() => void iniciarRevisao()}>{preparandoRevisao ? "Preparando..." : "Revisar nota"}<ArrowRight aria-hidden="true" className="ml-2 size-4" /></Button>
                  </div>
                </section>
              )}
            </div>
          </main>
        </ScrollArea>

        <Separator />
        <DialogFooter className="shrink-0 bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">{loading ? "Enviando documento para processamento fiscal..." : "A autorização será atualizada automaticamente quando a Focus responder."}</p>
          <Button type="button" variant="outline" className="min-h-11 rounded-sm" disabled={loading} onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* O cadastro do tomador é a origem mais comum das pendências, então ele é
        editável sem fechar a emissão — ao salvar, as pendências são revalidadas. */}
    {cliente ? (
      <CustomerDialog
        customerId={cliente.id}
        isOpen={editandoCliente}
        setIsOpen={setEditandoCliente}
        onUpdate={() => {
          setEditandoCliente(false);
          setValidationError(null);
          void carregarServicos();
        }}
      >
        <span className="hidden" />
      </CustomerDialog>
    ) : null}
    </>
  );
}
