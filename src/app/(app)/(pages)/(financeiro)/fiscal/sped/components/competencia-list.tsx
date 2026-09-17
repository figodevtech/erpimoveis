"use client";

import { CalendarRange, FileText, RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { formatCompetencia, formatInteger } from "../formatters";
import type { SpedCompetenciaSummary } from "../types";
import { CompetenciaStatusBadge } from "./status-badges";

type CompetenciaListProps = {
  competencias: SpedCompetenciaSummary[];
  selectedId: string | null;
  loading: boolean;
  refreshing: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
};

export function CompetenciaList({
  competencias,
  selectedId,
  loading,
  refreshing,
  onSelect,
  onRefresh,
}: CompetenciaListProps) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="size-4 text-muted-foreground" aria-hidden="true" />
            Competências
          </CardTitle>
          <CardDescription>Selecione o período fiscal que será conferido.</CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading || refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden="true" />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <CompetenciaListSkeleton />
        ) : competencias.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
            <FileText className="mb-2 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Nenhuma competência preparada</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              A lista ficará disponível quando uma competência SPED for aberta pelo serviço fiscal.
            </p>
          </div>
        ) : (
          <>
            <div className="md:hidden">
              <label htmlFor="sped-competencia" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Competência fiscal
              </label>
              <Select value={selectedId ?? undefined} onValueChange={onSelect}>
                <SelectTrigger id="sped-competencia" className="w-full">
                  <SelectValue placeholder="Selecione uma competência" />
                </SelectTrigger>
                <SelectContent>
                  {competencias.map((competencia) => (
                    <SelectItem key={competencia.id} value={competencia.id}>
                      {formatCompetencia(competencia.competencia)} · {competencia.status.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden overflow-hidden rounded-lg border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Documentos</TableHead>
                    <TableHead className="text-right">Bloqueios</TableHead>
                    <TableHead className="text-right">Arquivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {competencias.map((competencia) => {
                    const selected = competencia.id === selectedId;
                    return (
                      <TableRow key={competencia.id} data-state={selected ? "selected" : undefined}>
                        <TableCell>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 font-semibold"
                            aria-pressed={selected}
                            onClick={() => onSelect(competencia.id)}
                          >
                            {formatCompetencia(competencia.competencia)}
                          </Button>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Leiaute {competencia.layout} · {competencia.finalidade === "RETIFICADORA" ? "Retificadora" : "Original"}
                          </p>
                        </TableCell>
                        <TableCell><CompetenciaStatusBadge status={competencia.status} /></TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInteger(competencia.contagens.total)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            "inline-flex items-center gap-1 tabular-nums",
                            competencia.diagnosticos.bloqueios > 0 && "font-medium text-destructive",
                          )}>
                            {competencia.diagnosticos.bloqueios > 0 ? <ShieldAlert className="size-3.5" aria-hidden="true" /> : null}
                            {formatInteger(competencia.diagnosticos.bloqueios)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {competencia.arquivoDisponivel ? "TXT disponível" : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CompetenciaListSkeleton() {
  return (
    <div className="space-y-2" aria-label="Carregando competências" aria-busy="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[1fr_8rem_5rem] items-center gap-4 rounded-lg border p-3">
          <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-36" /></div>
          <Skeleton className="h-6 w-28" />
          <Skeleton className="ml-auto h-4 w-10" />
        </div>
      ))}
    </div>
  );
}
