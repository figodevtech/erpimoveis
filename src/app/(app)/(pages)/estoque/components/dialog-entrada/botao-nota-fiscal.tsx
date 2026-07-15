"use client";

import { UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { NF } from "./types";


interface BotaoNotaFiscalProps {
  setParsed: (parsed: NF | null) => void;
    file: File | undefined;
    setFile: (file: File | undefined) => void;

}

export default function BotaoNotaFiscal({ setParsed, file, setFile }: BotaoNotaFiscalProps) {
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileChange() {
    if (!file) return;

    setParsed(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/entradas/nf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Erro ao processar a nota");
      } else {
        setParsed(data.parsed);
      }
    } catch {
      toast.error("Erro inesperado ao enviar o arquivo");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (file) {
      handleFileChange();
    }

    if(file === undefined) {
      if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    }
  }, [file]);

 

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted">
          <UploadCloud className="h-4 w-4" />
          {loading ? "Processando..." : "Adicionar NF"}
          <input
            ref={fileInputRef}
            disabled={loading}
            type="file"
            accept=".xml"
            className="hidden"
            multiple={false}
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (!selected) return;
              setFile(selected);
            }}
          />
        </label>

       
      </div>
    </div>
  );
}
