"use client";

// Checklist do aluguel: o mesmo registro da ação "Checklist" da OS
// (ChecklistRegistroDialog), com os mesmos modelos. Saída enquanto o aluguel
// está aberto; retorno só depois do encerramento. Vídeo fica de fora: o
// armazenamento de vídeos é por OS.

import { useMemo } from "react";
import { ClipboardCheck } from "lucide-react";
import {
  ChecklistRegistroDialog,
  type FonteChecklist,
} from "@/app/(app)/(pages)/ordens/components/dialogs/checklist-registro-dialog";
import { compressImage, runWithConcurrency } from "@/app/(app)/(pages)/ordens/lib/image-compress";
import { safeUUID } from "@/app/(app)/(pages)/ordens/lib/safe-uuid";
import {
  avisarAlteracaoAlugueis,
  carregarAluguel,
  enviarFotosChecklist,
  excluirFotoChecklist,
  salvarChecklistAluguel,
} from "../lib/api";

export type TipoChecklistAluguel = "SAIDA" | "RETORNO";

export const TEXTOS_CHECKLIST: Record<TipoChecklistAluguel, { titulo: string; descricao: string }> = {
  SAIDA: {
    titulo: "Checklist de saída",
    descricao: "Estado do bem na entrega ao cliente.",
  },
  RETORNO: {
    titulo: "Checklist de retorno",
    descricao: "Estado do bem na devolução.",
  },
};

function fonteDoAluguel(aluguelId: number, tipo: TipoChecklistAluguel): FonteChecklist {
  return {
    chave: aluguelId ? `aluguel:${aluguelId}:${tipo}` : "",
    async carregar() {
      const aluguel = await carregarAluguel(aluguelId);
      const salvo = aluguel.checklists.find((item) => item.tipo === tipo);
      return {
        modeloId: salvo?.checklist_modelo_id ? String(salvo.checklist_modelo_id) : null,
        itens: [...(salvo?.itens ?? [])]
          .sort((a, b) => a.ordem - b.ordem || a.id - b.id)
          .map((item) => ({
            id: item.id,
            titulo: item.titulo,
            status: item.status ?? null,
            observacao: item.observacao ?? null,
            imagens: item.imagens ?? [],
          })),
      };
    },
    async salvar({ modeloId, itens }) {
      // Ao contrário da OS, o aluguel guarda também o item sem marcação.
      const salvo = await salvarChecklistAluguel(aluguelId, { tipo, modeloId, itens });
      return Object.fromEntries(salvo.itens.map((item) => [item.titulo.trim(), item.id]));
    },
    async enviarFotos(fotos, idPorTitulo) {
      const tarefas = Object.entries(fotos).flatMap(([titulo, arquivos]) => {
        const itemId = idPorTitulo[titulo.trim()];
        return itemId ? arquivos.map((arquivo) => ({ itemId, arquivo })) : [];
      });
      // Mesma compressão das fotos do checklist da OS.
      await runWithConcurrency(tarefas, 3, async ({ itemId, arquivo }) => {
        const { blob, ext, type } = await compressImage(arquivo);
        await enviarFotosChecklist(itemId, [new File([blob], `${safeUUID()}.${ext}`, { type })]);
      });
    },
    excluirFoto: (itemId, fotoId) => excluirFotoChecklist(itemId, fotoId).then(() => undefined),
    aoSalvar: avisarAlteracaoAlugueis,
  };
}

export function ChecklistAluguelDialog({
  alvo,
  onOpenChange,
}: {
  alvo: { aluguelId: number; tipo: TipoChecklistAluguel } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const aluguelId = alvo?.aluguelId ?? 0;
  const tipo = alvo?.tipo ?? "SAIDA";
  const fonte = useMemo(() => fonteDoAluguel(aluguelId, tipo), [aluguelId, tipo]);
  const textos = TEXTOS_CHECKLIST[tipo];

  return (
    <ChecklistRegistroDialog
      open={Boolean(alvo)}
      onOpenChange={onOpenChange}
      fonte={fonte}
      titulo={
        <span className="inline-flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          {textos.titulo} do aluguel #{aluguelId || "-"}
        </span>
      }
      descricao={textos.descricao}
      mensagemSucesso={`${textos.titulo} gravado.`}
    />
  );
}
