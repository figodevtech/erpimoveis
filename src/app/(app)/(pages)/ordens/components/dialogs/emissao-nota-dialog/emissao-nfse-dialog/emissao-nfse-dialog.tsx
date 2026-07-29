"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, AlertCircle } from "lucide-react";
import { toast } from "@/lib/toast";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ModeloEmissao = "NACIONAL" | "MUNICIPAL_CABEDELO" | "MUNICIPAL_JOAO_PESSOA";

type CodigosFiscaisForm = {
  itemListaServico: string;
  codigoCnae: string;
  codigoTributarioMunicipio: string;
  codigoTributacaoNacionalIss: string;
  codigoNbs: string;
  aliquotaIss: string;
};

const EMPTY_CODIGOS: CodigosFiscaisForm = {
  itemListaServico: "",
  codigoCnae: "",
  codigoTributarioMunicipio: "",
  codigoTributacaoNacionalIss: "",
  codigoNbs: "",
  aliquotaIss: "",
};

export function EmissaoNfseDialog({
  open,
  onOpenChange,
  osId,
  onAfterGenerate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId: number | null;
  onAfterGenerate?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [servicos, setServicos] = useState<any[]>([]);
  const [fetching, setFetching] = useState(false);
  const [modeloEmissao, setModeloEmissao] = useState<ModeloEmissao>("MUNICIPAL_JOAO_PESSOA");
  const [servicoSelecionado, setServicoSelecionado] = useState<any | null>(null);
  const [codigosFiscais, setCodigosFiscais] = useState<CodigosFiscaisForm>(EMPTY_CODIGOS);

  const carregarServicos = useCallback(async () => {
    if (!osId) return;
    setFetching(true);
    try {
      const res = await fetch(`/api/nfse/servicos-de-os/${osId}`);
      const json = await res.json();
      if (json.ok) {
        setServicos(json.servicos || []);
        setModeloEmissao(json.modeloEmissao || "MUNICIPAL_JOAO_PESSOA");
      }
    } catch {
      toast.error("Erro ao carregar serviços da OS");
    } finally {
      setFetching(false);
    }
  }, [osId]);

  useEffect(() => {
    if (open && osId) {
      carregarServicos();
    } else {
      setServicos([]);
      setServicoSelecionado(null);
      setCodigosFiscais(EMPTY_CODIGOS);
    }
  }, [open, osId, carregarServicos]);

  /**
   * Assina atualizações em tempo real para refletir mudanças no status fiscal
   */
  useEffect(() => {
    if (!open || !osId) return;

    const channel = supabase
      .channel(`nfse-servicos-os-${osId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "nfse",
          filter: `ordemservicoid=eq.${osId}`,
        },
        () => {
          console.log(`[EmissaoNfseDialog] Mudança na NFSe detectada. Recarregando serviços...`);
          carregarServicos();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, osId, carregarServicos]);

  const abrirFormularioEmissao = (servicoOs: any) => {
    const servicoCadastro = servicoOs.servico || {};
    const itemLista = String(servicoCadastro.itemlistaservico || "").trim();
    const itemListaDigitos = itemLista.replace(/\D/g, "");

    setServicoSelecionado(servicoOs);
    setCodigosFiscais({
      itemListaServico: itemLista,
      codigoCnae: String(servicoCadastro.cnae || ""),
      codigoTributarioMunicipio: String(servicoCadastro.codigoservicomunicipal || ""),
      codigoTributacaoNacionalIss: itemListaDigitos.length === 6 ? itemListaDigitos : "",
      codigoNbs: "",
      aliquotaIss: servicoCadastro.aliquotaiss === null || servicoCadastro.aliquotaiss === undefined
        ? ""
        : String(servicoCadastro.aliquotaiss),
    });
  };

  const atualizarCodigo = (campo: keyof CodigosFiscaisForm, valor: string) => {
    setCodigosFiscais((atual) => ({ ...atual, [campo]: valor }));
  };

  const validarCodigosAntesDoEnvio = () => {
    if (modeloEmissao === "NACIONAL") {
      if (codigosFiscais.codigoTributacaoNacionalIss.replace(/\D/g, "").length !== 6) {
        return "Informe o Código de Tributação Nacional do ISS com 6 dígitos.";
      }
    } else {
      const itemLista = codigosFiscais.itemListaServico.replace(/\D/g, "");
      if (itemLista.length < 4 || itemLista.length > 6) {
        return "Informe um Item da Lista de Serviço válido, por exemplo 14.01.";
      }

      const cnae = codigosFiscais.codigoCnae.replace(/\D/g, "");
      const cnaeValido = modeloEmissao === "MUNICIPAL_JOAO_PESSOA"
        ? cnae.length === 9
        : cnae.length >= 7 && cnae.length <= 9;
      if (!cnaeValido) {
        return modeloEmissao === "MUNICIPAL_JOAO_PESSOA"
          ? "Informe a variação do CNAE com 9 dígitos exigida por João Pessoa."
          : "Informe um CNAE com 7 a 9 dígitos.";
      }

      const aliquota = Number(codigosFiscais.aliquotaIss.replace(",", "."));
      if (codigosFiscais.aliquotaIss.trim() === "" || !Number.isFinite(aliquota) || aliquota < 0 || aliquota > 100) {
        return "Informe uma alíquota de ISS válida entre 0 e 100%.";
      }
    }

    const nbs = codigosFiscais.codigoNbs.replace(/\D/g, "");
    if (codigosFiscais.codigoNbs.trim() && nbs.length !== 9) {
      return "Quando informado, o Código NBS deve possuir 9 dígitos.";
    }

    return null;
  };

  const handleEmitir = async () => {
    if (!osId) return;
    if (!servicoSelecionado) return;

    const erroValidacao = validarCodigosAntesDoEnvio();
    if (erroValidacao) {
      toast.error(erroValidacao);
      return;
    }

    setLoading(true);
    const toastId = toast.loading("Emitindo NFS-e pela Focus NFe...");

    try {
      const res = await fetch(`/api/nfse/de-os/${osId}`, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          osservicoId: servicoSelecionado.servicoid,
          codigosFiscais: {
            item_lista_servico: codigosFiscais.itemListaServico,
            codigo_cnae: codigosFiscais.codigoCnae,
            codigo_tributario_municipio: codigosFiscais.codigoTributarioMunicipio,
            codigo_tributacao_nacional_iss: codigosFiscais.codigoTributacaoNacionalIss,
            codigo_nbs: codigosFiscais.codigoNbs,
            aliquota_iss: codigosFiscais.aliquotaIss.trim() === ""
              ? undefined
              : Number(codigosFiscais.aliquotaIss.replace(",", ".")),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json.message || "Erro ao gerar NFS-e", { id: toastId });
        return;
      }

      toast.success("NFS-e registrada com sucesso!", { id: toastId });
      setServicoSelecionado(null);
      setCodigosFiscais(EMPTY_CODIGOS);
      if (onAfterGenerate) onAfterGenerate();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro de rede ao conectar à API", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const hasRejection = servicos.some(s => s.notaFiscalStatus === "REJEITADA" || s.notaFiscalStatus === "ERRO");
  const rejectionErrors = servicos
    .filter(s => s.notaFiscalStatus === "REJEITADA" || s.notaFiscalStatus === "ERRO")
    .map(s => s.notaFiscalErros)
    .filter(Boolean);
  const isNacional = modeloEmissao === "NACIONAL";
  const modeloLabel = isNacional
    ? "NFS-e Nacional"
    : modeloEmissao === "MUNICIPAL_CABEDELO"
      ? "NFS-e Cabedelo"
      : "NFS-e João Pessoa";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-5 w-5 text-amber-500 fill-amber-500" /> Emissão de NFS-e por Serviço
          </DialogTitle>
          <DialogDescription>
            Selecione um serviço e revise os códigos fiscais antes de enviá-lo para a Focus NFe.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-4">
          {hasRejection && (
            <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Rejeição Detectada</AlertTitle>
              <AlertDescription className="text-xs">
                {rejectionErrors.length > 0 
                  ? "Alguns serviços foram rejeitados. Verifique se os dados do cliente (CPF/CNPJ, Endereço, CEP) estão corretos."
                  : "Erro na comunicação com a FocusNFe ou dados inconsistentes."}
              </AlertDescription>
            </Alert>
          )}

          {servicoSelecionado && (
            <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Dados fiscais do serviço</p>
                  <p className="text-xs text-muted-foreground">
                    {servicoSelecionado.servico?.descricao || "Serviço"} · {modeloLabel}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => setServicoSelecionado(null)}
                >
                  Trocar serviço
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {isNacional ? (
                  <div className="space-y-2">
                    <Label htmlFor="nfse-codigo-nacional">Código de Tributação Nacional do ISS *</Label>
                    <Input
                      id="nfse-codigo-nacional"
                      value={codigosFiscais.codigoTributacaoNacionalIss}
                      onChange={(event) => atualizarCodigo("codigoTributacaoNacionalIss", event.target.value)}
                      placeholder="Ex.: 140101"
                      inputMode="numeric"
                      disabled={loading}
                    />
                    <p className="text-[11px] text-muted-foreground">Informe os 6 dígitos da tabela nacional.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="nfse-item-lista">Item da Lista de Serviço *</Label>
                      <Input
                        id="nfse-item-lista"
                        value={codigosFiscais.itemListaServico}
                        onChange={(event) => atualizarCodigo("itemListaServico", event.target.value)}
                        placeholder="Ex.: 14.01"
                        disabled={loading}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nfse-cnae">CNAE *</Label>
                      <Input
                        id="nfse-cnae"
                        value={codigosFiscais.codigoCnae}
                        onChange={(event) => atualizarCodigo("codigoCnae", event.target.value)}
                        placeholder={modeloEmissao === "MUNICIPAL_JOAO_PESSOA" ? "Variação com 9 dígitos" : "7 a 9 dígitos"}
                        inputMode="numeric"
                        disabled={loading}
                      />
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Label htmlFor="nfse-codigo-municipal">Código de Tributação Municipal</Label>
                  <Input
                    id="nfse-codigo-municipal"
                    value={codigosFiscais.codigoTributarioMunicipio}
                    onChange={(event) => atualizarCodigo("codigoTributarioMunicipio", event.target.value)}
                    placeholder="Opcional, conforme o município"
                    disabled={loading}
                  />
                  {modeloEmissao === "MUNICIPAL_JOAO_PESSOA" && (
                    <p className="text-[11px] text-muted-foreground">João Pessoa normalmente não utiliza este campo.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nfse-nbs">Código NBS</Label>
                  <Input
                    id="nfse-nbs"
                    value={codigosFiscais.codigoNbs}
                    onChange={(event) => atualizarCodigo("codigoNbs", event.target.value)}
                    placeholder="Opcional · 9 dígitos"
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nfse-aliquota">Alíquota do ISS (%) {!isNacional && "*"}</Label>
                  <Input
                    id="nfse-aliquota"
                    value={codigosFiscais.aliquotaIss}
                    onChange={(event) => atualizarCodigo("aliquotaIss", event.target.value)}
                    placeholder={isNacional ? "Opcional, quando exigida" : "Ex.: 3,00"}
                    inputMode="decimal"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={handleEmitir} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Emitir NFS-e deste serviço
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-card/50 overflow-hidden">
            {fetching ? (
              <div className="flex flex-col items-center justify-center p-12 space-y-4">
                <Loader2 className="animate-spin h-8 w-8 text-primary/60" />
                <p className="text-sm text-muted-foreground animate-pulse">Carregando serviços...</p>
              </div>
            ) : servicos.length === 0 ? (
              <p className="text-sm text-center text-muted-foreground p-12">Nenhum serviço encontrado nesta OS.</p>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-semibold">Serviço/Descrição</TableHead>
                    <TableHead className="font-semibold text-right">Total (BRL)</TableHead>
                    <TableHead className="font-semibold text-center">Status Fiscal</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {servicos.map((s, index) => {
                    const valorTotal = (s.quantidade || 1) * (s.precounitario || 0);
                    const status = s.notaFiscalStatus;
                    const isProcessing = status === "PROCESSANDO";
                    const isAuthorized = status === "AUTORIZADA";
                    return (
                      <TableRow key={s.servicoid || index} className="group hover:bg-muted/30 transition-colors">
                        <TableCell className="max-w-[250px]">
                          <div className="font-medium line-clamp-2">
                             {s.servico?.descricao || "Serviço Padrão"}
                          </div>
                          {s.notaFiscalModelo ? (
                            <Badge variant="outline" className="mt-1 text-[9px]">
                              {s.notaFiscalModelo === "NACIONAL"
                                ? "NFS-e Nacional · MEI"
                                : s.notaFiscalModelo === "MUNICIPAL_CABEDELO"
                                  ? "NFS-e Cabedelo"
                                  : "NFS-e João Pessoa"}
                            </Badge>
                          ) : null}
                          <div className="text-[10px] text-muted-foreground font-mono">
                            Qtd: {s.quantidade} • Un: R$ {(s.precounitario || 0).toFixed(2)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary/80">
                           {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-center">
                           {!status && <Badge variant="outline" className="opacity-60">Pendente</Badge>}
                           {status === "AUTORIZADA" && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Autorizada</Badge>}
                           {status === "PROCESSANDO" && <Badge className="bg-sky-500/10 text-sky-600 border-sky-500/20 animate-pulse">Processando</Badge>}
                           {(status === "REJEITADA" || status === "ERRO") && (
                             <TooltipProvider>
                               <Tooltip>
                                 <TooltipTrigger asChild>
                                   <Badge variant="destructive" className="cursor-help transition-transform hover:scale-105">Rejeitada</Badge>
                                 </TooltipTrigger>
                                 <TooltipContent className="max-w-[300px] break-words">
                                    {s.notaFiscalErros ? JSON.stringify(s.notaFiscalErros) : "Erro não detalhado"}
                                 </TooltipContent>
                               </Tooltip>
                             </TooltipProvider>
                           )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            size="sm" 
                            disabled={loading || isProcessing} 
                            onClick={() => abrirFormularioEmissao(s)}
                            variant={isAuthorized ? "outline" : "default"}
                            className="hover:scale-105 active:scale-95 transition-all text-xs"
                          >
                            {isProcessing ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : null}
                            {isAuthorized ? "Revisar e re-emitir" : "Informar códigos"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 bg-muted/30 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
