"use client";

import { FileInput, Landmark, Upload } from "lucide-react";
import { useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatCompetencia, formatInteger, formatTimestamp } from "../formatters";
import type { SpedCompetenciaDetail } from "../types";

export type SpedImportKind = "EFD_ANTERIOR" | "REGISTRO_1601";

export function ImportPanel({
  competencia,
  canManage,
  busy,
  onImport,
}: {
  competencia: SpedCompetenciaDetail;
  canManage: boolean;
  busy: boolean;
  onImport: (kind: SpedImportKind, file: File) => void;
}) {
  const previousRef = useRef<HTMLInputElement>(null);
  const paymentRef = useRef<HTMLInputElement>(null);
  const previous = competencia.importacoes.efdAnterior;
  const payments = competencia.importacoes.registros1601;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileInput className="size-4" aria-hidden="true" /> EFD anterior
          </CardTitle>
          <CardDescription>
            TXT oficial da competência imediatamente anterior, usado somente para saldos e reconciliação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {previous ? (
            <div className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{previous.nome}</p>
                <Badge variant="outline">{previous.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Competência {formatCompetencia(previous.competencia)} · importada em {formatTimestamp(previous.importadoEm, competencia.configuracao.timezoneIana)}
              </p>
              <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">SHA-256 {previous.sha256}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma EFD anterior validada foi importada.</p>
          )}
          <input
            ref={previousRef}
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onImport("EFD_ANTERIOR", file);
            }}
          />
          <Button type="button" variant="outline" disabled={!canManage || busy || competencia.status === "FECHADA"} onClick={() => previousRef.current?.click()}>
            <Upload aria-hidden="true" /> {previous ? "Importar nova versão" : "Importar TXT"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="size-4" aria-hidden="true" /> Dados do registro 1601
          </CardTitle>
          <CardDescription>
            CSV revisado por instituição e intermediário; nenhuma operação é inferida automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {payments.length ? (
            <div className="space-y-2">
              {payments.map((item) => (
                <div key={item.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.nome}</p>
                    <Badge variant="outline">{formatInteger(item.quantidadeLinhas)} linha(s)</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTimestamp(item.importadoEm, competencia.configuracao.timezoneIana)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum CSV mensal validado foi importado.</p>
          )}
          <input
            ref={paymentRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onImport("REGISTRO_1601", file);
            }}
          />
          <Button type="button" variant="outline" disabled={!canManage || busy || competencia.status === "FECHADA"} onClick={() => paymentRef.current?.click()}>
            <Upload aria-hidden="true" /> Importar CSV
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
