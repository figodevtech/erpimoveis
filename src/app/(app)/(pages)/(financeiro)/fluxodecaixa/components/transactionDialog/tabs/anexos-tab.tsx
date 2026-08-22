"use client";

import { type ChangeEvent, useRef } from "react";
import { ExternalLink, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { TransacaoAnexo } from "../use-transacao-anexos";
import { Cartao, EstadoVazio, fmtDateTime } from "./shared";

function fmtFileSize(value?: number | null) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type AnexosTabProps = {
  anexos: TransacaoAnexo[];
  carregando: boolean;
  enviando: boolean;
  excluindoId: number | null;
  erro: string | null;
  maxAnexos: number;
  editavel: boolean;
  onCarregar: () => void;
  onAdicionar: (file: File) => Promise<boolean>;
  onExcluir: (anexoId: number) => Promise<boolean>;
};

export function AnexosTab({
  anexos,
  carregando,
  enviando,
  excluindoId,
  erro,
  maxAnexos,
  editavel,
  onCarregar,
  onAdicionar,
  onExcluir,
}: AnexosTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const limiteAtingido = anexos.length >= maxAnexos;

  const selecionarArquivo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Permite escolher de novo o mesmo arquivo depois de uma falha.
    event.target.value = "";
    if (file) await onAdicionar(file);
  };

  return (
    <div className="space-y-4">
      <Cartao
        titulo="Anexos da transação"
        icone={<Paperclip className="h-4 w-4 text-primary" aria-hidden />}
        acao={<Badge variant="outline">{anexos.length}/{maxAnexos}</Badge>}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p>Adicione comprovantes, documentos ou imagens relacionados a este lançamento.</p>
            {editavel ? (
              <p className="font-medium text-amber-700 dark:text-amber-400">
                Anexos são salvos imediatamente e não são desfeitos pelo botão Cancelar.
              </p>
            ) : null}
          </div>

          {editavel ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(event) => void selecionarArquivo(event)}
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0 gap-2 rounded-none"
                disabled={enviando || carregando || limiteAtingido}
                onClick={() => fileInputRef.current?.click()}
              >
                {enviando ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden />
                )}
                {enviando ? "Enviando..." : limiteAtingido ? "Limite atingido" : "Adicionar anexo"}
              </Button>
            </>
          ) : null}
        </div>
      </Cartao>

      <Cartao titulo="Arquivos" icone={<FileText className="h-4 w-4 text-primary" aria-hidden />}>
        {carregando ? (
          <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando anexos...
          </div>
        ) : erro ? (
          <EstadoVazio>
            <div className="space-y-3">
              <p>{erro}</p>
              <Button type="button" variant="outline" className="rounded-none" onClick={onCarregar}>
                Tentar novamente
              </Button>
            </div>
          </EstadoVazio>
        ) : anexos.length === 0 ? (
          <EstadoVazio>Nenhum anexo adicionado nesta transação.</EstadoVazio>
        ) : (
          <div className="divide-y border border-border">
            {anexos.map((anexo) => {
              const isImage = anexo.tipo.startsWith("image/");
              const excluindo = excluindoId === anexo.id;
              return (
                <div
                  key={anexo.id}
                  className="flex min-w-0 flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center"
                >
                  <a
                    href={anexo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-3 outline-none focus:ring-2 focus:ring-primary"
                    title={anexo.nome}
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border bg-muted/40">
                      {isImage ? (
                        <span
                          aria-label={anexo.nome}
                          role="img"
                          className="block h-full w-full bg-cover bg-center"
                          style={{ backgroundImage: `url(${anexo.url})` }}
                        />
                      ) : (
                        <FileText className="h-5 w-5 text-primary" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{anexo.nome}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[fmtFileSize(anexo.tamanho), fmtDateTime(anexo.created_at)]
                          .filter(Boolean)
                          .join(" • ")}
                      </span>
                      {anexo.descricao ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {anexo.descricao}
                        </span>
                      ) : null}
                    </span>
                  </a>

                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                    <Button variant="outline" size="sm" asChild className="gap-2 rounded-none">
                      <a href={anexo.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        Abrir
                      </a>
                    </Button>
                    {editavel ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Remover anexo"
                        aria-label={`Remover ${anexo.nome}`}
                        disabled={excluindoId != null}
                        onClick={() => void onExcluir(anexo.id)}
                      >
                        {excluindo ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Cartao>
    </div>
  );
}
