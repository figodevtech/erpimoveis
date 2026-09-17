"use client";

import { useState } from "react";
import { Download, FileCheck2, FileOutput, LockKeyhole, RotateCcw } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { formatCompetencia } from "../formatters";
import type { SpedArquivo, SpedCompetenciaDetail } from "../types";

export type SpedPendingAction =
  | { type: "VALIDAR" }
  | { type: "FECHAR" }
  | { type: "REABRIR" }
  | { type: "GERAR" }
  | { type: "BAIXAR"; file: SpedArquivo };

const ACTION_CONFIG = {
  VALIDAR: {
    title: "Validar competência",
    description: "O diagnóstico será refeito com os dados operacionais atuais. Esta validação interna não substitui o PVA oficial.",
    confirm: "Executar validação",
    icon: FileCheck2,
  },
  FECHAR: {
    title: "Fechar competência",
    description: "Os dados fiscais serão congelados em uma versão imutável. Correções posteriores exigirão reabertura auditada e uma nova versão.",
    confirm: "Fechar competência",
    icon: LockKeyhole,
  },
  REABRIR: {
    title: "Reabrir competência",
    description: "A versão fechada será preservada e uma nova versão de trabalho será criada. Informe um motivo fiscal objetivo.",
    confirm: "Criar nova versão",
    icon: RotateCcw,
  },
  GERAR: {
    title: "Gerar arquivo EFD",
    description: "O TXT será produzido somente a partir do snapshot fechado. Uma nova geração não sobrescreve arquivos anteriores.",
    confirm: "Gerar TXT",
    icon: FileOutput,
  },
  BAIXAR: {
    title: "Baixar arquivo EFD",
    description: "O download usa o artefato imutável armazenado para esta versão. Confira o hash após transferir o arquivo.",
    confirm: "Baixar TXT",
    icon: Download,
  },
} as const;

export function SpedActionDialog({
  action,
  competencia,
  busy,
  onCancel,
  onConfirm,
}: {
  action: SpedPendingAction | null;
  competencia: SpedCompetenciaDetail;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}) {
  const [reason, setReason] = useState("");

  if (!action) return null;
  const config = ACTION_CONFIG[action.type];
  const Icon = config.icon;
  const requiresReason = action.type === "REABRIR";
  const invalidReason = requiresReason && reason.trim().length < 10;

  return (
    <AlertDialog open onOpenChange={(open) => {
      if (!open && !busy) {
        setReason("");
        onCancel();
      }
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full border bg-muted">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <AlertDialogTitle>{config.title}</AlertDialogTitle>
          <AlertDialogDescription>{config.description}</AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Competência</dt>
            <dd className="font-medium">{formatCompetencia(competencia.competencia)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Versão</dt>
            <dd className="font-medium">{competencia.versao ? `v${competencia.versao}` : "Ainda não versionada"}</dd>
          </div>
          {action.type === "BAIXAR" ? (
            <div className="col-span-2 min-w-0">
              <dt className="text-xs text-muted-foreground">Arquivo</dt>
              <dd className="truncate font-medium">{action.file.nome}</dd>
            </div>
          ) : null}
        </dl>

        {requiresReason ? (
          <div className="grid gap-2">
            <Label htmlFor="sped-reopen-reason">Motivo da reabertura</Label>
            <Textarea
              id="sped-reopen-reason"
              value={reason}
              disabled={busy}
              maxLength={500}
              placeholder="Descreva a correção fiscal que exige uma nova versão..."
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Mínimo de 10 caracteres · {reason.length}/500</p>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={() => setReason("")}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || invalidReason}
            onClick={(event) => {
              event.preventDefault();
              onConfirm(requiresReason ? reason.trim() : undefined);
            }}
          >
            {busy ? "Processando..." : config.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
