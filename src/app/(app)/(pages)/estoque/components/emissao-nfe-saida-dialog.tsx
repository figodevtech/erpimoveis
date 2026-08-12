"use client";

// Cartão de NF-e dentro dos detalhes da saída de estoque.
//
// Só lista as notas da saída e abre o diálogo de emissão. A natureza fiscal, o
// documento de origem e o destinatário são decididos lá dentro, no
// `NfeSaidaOrigemEditor` — antes existia um diálogo separado só para gravar esse
// contexto antes de abrir o assistente, o que perguntava o destinatário duas
// vezes e obrigava a passar por duas telas para uma emissão só.

import { useCallback, useEffect, useState } from "react";
import { ReceiptText } from "lucide-react";

import { GerarNotaDeOsDialog } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/gerarNotaDeOsDialog/gerarNotaDeOsDialog";
import { AutorizarNfeButton } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/autorizarNfe-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type NfeResumo = {
  id: number;
  numero: number;
  serie: number;
  status: string;
  chave_acesso?: string | null;
  total_nfe?: number | null;
  motivo_rejeicao?: string | null;
};

const STATUS_EDITAVEIS = ["RASCUNHO", "REJEITADA"];
const STATUS_TRANSMITIDOS = [
  "ASSINADA",
  "ENVIADA",
  "AUTORIZADA",
  "PENDENTE_ENVIO",
  "CONTINGENCIA",
  "RESULTADO_INCERTO",
];

function statusTone(status: string) {
  if (status === "AUTORIZADA") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "REJEITADA" || status === "DENEGADA") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

export function SaidaNfeActions({ saidaId }: { saidaId: number }) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [editingNfeId, setEditingNfeId] = useState<number | null>(null);
  const [notes, setNotes] = useState<NfeResumo[]>([]);

  const buscarNotas = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/nfe/por-saida/${saidaId}`, {
      cache: "no-store",
      signal,
    });
    const json = await response.json().catch(() => null);
    return response.ok && json?.ok ? ((json.nfes ?? []) as NfeResumo[]) : null;
  }, [saidaId]);

  const loadNotes = useCallback(async () => {
    const nfes = await buscarNotas();
    if (nfes) setNotes(nfes);
  }, [buscarNotas]);

  useEffect(() => {
    const controller = new AbortController();
    // A lista chega de forma assíncrona e o cancelamento evita gravar estado de
    // uma saída que o usuário já fechou.
    void buscarNotas(controller.signal)
      .then((nfes) => {
        if (!controller.signal.aborted && nfes) setNotes(nfes);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [buscarNotas]);

  const activeNote = notes.find((note) => STATUS_EDITAVEIS.includes(note.status));
  const transmittedNote = notes.find((note) => STATUS_TRANSMITIDOS.includes(note.status));

  function abrirEmissao(nfeId: number | null) {
    setEditingNfeId(nfeId);
    setAssistantOpen(true);
  }

  return (
    <>
      <div className="space-y-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-semibold">
              <ReceiptText className="size-4" /> NF-e desta saída
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              A natureza fiscal é escolhida na emissão; o motivo do estoque não classifica a operação.
            </p>
          </div>
          <Button
            type="button"
            disabled={Boolean(transmittedNote)}
            onClick={() => abrirEmissao(activeNote?.id ?? null)}
          >
            {activeNote ? "Revisar emissão" : transmittedNote ? "NF-e já transmitida" : "Emitir NF-e de saída"}
          </Button>
        </div>

        {notes.map((note) => (
          <div key={note.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">NF-e nº {note.numero}, série {note.serie}</span>
                <Badge variant="outline" className={statusTone(note.status)}>{note.status}</Badge>
              </div>
              {note.motivo_rejeicao ? <p className="mt-1 text-xs text-destructive">{note.motivo_rejeicao}</p> : null}
              {note.chave_acesso ? <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{note.chave_acesso}</p> : null}
            </div>
            <div className="flex gap-2">
              {note.status === "REJEITADA" ? (
                <Button type="button" variant="outline" onClick={() => abrirEmissao(note.id)}>
                  Corrigir
                </Button>
              ) : null}
              {/*
                Rejeitada também transmite: corrigir a nota não muda o status de
                volta para RASCUNHO, então exigir RASCUNHO aqui deixava a nota
                corrigida sem nenhum botão para reenviar. A rota de autorização
                aceita os dois estados.
              */}
              {STATUS_EDITAVEIS.includes(note.status) ? (
                <AutorizarNfeButton nfeId={note.id} onAfterAuthorize={() => void loadNotes()}>
                  {note.status === "REJEITADA" ? "Transmitir de novo" : "Autorizar NF-e"}
                </AutorizarNfeButton>
              ) : null}
            </div>
          </div>
        ))}

        {!notes.length ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Nenhuma NF-e foi gerada para esta saída.
          </p>
        ) : null}
      </div>

      <GerarNotaDeOsDialog
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        saidaId={saidaId}
        nfeId={editingNfeId}
        onAfterGenerate={() => {
          setEditingNfeId(null);
          void loadNotes();
        }}
      />
    </>
  );
}
