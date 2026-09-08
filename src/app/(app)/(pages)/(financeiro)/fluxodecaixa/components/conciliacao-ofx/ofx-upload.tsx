"use client";

import { useRef, useState } from "react";
import { FileText, FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Banco } from "../../types";

export function OfxUpload({
  arquivo,
  onArquivo,
  bancoId,
  onBanco,
  bancos,
  carregandoBancos,
  analisando,
  onAnalisar,
}: {
  arquivo: File | null;
  onArquivo: (arquivo: File) => void;
  bancoId: string;
  onBanco: (id: string) => void;
  bancos: Banco[];
  carregandoBancos: boolean;
  analisando: boolean;
  onAnalisar: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  function escolher(files: FileList | null) {
    if (analisando || !files?.length) return;
    const file = files[0];
    if (files.length !== 1) {
      setErro("Selecione um extrato por vez.");
      return;
    }
    if (!/\.ofx$/i.test(file.name)) {
      setErro("Selecione um arquivo com extensão .ofx.");
      return;
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setErro("O arquivo deve ter conteúdo e no máximo 5 MB.");
      return;
    }
    setErro(null);
    onArquivo(file);
  }
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 py-4">
      <div>
        <h3 className="text-base font-semibold">Importar extrato bancário</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Comece pelo arquivo OFX exportado pelo seu banco.
        </p>
      </div>
      <div
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${arrastando ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!analisando) setArrastando(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setArrastando(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          escolher(e.dataTransfer.files);
        }}
      >
        {arquivo ? (
          <FileText
            className="mx-auto mb-3 size-8 text-primary"
            aria-hidden="true"
          />
        ) : (
          <Upload
            className="mx-auto mb-3 size-8 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <p className="break-all font-medium">
          {arquivo?.name ?? "Arraste seu arquivo OFX aqui"}
        </p>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          {arquivo
            ? `${(arquivo.size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB · Pronto para análise`
            : "Ou selecione o arquivo no computador"}
        </p>
        <Button
          variant="outline"
          disabled={analisando}
          onClick={() => input.current?.click()}
        >
          {arquivo ? "Trocar arquivo" : "Selecionar arquivo"}
        </Button>
        <Input
          ref={input}
          id="ofx-arquivo"
          aria-label="Arquivo OFX"
          type="file"
          accept=".ofx"
          className="sr-only"
          disabled={analisando}
          onChange={(e) => {
            escolher(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Formato .ofx · Até 5 MB
        </p>
      </div>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="ofx-conta">Conta bancária no ERP</Label>
        <Select
          value={bancoId || "auto"}
          onValueChange={(id) => onBanco(id === "auto" ? "" : id)}
          disabled={carregandoBancos || analisando}
        >
          <SelectTrigger id="ofx-conta" className="w-full">
            <SelectValue placeholder="Identificar pelo arquivo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Identificar pelo arquivo</SelectItem>
            {bancos.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>
                {b.titulo}
                {b.contanumero ? ` · ${b.contanumero}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          A conta identificada será exibida na conferência e poderá ser
          alterada.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          disabled={!arquivo || analisando || carregandoBancos}
          onClick={onAnalisar}
        >
          {analisando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileUp className="size-4" />
          )}
          {analisando ? "Analisando extrato…" : "Analisar extrato"}
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {analisando
            ? "Lendo o arquivo e comparando com o financeiro. Aguarde."
            : "A análise não altera o financeiro. Você confere e confirma depois."}
        </p>
      </div>
    </div>
  );
}
