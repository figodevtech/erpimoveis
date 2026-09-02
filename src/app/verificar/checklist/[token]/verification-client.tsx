"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type VerificationData = {
  autentico: boolean;
  empresa: string;
  ordemServicoId: number;
  tipo: string;
  versao: number;
  codigo: string;
  criadoEm: string;
  assinadoEm: string | null;
  metodoAssinatura: "PRESENCIAL_DESENHADA" | "REMOTA_DESENHADA" | null;
  snapshotHash: string;
  conteudoHash: string;
  pdfHash: string | null;
  pdfDisponivel: boolean;
  possuiVersaoPosterior: boolean;
};

function date(value: string | null) {
  if (!value) return "Não registrado";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

export function ChecklistVerification({ token }: { token: string }) {
  const [data, setData] = useState<VerificationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [documentNumber, setDocumentNumber] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/verificar/checklist/${token}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Documento não encontrado.");
        if (active) setData(payload);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Falha na verificação."); });
    return () => { active = false; };
  }, [token]);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch(`/api/verificar/checklist/${token}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento: documentNumber }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Não foi possível liberar o PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${data?.codigo || "checklist"}.pdf`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível liberar o PDF.");
    } finally {
      setDownloading(false);
    }
  }

  if (!data && !error) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white"><Loader2 className="h-7 w-7 animate-spin" aria-label="Verificando" /></main>;
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <section className="w-full max-w-lg rounded-2xl bg-white p-7 text-center shadow-2xl">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-red-600" />
          <h1 className="text-xl font-bold text-slate-950">Documento não verificado</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-950">
      <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="bg-emerald-700 p-6 text-white">
          <div className="flex items-start gap-4">
            <ShieldCheck className="h-10 w-10 shrink-0" />
            <div><p className="text-sm font-semibold uppercase tracking-wider opacity-85">Verificação documental</p><h1 className="mt-1 text-2xl font-bold">{data.autentico ? "Snapshot autêntico" : "Integridade não confirmada"}</h1></div>
          </div>
        </header>
        <div className="space-y-6 p-6">
          {data.possuiVersaoPosterior && <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Existe uma versão posterior deste tipo de checklist. Esta versão continua imutável e verificável.</div>}
          <dl className="grid gap-px overflow-hidden rounded-lg border bg-slate-200 sm:grid-cols-2">
            {[
              ["Empresa", data.empresa], ["Código", data.codigo], ["Ordem de serviço", `#${data.ordemServicoId}`], ["Tipo e versão", `${data.tipo} · V${data.versao}`], ["Versão criada em", date(data.criadoEm)], ["Assinada em", date(data.assinadoEm)],
            ].map(([label, value]) => <div className="bg-white p-3" key={label}><dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>)}
          </dl>
          <div className="space-y-2 rounded-lg bg-slate-50 p-4 font-mono text-xs text-slate-600">
            <p className="break-all"><b className="font-sans text-slate-900">Snapshot SHA-256:</b><br />{data.snapshotHash}</p>
            <p className="break-all"><b className="font-sans text-slate-900">Conteúdo SHA-256:</b><br />{data.conteudoHash}</p>
            {data.pdfHash && <p className="break-all"><b className="font-sans text-slate-900">PDF oficial SHA-256:</b><br />{data.pdfHash}</p>}
          </div>
          {data.pdfDisponivel ? <div className="space-y-3 rounded-lg border p-4"><div className="flex items-center gap-2 font-semibold"><FileCheck2 className="h-5 w-5 text-emerald-700" />Baixar o PDF oficial preservado</div><p className="text-sm text-slate-600">Para proteger os dados pessoais do documento, informe o CPF/CNPJ completo usado na assinatura. As tentativas são limitadas.</p><div className="flex flex-col gap-2 sm:flex-row"><Input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} placeholder="CPF ou CNPJ completo" inputMode="numeric" /><Button onClick={() => void download()} disabled={downloading || !documentNumber.trim()}>{downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Baixar PDF</Button></div></div> : <div className="flex gap-2 rounded-lg border bg-slate-50 p-4 text-sm text-slate-600"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />O registro existe, mas o PDF oficial ainda não está disponível.</div>}
          {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <p className="text-xs leading-relaxed text-slate-500">A assinatura registrada é eletrônica simples {data.metodoAssinatura === "REMOTA_DESENHADA" ? "remota, autenticada por link secreto, CPF e senha" : "presencial"}. Esta página confirma a integridade técnica dos arquivos e não declara certificação ICP-Brasil.</p>
        </div>
      </section>
    </main>
  );
}
