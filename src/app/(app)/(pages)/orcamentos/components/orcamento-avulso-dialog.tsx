"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogShell } from "../../ordens/components/dialogs/dialog-shell";
import { OrcamentoAvulsoForm, type OrcamentoAvulsoFormHandle } from "./orcamento-avulso-form";

const dinheiro = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor) || 0);

export type OrcamentoAvulsoDialogProps = {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Ausente = criação. Presente = edição de um orçamento em aberto. */
  orcamentoId?: number;
  onConcluido?: (id: number) => void;
};

export function OrcamentoAvulsoDialog({
  open,
  onOpenChange,
  orcamentoId,
  onConcluido,
}: OrcamentoAvulsoDialogProps) {
  const formRef = useRef<OrcamentoAvulsoFormHandle | null>(null);

  const [totalProdutos, setTotalProdutos] = useState(0);
  const [totalServicos, setTotalServicos] = useState(0);
  const [totalGeral, setTotalGeral] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const ocupado = salvando || carregando;

  async function salvar() {
    if (ocupado) return;
    setSalvando(true);
    try {
      const id = await formRef.current?.salvar();
      if (id) onConcluido?.(id);
      onOpenChange(false);
    } catch {
      // O formulário já mostrou a mensagem; manter o dialog aberto para correção.
    } finally {
      setSalvando(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(valor) => {
        if (ocupado) return;
        onOpenChange(valor);
      }}
      title={orcamentoId ? "Editar orçamento" : "Novo orçamento"}
      titleSuffix={orcamentoId ? `#${orcamentoId}` : undefined}
      description="Orçamento avulso — não movimenta estoque nem financeiro."
      loading={carregando}
      maxW="md:max-w-[1100px]"
      mobileFull
      fixedHeight
      footer={
        <div className="flex w-full flex-col items-end justify-between gap-3 sm:flex-row sm:items-center">
          <div className="text-right sm:text-left">
            <div className="text-xs text-muted-foreground sm:text-sm">Total Geral</div>
            <div className="text-xl font-bold sm:text-2xl">{dinheiro(totalGeral)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {dinheiro(totalProdutos)} em produtos • {dinheiro(totalServicos)} em serviços
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={ocupado}>
              {salvando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : orcamentoId ? (
                "Salvar alterações"
              ) : (
                "Criar orçamento"
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="relative h-full min-h-0">
        {carregando ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="size-8 animate-spin rounded-full border-t-2 border-primary" />
            <span className="text-sm font-medium text-primary">Carregando</span>
          </div>
        ) : null}

        <div className={carregando ? "hidden" : undefined}>
          {open ? (
            <OrcamentoAvulsoForm
              // Remonta o formulário a cada abertura: sem isso, criar um
              // orçamento logo depois de editar outro herdaria o estado antigo.
              key={orcamentoId ?? "novo"}
              ref={formRef}
              orcamentoId={orcamentoId}
              onLoadingChange={setCarregando}
              onTotaisChange={({ totalProdutos, totalServicos, totalGeral }) => {
                setTotalProdutos(totalProdutos || 0);
                setTotalServicos(totalServicos || 0);
                setTotalGeral(totalGeral || 0);
              }}
            />
          ) : null}
        </div>
      </div>
    </DialogShell>
  );
}

export default OrcamentoAvulsoDialog;
