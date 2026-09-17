"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { FileCheck2, RefreshCw, ShieldAlert } from "lucide-react";

import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

import {
  closeSpedCompetencia,
  downloadSpedFile,
  generateSpedFile,
  getSpedCompetencia,
  import1601File,
  importPreviousEfdFile,
  listSpedCompetencias,
  reopenSpedCompetencia,
  validateSpedCompetencia,
} from "./api";
import type { SpedCompetenciaDetail, SpedCompetenciaSummary } from "./types";
import { SpedActionDialog, type SpedPendingAction } from "./components/action-dialog";
import { CompetenciaDetail } from "./components/competencia-detail";
import { CompetenciaList } from "./components/competencia-list";
import type { SpedImportKind } from "./components/import-panel";

export function SpedWorkspace() {
  const { data: session } = useSession();
  const permissions = (session?.user as { permissoes?: unknown } | undefined)?.permissoes;
  const canView = permissionSetHas(permissions, PERMS.FISCAL_SPED);
  const canManage = permissionSetHas(
    permissions,
    PERMS.FISCAL_SPED_GERENCIAR,
  );

  const [competencias, setCompetencias] = useState<SpedCompetenciaSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SpedCompetenciaDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<SpedPendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const isRefresh = listRevision > 0;
    if (isRefresh) setListRefreshing(true);
    else setListLoading(true);

    listSpedCompetencias(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setCompetencias(items);
        setListError(null);
        setSelectedId((current) => {
          if (current && items.some((item) => item.id === current)) return current;
          return items[0]?.id ?? null;
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setListError(error instanceof Error ? error.message : "Não foi possível carregar as competências.");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setListLoading(false);
        setListRefreshing(false);
      });

    return () => controller.abort();
  }, [listRevision]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    const controller = new AbortController();
    setDetailLoading(true);
    getSpedCompetencia(selectedId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setDetail(value);
        setDetailError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDetail(null);
        setDetailError(error instanceof Error ? error.message : "Não foi possível carregar a competência.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });

    return () => controller.abort();
  }, [detailRevision, selectedId]);

  const selectedSummary = useMemo(
    () => competencias.find((competencia) => competencia.id === selectedId) ?? null,
    [competencias, selectedId],
  );

  const refreshAll = useCallback(() => {
    setListRevision((value) => value + 1);
    if (selectedId) setDetailRevision((value) => value + 1);
  }, [selectedId]);

  const executeAction = useCallback(async (reason?: string) => {
    if (!pendingAction || !detail) return;

    if (pendingAction.type === "FECHAR") {
      const hasPendingGate = detail.gates.some((gate) => gate.status === "PENDENTE");
      const hasBlockingIssue = detail.diagnosticos.bloqueios + detail.diagnosticos.erros > 0;
      if (detail.status !== "APTA" || hasPendingGate || hasBlockingIssue) {
        toast.error("A competência não pode ser fechada", {
          description: "Resolva os gates e as inconsistências bloqueantes e valide novamente.",
        });
        setPendingAction(null);
        return;
      }
    }

    setActionBusy(true);
    try {
      if (pendingAction.type === "BAIXAR") {
        await downloadSpedFile(pendingAction.file);
        toast.success("Download do arquivo SPED iniciado.");
      } else {
        const response = pendingAction.type === "VALIDAR"
          ? await validateSpedCompetencia(detail)
          : pendingAction.type === "FECHAR"
            ? await closeSpedCompetencia(detail)
            : pendingAction.type === "REABRIR"
              ? await reopenSpedCompetencia(detail, reason ?? "")
              : await generateSpedFile(detail);

        toast.success(actionSuccessMessage(pendingAction.type), {
          description: response.message,
        });
        setListRevision((value) => value + 1);
        setDetailRevision((value) => value + 1);
      }
      setPendingAction(null);
    } catch (error: unknown) {
      toast.error("Não foi possível concluir a operação", {
        description: error instanceof Error ? error.message : "Falha inesperada na operação do SPED.",
      });
    } finally {
      setActionBusy(false);
    }
  }, [detail, pendingAction]);

  const executeImport = useCallback(async (kind: SpedImportKind, file: File) => {
    if (!detail) return;
    setActionBusy(true);
    try {
      const response = kind === "EFD_ANTERIOR"
        ? await importPreviousEfdFile(detail.id, file)
        : await import1601File(detail.id, file);
      toast.success(response.data.duplicate ? "Arquivo já estava importado." : "Importação concluída.", {
        description: kind === "EFD_ANTERIOR"
          ? "A EFD anterior foi validada e vinculada à competência."
          : `${response.data.lineCount ?? 0} linha(s) do registro 1601 foram validadas.`,
      });
      setListRevision((value) => value + 1);
      setDetailRevision((value) => value + 1);
    } catch (error: unknown) {
      toast.error("Não foi possível importar o arquivo", {
        description: error instanceof Error ? error.message : "Falha inesperada na importação fiscal.",
      });
    } finally {
      setActionBusy(false);
    }
  }, [detail]);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 className="size-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight">SPED Fiscal</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Diagnóstico, fechamento e geração da EFD ICMS/IPI com rastreabilidade das fontes fiscais.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">O pré-validador do ERP não substitui o PVA oficial.</p>
      </header>

      {listError ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Falha ao carregar o módulo SPED</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{listError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setListRevision((value) => value + 1)}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <CompetenciaList
        competencias={competencias}
        selectedId={selectedId}
        loading={listLoading}
        refreshing={listRefreshing}
        onSelect={setSelectedId}
        onRefresh={refreshAll}
      />

      {detailError ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Falha ao abrir {selectedSummary ? `a competência ${selectedSummary.competencia}` : "a competência"}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{detailError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setDetailRevision((value) => value + 1)}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <CompetenciaDetail
        competencia={detail}
        loading={detailLoading}
        canDownload={canView}
        canManage={canManage}
        busy={actionBusy}
        onAction={setPendingAction}
        onImport={executeImport}
        onRefresh={refreshAll}
      />

      {detail && pendingAction ? (
        <SpedActionDialog
          action={pendingAction}
          competencia={detail}
          busy={actionBusy}
          onCancel={() => setPendingAction(null)}
          onConfirm={executeAction}
        />
      ) : null}
    </div>
  );
}

function actionSuccessMessage(action: Exclude<SpedPendingAction["type"], "BAIXAR">) {
  return {
    VALIDAR: "Validação concluída.",
    FECHAR: "Competência fechada.",
    REABRIR: "Nova versão criada.",
    GERAR: "Arquivo SPED gerado.",
  }[action];
}
