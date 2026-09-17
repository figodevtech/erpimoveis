"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardCheck, History, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";

import { recordSpedPvaValidation } from "../api";
import { formatTimestamp } from "../formatters";
import type { SpedArquivo, SpedPvaStatus } from "../types";
import { PvaStatusBadge } from "./status-badges";

export function PvaValidationDialog({
  file,
  canManage,
  timezone,
  onSuccess,
}: {
  file: SpedArquivo;
  canManage: boolean;
  timezone: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pvaVersao, setPvaVersao] = useState("10.1.0");
  const [status, setStatus] = useState<SpedPvaStatus>("APROVADO");
  const [observacao, setObservacao] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!pvaVersao.trim()) {
      toast.error("Informe a versão do PVA utilizada.");
      return;
    }
    setBusy(true);
    try {
      await recordSpedPvaValidation(file.id, {
        pvaVersao: pvaVersao.trim(),
        status,
        observacao: observacao.trim() || undefined,
      });
      toast.success("Validação do PVA registrada com sucesso!");
      setOpen(false);
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao registrar validação do PVA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1 text-xs"
        onClick={() => setOpen(true)}
      >
        <ClipboardCheck className="size-3.5" aria-hidden="true" />
        PVA
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
                Validação no PVA Oficial
              </DialogTitle>
              <DialogDescription>
                Registre o resultado da importação e validação deste arquivo no Programa Validador e Assinador da EFD.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              <div className="rounded-md border bg-muted/40 p-3 text-xs">
                <p className="font-medium text-foreground">{file.nome}</p>
                <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                  SHA-256: {file.sha256}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-muted-foreground">Status Atual:</span>
                  <PvaStatusBadge status={file.pvaStatus} />
                </div>
              </div>

              {canManage && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="pva-version" className="text-xs">Versão do PVA</Label>
                    <Input
                      id="pva-version"
                      value={pvaVersao}
                      onChange={(e) => setPvaVersao(e.target.value)}
                      placeholder="Ex: 10.1.0"
                      disabled={busy}
                      className="h-8 text-xs font-mono"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label className="text-xs">Resultado da Validação no PVA</Label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setStatus("APROVADO")}
                        className={`flex flex-col items-center justify-center rounded-md border p-2 text-xs font-medium transition-colors ${
                          status === "APROVADO"
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-border bg-background hover:bg-muted/50"
                        }`}
                      >
                        <span>Aprovado</span>
                        <span className="text-[10px] text-muted-foreground">Sem erros</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setStatus("COM_AVISOS")}
                        className={`flex flex-col items-center justify-center rounded-md border p-2 text-xs font-medium transition-colors ${
                          status === "COM_AVISOS"
                            ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            : "border-border bg-background hover:bg-muted/50"
                        }`}
                      >
                        <span>Com Avisos</span>
                        <span className="text-[10px] text-muted-foreground">Advertências</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setStatus("REJEITADO")}
                        className={`flex flex-col items-center justify-center rounded-md border p-2 text-xs font-medium transition-colors ${
                          status === "REJEITADO"
                            ? "border-destructive bg-destructive/10 text-destructive"
                            : "border-border bg-background hover:bg-muted/50"
                        }`}
                      >
                        <span>Rejeitado</span>
                        <span className="text-[10px] text-muted-foreground">Erros no PVA</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="pva-obs" className="text-xs">
                      Observações / Detalhes dos Erros ou Advertências
                    </Label>
                    <Textarea
                      id="pva-obs"
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                      placeholder="Cole os erros apontados pelo relatório do PVA ou notas explicativas do contador..."
                      rows={3}
                      disabled={busy}
                      className="text-xs resize-none font-mono"
                    />
                  </div>
                </>
              )}

              {file.pvaValidacoes && file.pvaValidacoes.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                    <History className="size-3.5" aria-hidden="true" />
                    Histórico de Validações
                  </h4>
                  <div className="space-y-2 max-h-36 overflow-y-auto">
                    {file.pvaValidacoes.map((val) => (
                      <div key={val.id} className="rounded border p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <PvaStatusBadge status={val.status} />
                            <span className="font-mono text-[10px] text-muted-foreground">PVA v{val.pvaVersao}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {formatTimestamp(val.validatedAt, timezone)}
                          </span>
                        </div>
                        {val.observacao && (
                          <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground bg-muted/40 p-1 rounded">
                            {val.observacao}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Cancelar
              </Button>
              {canManage && (
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                  Registrar Validação
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
