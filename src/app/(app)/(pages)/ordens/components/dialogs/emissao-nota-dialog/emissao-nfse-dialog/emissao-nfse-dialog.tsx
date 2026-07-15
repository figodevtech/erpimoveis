"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, AlertCircle } from "lucide-react";
import { toast } from "@/lib/toast";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";

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

  useEffect(() => {
    if (open && osId) {
      carregarServicos();
    } else {
      setServicos([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, osId]);

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
  }, [open, osId]);

  const carregarServicos = async () => {
    setFetching(true);
    try {
      const res = await fetch(`/api/nfse/servicos-de-os/${osId}`);
      const json = await res.json();
      if (json.ok) setServicos(json.servicos || []);
    } catch {
      toast.error("Erro ao carregar serviços da OS");
    } finally {
      setFetching(false);
    }
  };

  const handleEmitir = async (osservicoId: number) => {
    if (!osId) return;

    setLoading(true);
    const toastId = toast.loading("Emitindo NFS-e pela Focus NFe...");

    try {
      const res = await fetch(`/api/nfse/de-os/${osId}`, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ osservicoId }) 
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json.message || "Erro ao gerar NFS-e", { id: toastId });
        return;
      }

      toast.success("NFS-e registrada com sucesso!", { id: toastId });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-5 w-5 text-amber-500 fill-amber-500" /> Emissão de NFS-e por Serviço
          </DialogTitle>
          <DialogDescription>
            Cada serviço pode ser gerado em uma Nota Fiscal individual para cumprir requisitos fiscais. Você pode emitir novas notas quantas vezes desejar.
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
                            onClick={() => handleEmitir(s.servicoid)}
                            variant={isAuthorized ? "outline" : "default"}
                            className="hover:scale-105 active:scale-95 transition-all text-xs"
                          >
                            {isProcessing ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : null}
                            {isAuthorized ? "Re-emitir Nota" : "Emitir Nota"}
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
