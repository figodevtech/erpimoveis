"use client";

// Rascunho de checklist do aluguel: o mesmo dialog de preenchimento da saída da
// OS, com os mesmos modelos. Nada é gravado enquanto o rascunho é montado; quem
// usa chama `gravarChecklist` depois de ter o id do aluguel.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { ClipboardCheck } from "lucide-react";
import {
  ChecklistPreenchimentoDialog,
  type ChecklistMark,
  type ChecklistTemplate,
} from "@/components/checklist/checklist-preenchimento-dialog";
import { enviarFotosChecklist, salvarChecklistAluguel } from "../lib/api";
import type { ChecklistAluguel } from "../types";

export type TipoChecklistAluguel = "SAIDA" | "RETORNO";

export type RascunhoChecklist = {
  templateId: string;
  marks: Record<string, ChecklistMark>;
  images: Record<string, File[]>;
};

export const RASCUNHO_VAZIO: RascunhoChecklist = { templateId: "", marks: {}, images: {} };

export const TEXTOS_CHECKLIST: Record<TipoChecklistAluguel, { titulo: string; descricao: string }> = {
  SAIDA: {
    titulo: "Checklist de saída",
    descricao: "Estado do bem na entrega ao cliente. Itens sem marcação ficam em branco.",
  },
  RETORNO: {
    titulo: "Checklist de retorno",
    descricao: "Estado do bem na devolução. Itens sem marcação ficam em branco.",
  },
};

export function useModelosChecklist(ativo: boolean) {
  const [modelos, setModelos] = useState<ChecklistTemplate[]>([]);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    fetch("/api/checklist-modelos?ativos=1", { cache: "no-store" })
      .then(async (resposta) => {
        const json = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(json?.error || "Falha ao carregar modelos.");
        if (vivo) setModelos(json?.items ?? []);
      })
      .catch((error) => toast.error(error?.message || "Falha ao carregar modelos de checklist."));
    return () => {
      vivo = false;
    };
  }, [ativo]);
  return modelos;
}

/** Remonta o rascunho a partir do checklist gravado, casando os itens pelo título. */
export function rascunhoDoSalvo(salvo: ChecklistAluguel | undefined, modelos: ChecklistTemplate[]): RascunhoChecklist {
  if (!salvo?.checklist_modelo_id) return RASCUNHO_VAZIO;
  const modelo = modelos.find((item) => item.id === String(salvo.checklist_modelo_id));
  if (!modelo) return RASCUNHO_VAZIO;
  const porTitulo = new Map(salvo.itens.map((item) => [item.titulo.trim(), item]));
  return {
    templateId: modelo.id,
    marks: Object.fromEntries(
      modelo.itens.map((item) => {
        const gravado = porTitulo.get(item.titulo.trim());
        return [item.id, { status: (gravado?.status ?? "") as ChecklistMark["status"], observacao: gravado?.observacao ?? "" }];
      }),
    ),
    images: {},
  };
}

/** Grava o checklist e envia as fotos novas de cada item. */
export async function gravarChecklist(
  aluguelId: number,
  tipo: TipoChecklistAluguel,
  rascunho: RascunhoChecklist,
  modelos: ChecklistTemplate[],
) {
  const modelo = modelos.find((item) => item.id === rascunho.templateId);
  if (!modelo) return;
  const salvo = await salvarChecklistAluguel(aluguelId, {
    tipo,
    modeloId: modelo.id,
    itens: modelo.itens.map((item) => ({
      titulo: item.titulo,
      descricao: item.descricao ?? null,
      status: rascunho.marks[item.id]?.status || null,
      observacao: rascunho.marks[item.id]?.observacao || null,
      modeloItemId: item.id,
    })),
  });
  const idPorTitulo = new Map(salvo.itens.map((item) => [item.titulo.trim(), item.id]));
  for (const [titulo, arquivos] of Object.entries(rascunho.images)) {
    const itemId = idPorTitulo.get(titulo.trim());
    if (!itemId || !arquivos.length) continue;
    await enviarFotosChecklist(itemId, arquivos);
  }
}

export function resumoDoRascunho(rascunho: RascunhoChecklist, modelos: ChecklistTemplate[]) {
  const modelo = modelos.find((item) => item.id === rascunho.templateId);
  if (!modelo) return null;
  const marcados = modelo.itens.filter((item) => rascunho.marks[item.id]?.status).length;
  const fotos = Object.values(rascunho.images).reduce((total, arquivos) => total + arquivos.length, 0);
  return `${modelo.nome} · ${marcados} de ${modelo.itens.length} itens marcados${fotos ? ` · ${fotos} foto(s)` : ""}`;
}

/** Linha com o resumo do rascunho e o botão que abre o preenchimento. */
export function ChecklistRascunhoCard({
  tipo,
  rascunho,
  modelos,
  onChange,
  disabled,
  ajuda,
}: {
  tipo: TipoChecklistAluguel;
  rascunho: RascunhoChecklist;
  modelos: ChecklistTemplate[];
  onChange: (rascunho: RascunhoChecklist) => void;
  disabled?: boolean;
  ajuda?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const resumo = useMemo(() => resumoDoRascunho(rascunho, modelos), [rascunho, modelos]);
  const textos = TEXTOS_CHECKLIST[tipo];

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-md border bg-card p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            {textos.titulo}
          </p>
          <p className="text-xs text-muted-foreground">{resumo ?? ajuda ?? "Opcional"}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {resumo ? (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(RASCUNHO_VAZIO)}>
              Remover
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={disabled || !modelos.length} onClick={() => setAberto(true)}>
            {resumo ? "Editar" : "Preencher"}
          </Button>
        </div>
      </div>
      {aberto ? (
        <ChecklistPreenchimentoDialog
          open
          onOpenChange={setAberto}
          titulo={textos.titulo}
          descricao={textos.descricao}
          exigirTodos={false}
          templates={modelos}
          templateId={rascunho.templateId}
          marks={rascunho.marks}
          images={rascunho.images}
          videos={{}}
          onVideos={() => undefined}
          videoEnabled={false}
          onApply={(templateId, marks, images) => onChange({ templateId, marks, images })}
        />
      ) : null}
    </>
  );
}
