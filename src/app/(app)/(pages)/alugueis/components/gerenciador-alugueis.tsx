"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { datasAoReiniciar, diasRestantes } from "@/lib/alugueis/status";

import { avisarAlteracaoAlugueis, excluirAluguel, pausarAluguel, reiniciarAluguel } from "../lib/api";
import type { AluguelLista } from "../types";
import { nomeDoCliente } from "../types";
import { AluguelDialog } from "./aluguel-dialog";
import { AlugueisTabs } from "./alugueis-tabs";
import { DetalhesAluguelDialog, type AbaDetalhesAluguel } from "./detalhes-aluguel-dialog";
import { EncerrarAluguelDialog } from "./encerrar-aluguel-dialog";
import type { AcaoAluguel } from "./row-actions";
import { fmtData } from "./status-aluguel";

type Confirmacao = { acao: "pausar" | "reiniciar" | "excluir"; aluguel: AluguelLista } | null;

const TEM_SALDO = new Set(["PRODUTO", "USOCONSUMO", "GERAL"]);

export default function GerenciadorAlugueis() {
  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [detalhes, setDetalhes] = useState<{ id: number; aba: AbaDetalhesAluguel } | null>(null);
  const [encerrando, setEncerrando] = useState<AluguelLista | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null);
  const [motivo, setMotivo] = useState("");
  const [executando, setExecutando] = useState(false);

  function aoAcionar(acao: AcaoAluguel, aluguel: AluguelLista) {
    switch (acao) {
      case "detalhes":
        setDetalhes({ id: aluguel.id, aba: "resumo" });
        break;
      case "checklist-saida":
        setDetalhes({ id: aluguel.id, aba: "checklists" });
        break;
      case "editar":
        setEditandoId(aluguel.id);
        setFormAberto(true);
        break;
      case "encerrar":
        setEncerrando(aluguel);
        break;
      default:
        setMotivo("");
        setConfirmacao({ acao, aluguel });
    }
  }

  async function confirmar() {
    if (!confirmacao) return;
    const { acao, aluguel } = confirmacao;
    if (acao === "excluir" && !motivo.trim()) {
      toast.error("Informe o motivo da exclusão.");
      return;
    }
    setExecutando(true);
    try {
      if (acao === "pausar") await pausarAluguel(aluguel.id);
      if (acao === "reiniciar") await reiniciarAluguel(aluguel.id);
      if (acao === "excluir") await excluirAluguel(aluguel.id, motivo.trim());
      toast.success(
        acao === "pausar"
          ? `Aluguel #${aluguel.id} pausado.`
          : acao === "reiniciar"
            ? `Aluguel #${aluguel.id} reiniciado a partir de hoje.`
            : `Aluguel #${aluguel.id} excluído.`,
      );
      setConfirmacao(null);
      avisarAlteracaoAlugueis();
    } catch (error: any) {
      toast.error(error?.message || "Falha ao executar a ação.");
    } finally {
      setExecutando(false);
    }
  }

  const alvo = confirmacao?.aluguel;
  const novasDatas = alvo ? datasAoReiniciar(alvo) : null;
  const devolveEstoque =
    alvo && alvo.status !== "ENCERRADO" && alvo.itens.some((item) => TEM_SALDO.has(item.tipo) && !item.devolvido_em);

  return (
    <>
      <AlugueisTabs
        onNovo={() => {
          setEditandoId(null);
          setFormAberto(true);
        }}
        onAcao={aoAcionar}
      />

      <AluguelDialog
        open={formAberto}
        aluguelId={editandoId}
        onOpenChange={(aberto) => {
          setFormAberto(aberto);
          if (!aberto) setEditandoId(null);
        }}
      />

      <DetalhesAluguelDialog
        aluguelId={detalhes?.id ?? null}
        abaInicial={detalhes?.aba}
        onOpenChange={(aberto) => !aberto && setDetalhes(null)}
      />

      <EncerrarAluguelDialog aluguel={encerrando} onOpenChange={(aberto) => !aberto && setEncerrando(null)} />

      <AlertDialog open={Boolean(confirmacao)} onOpenChange={(aberto) => !aberto && !executando && setConfirmacao(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmacao?.acao === "pausar"
                ? `Pausar aluguel #${alvo?.id}?`
                : confirmacao?.acao === "reiniciar"
                  ? `Reiniciar aluguel #${alvo?.id}?`
                  : `Excluir aluguel #${alvo?.id}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{alvo ? nomeDoCliente(alvo) : null}</p>
                {confirmacao?.acao === "pausar" && alvo ? (
                  <p>
                    A contagem fica congelada em {diasRestantes(alvo)} dia(s) até o limite. Para voltar a contar, use
                    Reiniciar. O estoque não muda.
                  </p>
                ) : null}
                {confirmacao?.acao === "reiniciar" && novasDatas ? (
                  <p>
                    A contagem volta a correr a partir de hoje, com a mesma duração: de{" "}
                    <strong className="text-foreground">{fmtData(novasDatas.data_inicio)}</strong> a{" "}
                    <strong className="text-foreground">{fmtData(novasDatas.data_limite)}</strong>.
                  </p>
                ) : null}
                {confirmacao?.acao === "excluir" ? (
                  <p>
                    {devolveEstoque
                      ? "Os itens de estoque que estão fora voltam ao saldo pelo estorno da saída."
                      : "Nenhum saldo de estoque será alterado."}{" "}
                    O registro sai da lista, mas a auditoria guarda o histórico.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {confirmacao?.acao === "excluir" ? (
            <div className="space-y-1.5">
              <Label>Motivo *</Label>
              <Textarea rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={executando}>Voltar</AlertDialogCancel>
            <Button
              variant={confirmacao?.acao === "excluir" ? "destructive" : "default"}
              onClick={() => void confirmar()}
              disabled={executando}
            >
              {executando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmacao?.acao === "pausar" ? "Pausar" : confirmacao?.acao === "reiniciar" ? "Reiniciar" : "Excluir"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
