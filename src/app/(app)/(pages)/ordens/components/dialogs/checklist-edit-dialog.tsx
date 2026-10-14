"use client";

import { useMemo } from "react";
import { CarFront } from "lucide-react";

import { uploadChecklistImages } from "../../lib/upload-checklist-images";
import { ChecklistRegistroDialog, type ChecklistGravado, type FonteChecklist } from "./checklist-registro-dialog";

// Dialog de edicao: carrega checklist/modelo existente e permite editar ate EM_ANDAMENTO.
// Nao tenta avancar status automaticamente (isso fica para o fluxo "primeira vez").

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId: number;
};

async function lerJson(r: Response, falha: string) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any)?.error || falha);
  return j as any;
}

function fonteDaOs(osId: number): FonteChecklist {
  return {
    chave: osId ? `os:${osId}` : "",
    videos: { osId },
    async carregar(): Promise<ChecklistGravado> {
      const j = await lerJson(await fetch(`/api/ordens/${osId}`, { cache: "no-store" }), "Falha ao carregar dados da OS");
      const osObj = j?.os ?? j;
      const modelId =
        osObj?.checklist_modelo_id ?? osObj?.checklistModeloId ?? osObj?.checklistTemplateId ?? osObj?.checklist_template_id ?? null;
      const linhas: any[] = Array.isArray(j?.checklist) ? j.checklist : [];
      return {
        modeloId: modelId ? String(modelId) : null,
        itens: linhas.map((row) => ({
          id: Number(row?.id),
          titulo: String(row?.item ?? ""),
          status: row?.status ?? null,
          observacao: row?.observacao ?? row?.obs ?? null,
          imagens: Array.isArray(row?.imagens) ? row.imagens : [],
        })),
      };
    },
    async salvar({ modeloId, itens }) {
      // A OS grava só os itens marcados.
      const checklist = itens
        .filter((it) => it.status)
        .map((it) => ({ item: it.titulo, status: it.status, observacao: it.observacao }));
      const j = await lerJson(
        await fetch(`/api/ordens/${osId}/checklist`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checklistTemplateId: modeloId, checklist }),
        }),
        "Falha ao salvar checklist",
      );
      const created: Array<{ id: number; item: string }> = j?.checklistCreated ?? [];
      const idPorTitulo: Record<string, number> = {};
      for (const row of created) {
        if (row?.item && row?.id) idPorTitulo[row.item] = row.id;
      }
      return idPorTitulo;
    },
    async enviarFotos(fotos, idPorTitulo) {
      await uploadChecklistImages(osId, fotos, idPorTitulo, {
        concurrency: 3,
        compress: {
          maxWidth: 1600,
          maxHeight: 1600,
          targetMaxBytes: 800 * 1024,
          minQuality: 0.6,
          maxQuality: 0.95,
        },
      });
    },
    async excluirFoto(checklistId, imageId) {
      await lerJson(await fetch(`/api/checklists/${checklistId}/images/${imageId}`, { method: "DELETE" }), "Falha ao excluir imagem");
    },
    aoSalvar() {
      window.dispatchEvent(new CustomEvent("os:refresh"));
    },
  };
}

export function ChecklistEditDialog({ open, onOpenChange, osId }: Props) {
  const fonte = useMemo(() => fonteDaOs(osId), [osId]);
  return (
    <ChecklistRegistroDialog
      open={open}
      onOpenChange={onOpenChange}
      fonte={fonte}
      titulo={
        <span className="inline-flex items-center gap-2">
          <CarFront className="h-4 w-4 text-primary" />
          Editar checklist da OS #{osId || "-"}
        </span>
      }
      descricao="Edite o checklist salvo desta OS."
    />
  );
}
