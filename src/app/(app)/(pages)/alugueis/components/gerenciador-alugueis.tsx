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
import { nomeDoCliente, quantidadeQueVoltou } from "../types";
import { AluguelDialog } from "./aluguel-dialog";
import { AlugueisTabs } from "./alugueis-tabs";
import { ChecklistAluguelDialog, type TipoChecklistAluguel } from "./checklist-aluguel";
import { DetalhesAluguelDialog } from "./detalhes-aluguel-dialog";
import { EncerrarAluguelDialog } from "./encerrar-aluguel-dialog";
import type { AcaoAluguel } from "./row-actions";
import { fmtData, fmtLimite } from "./status-aluguel";

type Confirmacao = { acao: "pausar" | "reiniciar" | "excluir"; aluguel: AluguelLista } | null;

const TEM_SALDO = new Set(["PRODUTO", "USOCONSUMO", "GERAL"]);

export default function GerenciadorAlugueis() {
  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [detalhesId, setDetalhesId] = useState<number | null>(null);
  const [checklist, setChecklist] = useState<{ aluguelId: number; tipo: TipoChecklistAluguel } | null>(null);
  const [encerrando, setEncerrando] = useState<AluguelLista | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null);
  const [motivo, setMotivo] = useState("");
  const [executando, setExecutando] = useState(false);

  function aoAcionar(acao: AcaoAluguel, aluguel: AluguelLista) {
    switch (acao) {
      case "detalhes":
        setDetalhesId(aluguel.id);
        break;
      case "checklist-saida":
        setChecklist({ aluguelId: aluguel.id, tipo: "SAIDA" });
        break;
      case "checklist-retorno":
        setChecklist({ aluguelId: aluguel.id, tipo: "RETORNO" });
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
      if (acao === "excluir") {
        await excluirAluguel(aluguel.id, motivo.trim());
        // Excluído, os detalhes dele não têm mais o que mostrar.
        setDetalhesId((atual) => (atual === aluguel.id ? null : atual));
      }
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
  // Aberto: o que está fora volta. Encerrado: só a falta do retorno, que seguiu fora.
  const devolveEstoque =
    alvo &&
    alvo.itens.some(
      (item) =>
        TEM_SALDO.has(item.tipo) &&
        (alvo.status === "ENCERRADO" ? quantidadeQueVoltou(item) < item.quantidade : !item.devolvido_em),
    );

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
        aluguelId={detalhesId}
        onOpenChange={(aberto) => !aberto && setDetalhesId(null)}
        onAcao={aoAcionar}
      />

      <EncerrarAluguelDialog aluguel={encerrando} onOpenChange={(aberto) => !aberto && setEncerrando(null)} />

      <ChecklistAluguelDialog alvo={checklist} onOpenChange={(aberto) => !aberto && setChecklist(null)} />

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
                    {alvo.data_limite
                      ? `A contagem fica congelada em ${diasRestantes(alvo)} dia(s) até o limite.`
                      : "A contagem de dias em aberto fica congelada."}{" "}
                    Para voltar a contar, use Reiniciar. O estoque não muda.
                  </p>
                ) : null}
                {confirmacao?.acao === "reiniciar" && novasDatas ? (
                  novasDatas.data_limite ? (
                    <p>
                      A contagem volta a correr a partir de hoje, com a mesma duração: de{" "}
                      <strong className="text-foreground">{fmtData(novasDatas.data_inicio)}</strong> a{" "}
                      <strong className="text-foreground">{fmtLimite(novasDatas.data_limite)}</strong>.
                    </p>
                  ) : (
                    <p>
                      A contagem volta a correr a partir de hoje (
                      <strong className="text-foreground">{fmtData(novasDatas.data_inicio)}</strong>), sem data limite.
                    </p>
                  )
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
