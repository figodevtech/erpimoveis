"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Link as LinkIcon, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogShell } from "../dialogs/dialog-shell";
import { RealizadoresOSDialog } from "../dialogs/realizadores-os-dialog";
import { OrcamentoForm } from "./orcamento-form";
import type { OrcamentoFormHandle, ServicoSemRealizador } from "./tipos";

const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);

export type OrcamentoDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osSelecionada: any | null;
  onSalvarOrcamento?: () => void | Promise<void>;
  onGerarLinkAprovacao?: () => void | Promise<void>;
};

export function OrcamentoDialog({
  open,
  onOpenChange,
  osSelecionada,
  onSalvarOrcamento,
  onGerarLinkAprovacao,
}: OrcamentoDialogProps) {
  const formRef = useRef<OrcamentoFormHandle | null>(null);

  const [totalProdutos, setTotalProdutos] = useState(0);
  const [totalServicos, setTotalServicos] = useState(0);
  const [totalGeral, setTotalGeral] = useState(0);

  const [salvando, setSalvando] = useState(false);
  const [gerandoLink, setGerandoLink] = useState(false);
  const [carregandoDados, setCarregandoDados] = useState(false);

  // Serviço acrescentado a uma OS já em andamento entra sem realizador. O
  // salvamento passa (o vínculo só pode ser gravado depois que a linha existe),
  // mas a edição não fecha antes de alguém ser atribuído.
  const [servicosSemRealizador, setServicosSemRealizador] = useState<ServicoSemRealizador[]>([]);

  const numero = useMemo(
    () => osSelecionada?.numero ?? (osSelecionada?.id != null ? String(osSelecionada.id) : "—"),
    [osSelecionada],
  );

  const clienteNome = useMemo(
    () =>
      typeof osSelecionada?.cliente === "string"
        ? osSelecionada.cliente
        : osSelecionada?.cliente?.nome ?? "",
    [osSelecionada],
  );

  const veiculoStr = useMemo(() => {
    const v = osSelecionada?.veiculo;
    if (!v) return "";
    if (typeof v === "string") return v;
    const modelo = v?.modelo ?? "";
    const placa = v?.placa ?? "";
    const sep = modelo && placa ? " • " : "";
    return `${modelo}${sep}${placa}`;
  }, [osSelecionada]);

  const ordemServico = useMemo(
    () => ({
      id: osSelecionada?.id ?? 0,
      numero,
      cliente: clienteNome || undefined,
      veiculo: veiculoStr || undefined,
    }),
    [osSelecionada, numero, clienteNome, veiculoStr],
  );

  useEffect(() => {
    if (!open || !ordemServico.id) return;
    setCarregandoDados(true);
  }, [open, ordemServico.id]);

  const busy = salvando || gerandoLink || carregandoDados;

  const idsServicosPendentes = useMemo(
    () => servicosSemRealizador.map((servico) => servico.servicoid),
    [servicosSemRealizador],
  );

  /** Salva e devolve os serviços que ficaram pendentes de realizador. */
  async function salvar(): Promise<ServicoSemRealizador[]> {
    if (onSalvarOrcamento) {
      await onSalvarOrcamento();
      return [];
    }

    const resultado = await formRef.current?.salvarOrcamento();
    const pendentes = resultado?.servicosSemRealizador ?? [];
    setServicosSemRealizador(pendentes);
    return pendentes;
  }

  async function handleSalvar() {
    if (busy) return;
    setSalvando(true);
    try {
      const pendentes = await salvar();
      if (pendentes.length > 0) return;

      onOpenChange(false);
    } finally {
      setSalvando(false);
    }
  }

  async function handleGerarLink() {
    if (!onGerarLinkAprovacao || busy) return;

    setGerandoLink(true);
    try {
      await salvar();
      await onGerarLinkAprovacao();
    } finally {
      setGerandoLink(false);
    }
  }

  return (
    <>
      <DialogShell
        open={open}
        onOpenChange={(v) => {
          if (busy) return;
          onOpenChange(v);
        }}
        title="Orçamento"
        titleSuffix={`OS #${numero}`}
        description={[clienteNome, veiculoStr].filter(Boolean).join(" • ")}
        loading={carregandoDados}
        maxW="md:max-w-[1100px]"
        mobileFull
        fixedHeight
        footer={
          <div className="flex w-full flex-col items-end justify-between gap-3 sm:flex-row sm:items-center">
            <div className="text-right sm:text-left">
              <div className="text-xs text-muted-foreground sm:text-sm">Total Geral</div>
              <div className="text-xl font-bold sm:text-2xl">{money(totalGeral)}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {money(totalProdutos)} em produtos • {money(totalServicos)} em serviços
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSalvar} className="bg-transparent" disabled={busy}>
                {salvando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar orçamento"
                )}
              </Button>

              {onGerarLinkAprovacao ? (
                <Button onClick={handleGerarLink} disabled={busy}>
                  {gerandoLink ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Gerando link...
                    </>
                  ) : (
                    <>
                      <LinkIcon className="mr-2 h-4 w-4" />
                      Salvar e gerar link
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div className="relative h-full min-h-0">
          {carregandoDados ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="size-8 animate-spin rounded-full border-t-2 border-primary" />
              <span className="text-sm font-medium text-primary">Carregando</span>
            </div>
          ) : null}

          <div className={carregandoDados ? "hidden" : undefined}>
            <OrcamentoForm
              ref={formRef}
              ordemServico={ordemServico}
              onLoadingChange={setCarregandoDados}
              onTotaisChange={({ totalProdutos, totalServicos, totalGeral }) => {
                setTotalProdutos(totalProdutos || 0);
                setTotalServicos(totalServicos || 0);
                setTotalGeral(totalGeral || 0);
              }}
            />
          </div>
        </div>
      </DialogShell>

      <RealizadoresOSDialog
        open={servicosSemRealizador.length > 0}
        onOpenChange={(v) => {
          if (!v) setServicosSemRealizador([]);
        }}
        osId={ordemServico.id || null}
        servicosObrigatorios={idsServicosPendentes}
        acao={{
          rotulo: "Concluir alteração",
          rotuloComPendencias: "Salvar e concluir",
          icone: <Users className="mr-2 h-4 w-4" />,
          aviso: "Defina o executor dos serviços incluídos no orçamento para concluir a alteração.",
          executar: async () => {
            setServicosSemRealizador([]);
            onOpenChange(false);
            window.dispatchEvent(new Event("os:refresh"));
            return true;
          },
        }}
      />
    </>
  );
}
