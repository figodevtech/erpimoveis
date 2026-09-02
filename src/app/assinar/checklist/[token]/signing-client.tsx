"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileCheck2,
  Loader2,
  LockKeyhole,
  PenLine,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CHECKLIST_QUALIDADE_LABEL,
  type ChecklistConviteStatus,
  type ChecklistSignatarioQualidade,
} from "@/lib/ordens/checklist-documento";

type PublicAsset = {
  key: string;
  sha256: string;
  mimeType: string;
  tamanhoBytes: number;
  descricao: string | null;
  registradoEm: string | null;
};

type PublicContent = {
  documento: {
    codigo: string;
    tipo: "ENTRADA" | "SAIDA";
    versao: number;
    criadoEm: string;
    snapshotHash: string;
    conteudoHash: string;
  };
  empresa: {
    nome: string;
    campos: Array<{ rotulo: string; valor: string }>;
    cores: { primaria: string; secundaria: string; texto: string };
    logo: PublicAsset | null;
  };
  ordemServico: {
    numero: number;
    campos: Array<{ rotulo: string; valor: string }>;
    cliente: Array<{ rotulo: string; valor: string }>;
    objeto: { tipo: string; titulo: string; campos: Array<{ rotulo: string; valor: string }> };
  };
  checklist: {
    modelo: string | null;
    descricaoModelo: string | null;
    inspecionadoEm: string | null;
    responsaveis: string[];
    retiradoPor: string | null;
    observacaoDocumento: string | null;
    itens: Array<{
      titulo: string;
      descricao: string | null;
      categoria: string | null;
      ordem: number;
      resposta: string;
      observacao: string | null;
      registradoEm: string | null;
      responsavel: string | null;
      fotos: PublicAsset[];
    }>;
  };
  declaracao: string;
  assinatura: { nome: string; qualidade: string; metodo: string; assinadoEm: string } | null;
};

type Stage = "ACCESS" | "REVIEW" | "SIGN" | "DONE";

const STATUS_MESSAGE: Record<Exclude<ChecklistConviteStatus, "ATIVO">, string> = {
  EXPIRADO: "Este convite expirou. Solicite um novo link à oficina.",
  REVOGADO: "Este convite foi revogado. Solicite um novo link à oficina.",
  UTILIZADO: "Este checklist já foi assinado com este convite.",
  SUPERADO: "Existe uma versão mais recente deste checklist. Solicite um novo link à oficina.",
};

function date(value: string | null | undefined) {
  if (!value) return "Não informado";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

function statusClass(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "OK") return "bg-emerald-100 text-emerald-800";
  if (normalized === "ALERTA") return "bg-amber-100 text-amber-800";
  if (normalized === "FALHA") return "bg-red-100 text-red-800";
  return "bg-slate-200 text-slate-700";
}

function Stepper({ stage }: { stage: Stage }) {
  const current = stage === "ACCESS" ? 1 : stage === "REVIEW" ? 2 : stage === "SIGN" ? 3 : 4;
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label={`Etapa ${current} de 4`}>
      {["Identificação", "Revisão", "Assinatura", "Confirmação"].map((label, index) => (
        <li key={label} className="min-w-0">
          <div className={`h-1.5 rounded-full ${index + 1 <= current ? "bg-blue-600" : "bg-slate-200"}`} />
          <span className={`mt-1 hidden text-[11px] sm:block ${index + 1 === current ? "font-semibold text-blue-700" : "text-slate-500"}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function Fields({ fields }: { fields: Array<{ rotulo: string; valor: string }> }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-lg border bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field, index) => (
        <div className="min-w-0 bg-white p-3" key={`${field.rotulo}-${index}`}>
          <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{field.rotulo}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-slate-900">{field.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReviewDocument({ token, content }: { token: string; content: PublicContent }) {
  const assetUrl = (asset: PublicAsset) => `/api/assinar/checklist/${encodeURIComponent(token)}/ativos/${asset.key}`;
  return (
    <article
      className="overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
      style={{
        ["--brand-primary" as string]: content.empresa.cores.primaria,
        ["--brand-secondary" as string]: content.empresa.cores.secundaria,
      }}
    >
      <header className="bg-gradient-to-r from-[var(--brand-primary)] to-[var(--brand-secondary)] p-5 text-white sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {content.empresa.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="h-16 w-20 shrink-0 rounded-xl bg-white object-contain p-2" src={assetUrl(content.empresa.logo)} alt={`Logo de ${content.empresa.nome}`} />
            )}
            <div className="min-w-0">
              <h1 className="break-words text-xl font-bold sm:text-2xl">{content.empresa.nome}</h1>
              <div className="mt-1 text-xs opacity-90">{content.empresa.campos.map((field) => <div key={field.rotulo}>{field.rotulo}: {field.valor}</div>)}</div>
            </div>
          </div>
          <div className="shrink-0 rounded-xl border border-white/35 bg-white/10 px-5 py-3 text-center backdrop-blur-sm">
            <p className="text-xs font-bold uppercase tracking-widest">Checklist de {content.documento.tipo.toLowerCase()}</p>
            <p className="mt-1 text-2xl font-black">OS #{content.ordemServico.numero}</p>
            <p className="text-xs">Versão {content.documento.versao}</p>
          </div>
        </div>
      </header>
      <div className="space-y-6 p-4 sm:p-7">
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Ordem de serviço e cliente</h2>
          <Fields fields={[...content.ordemServico.campos, ...content.ordemServico.cliente]} />
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Objeto inspecionado · {content.ordemServico.objeto.tipo}</h2>
          <Fields fields={[{ rotulo: "Identificação", valor: content.ordemServico.objeto.titulo }, ...content.ordemServico.objeto.campos]} />
        </section>
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Itens e fotografias</h2>
            <p className="text-xs text-slate-500">Inspeção: {date(content.checklist.inspecionadoEm)}</p>
          </div>
          <div className="space-y-4">
            {content.checklist.itens.map((item, index) => (
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" key={`${item.ordem}-${index}`}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-slate-950">{index + 1}. {item.titulo}</h3>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(item.resposta)}`}>{item.resposta}</span>
                  </div>
                  {item.descricao && <p className="mt-2 text-sm text-slate-600">{item.descricao}</p>}
                  {item.observacao && <p className="mt-2 text-sm"><b>Observação:</b> {item.observacao}</p>}
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                    {item.categoria && <span>Categoria: {item.categoria}</span>}
                    {item.responsavel && <span>Responsável: {item.responsavel}</span>}
                    {item.registradoEm && <span>Registro: {date(item.registradoEm)}</span>}
                  </div>
                </div>
                {item.fotos.length > 0 && (
                  <div className={`grid gap-3 border-t bg-slate-50 p-3 ${item.fotos.length > 1 ? "sm:grid-cols-2" : ""}`}>
                    {item.fotos.map((photo, photoIndex) => (
                      <figure className={`min-w-0 overflow-hidden rounded-lg border bg-white ${item.fotos.length === 1 ? "mx-auto w-full max-w-2xl" : ""}`} key={photo.key}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="h-auto max-h-[520px] w-full object-contain" src={assetUrl(photo)} alt={photo.descricao || `Foto ${photoIndex + 1} do item ${item.titulo}`} loading="lazy" />
                        <figcaption className="border-t px-3 py-2 text-xs text-slate-600">
                          <b>Foto {photoIndex + 1} de {item.fotos.length}</b>{photo.descricao ? ` · ${photo.descricao}` : ""}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </section>
        {(content.checklist.observacaoDocumento || content.checklist.retiradoPor) && (
          <section className="rounded-xl border bg-slate-50 p-4 text-sm">
            {content.checklist.observacaoDocumento && <p><b>Observação:</b> {content.checklist.observacaoDocumento}</p>}
            {content.checklist.retiradoPor && <p><b>Retirado por:</b> {content.checklist.retiradoPor}</p>}
          </section>
        )}
        <section className="rounded-xl bg-slate-950 p-4 font-mono text-[11px] text-slate-300">
          <p className="break-all"><b className="font-sans text-white">Snapshot SHA-256:</b> {content.documento.snapshotHash}</p>
          <p className="mt-2 break-all"><b className="font-sans text-white">Conteúdo SHA-256:</b> {content.documento.conteudoHash}</p>
        </section>
      </div>
    </article>
  );
}

export function ChecklistOnlineSigning({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [stage, setStage] = useState<Stage>("ACCESS");
  const [status, setStatus] = useState<ChecklistConviteStatus | null>(null);
  const [content, setContent] = useState<PublicContent | null>(null);
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [quality, setQuality] = useState<ChecklistSignatarioQualidade>("CLIENTE");
  const [qualityOther, setQualityOther] = useState("");
  const [aware, setAware] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ protocolo: string; pdfPendente: boolean; pdfUrl: string | null; verificacaoUrl: string } | null>(null);

  const apiBase = `/api/assinar/checklist/${encodeURIComponent(token)}`;

  const loadContent = useCallback(async () => {
    const response = await fetch(`${apiBase}/conteudo`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o checklist.");
    setContent(payload.conteudo);
    setStatus(payload.status);
    if (payload.status === "UTILIZADO") {
      setResult({
        protocolo: payload.conteudo.documento.codigo,
        pdfPendente: !payload.pdfDisponivel,
        pdfUrl: payload.pdfDisponivel ? `${apiBase}/pdf` : null,
        verificacaoUrl: payload.verificacaoUrl,
      });
      setStage("DONE");
    } else {
      setStage("REVIEW");
    }
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(apiBase, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Convite inválido ou indisponível.");
        if (!active) return;
        setStatus(payload.status);
        if (payload.autenticado && (payload.status === "ATIVO" || payload.status === "UTILIZADO")) {
          await loadContent();
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Não foi possível abrir o convite.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [apiBase, loadContent]);

  function prepareCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#111827";
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
  }

  useEffect(() => {
    if (stage !== "SIGN") return;
    const frame = requestAnimationFrame(prepareCanvas);
    return () => cancelAnimationFrame(frame);
  }, [stage]);

  function pointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  async function authenticate() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/acesso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf, senha: password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível validar o acesso.");
      await loadContent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível validar o acesso.");
    } finally {
      setSubmitting(false);
    }
  }

  async function sign() {
    const canvas = canvasRef.current;
    if (!canvas || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/assinar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: name,
          qualidade: quality,
          qualidadeOutro: quality === "OUTRO" ? qualityOther : null,
          declaracaoCiente: aware,
          assinaturaDataUrl: canvas.toDataURL("image/png"),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 202) throw new Error(payload?.error || "Não foi possível assinar o checklist.");
      setResult(payload);
      setStatus("UTILIZADO");
      setStage("DONE");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível assinar o checklist.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (stage !== "DONE" || !result?.pdfPendente) return;
    const timer = window.setInterval(() => {
      void loadContent().catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [loadContent, result?.pdfPendente, stage]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white"><Loader2 className="h-8 w-8 animate-spin" aria-label="Carregando convite" /></main>;
  }

  const unavailable = status && status !== "ATIVO" && status !== "UTILIZADO";
  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 text-slate-950 sm:px-6 sm:py-9">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="rounded-xl bg-blue-600 p-2 text-white"><ShieldCheck className="h-6 w-6" /></span>
            <div><p className="text-xs font-bold uppercase tracking-widest text-blue-700">Ambiente de assinatura</p><h1 className="text-lg font-bold">Revisão e assinatura de checklist</h1></div>
          </div>
          <Stepper stage={stage} />
        </header>

        {(error || unavailable) && (
          <div className="flex gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error || (status && status !== "ATIVO" ? STATUS_MESSAGE[status as Exclude<ChecklistConviteStatus, "ATIVO">] : "Convite indisponível.")}</span>
          </div>
        )}

        {stage === "ACCESS" && !unavailable && status === "ATIVO" && (
          <section className="mx-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 sm:p-8">
            <LockKeyhole className="mb-4 h-10 w-10 text-blue-600" />
            <h2 className="text-xl font-bold">Confirme sua identidade</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">Informe o CPF indicado pela oficina e a senha numérica recebida em mensagem separada.</p>
            <div className="mt-6 space-y-4">
              <label className="block space-y-1.5 text-sm"><span className="font-medium">CPF do responsável</span><Input value={cpf} onChange={(event) => setCpf(event.target.value)} inputMode="numeric" autoComplete="username" placeholder="000.000.000-00" /></label>
              <label className="block space-y-1.5 text-sm"><span className="font-medium">Senha numérica</span><Input value={password} onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 8))} type="password" inputMode="numeric" autoComplete="current-password" maxLength={8} /></label>
              <Button className="w-full" onClick={() => void authenticate()} disabled={submitting || !cpf.trim() || password.length < 4}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}Acessar checklist
              </Button>
            </div>
            <p className="mt-5 text-xs leading-relaxed text-slate-500">Por segurança, as tentativas são limitadas. A senha não aparece no documento e não pode ser recuperada pela oficina.</p>
          </section>
        )}

        {stage === "ACCESS" && status === "UTILIZADO" && (
          <section className="mx-auto w-full max-w-lg rounded-2xl bg-white p-7 text-center shadow-xl ring-1 ring-slate-200">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h2 className="mt-4 text-xl font-bold">Convite já utilizado</h2>
            <p className="mt-2 text-sm text-slate-600">Este checklist já foi assinado. Use a página permanente de verificação ou solicite o documento oficial à oficina.</p>
          </section>
        )}

        {stage === "REVIEW" && content && <>
          <ReviewDocument token={token} content={content} />
          <div className="sticky bottom-3 z-20 flex justify-end rounded-xl border bg-white/95 p-3 shadow-xl backdrop-blur">
            <Button onClick={() => setStage("SIGN")}><PenLine className="mr-2 h-4 w-4" />Li o checklist e quero assinar</Button>
          </div>
        </>}

        {stage === "SIGN" && content && (
          <section className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200 sm:p-8">
            <h2 className="text-xl font-bold">Identificação e assinatura</h2>
            <p className="mt-2 text-sm text-slate-600">O CPF foi validado no acesso e está bloqueado para esta assinatura.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm"><span className="font-medium">Nome completo</span><Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
              <label className="space-y-1.5 text-sm"><span className="font-medium">Função</span><select className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={quality} onChange={(event) => setQuality(event.target.value as ChecklistSignatarioQualidade)}>{Object.entries(CHECKLIST_QUALIDADE_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              {quality === "OUTRO" && <label className="space-y-1.5 text-sm sm:col-span-2"><span className="font-medium">Descreva a função</span><Input value={qualityOther} onChange={(event) => setQualityOther(event.target.value)} /></label>}
            </div>
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between"><span className="text-sm font-medium">Assinatura desenhada</span><Button variant="ghost" size="sm" onClick={prepareCanvas}><RotateCcw className="mr-1.5 h-4 w-4" />Limpar</Button></div>
              <canvas
                ref={canvasRef}
                className="h-52 w-full touch-none rounded-lg border-2 border-slate-300 bg-white"
                onPointerDown={(event) => { const context = event.currentTarget.getContext("2d"); if (!context) return; drawingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); const current = pointer(event); context.beginPath(); context.moveTo(current.x, current.y); }}
                onPointerMove={(event) => { if (!drawingRef.current) return; const context = event.currentTarget.getContext("2d"); if (!context) return; const current = pointer(event); context.lineTo(current.x, current.y); context.stroke(); }}
                onPointerUp={() => { drawingRef.current = false; }}
                onPointerCancel={() => { drawingRef.current = false; }}
              />
            </div>
            <label className="mt-5 flex items-start gap-3 rounded-xl border bg-slate-50 p-4 text-sm leading-relaxed"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" checked={aware} onChange={(event) => setAware(event.target.checked)} /><span>{content.declaracao}</span></label>
            <p className="mt-3 text-xs text-slate-500">Método: assinatura eletrônica simples remota — link secreto, CPF e senha. Este fluxo não declara certificação ICP-Brasil.</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="outline" onClick={() => setStage("REVIEW")} disabled={submitting}><ArrowLeft className="mr-2 h-4 w-4" />Voltar à revisão</Button>
              <Button onClick={() => void sign()} disabled={submitting || !aware || name.trim().length < 3}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}Confirmar assinatura</Button>
            </div>
          </section>
        )}

        {stage === "DONE" && result && (
          <section className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-6 text-center shadow-xl ring-1 ring-slate-200 sm:p-9">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
            <h2 className="mt-4 text-2xl font-bold">Checklist assinado</h2>
            <p className="mt-2 text-sm text-slate-600">A assinatura foi vinculada ao snapshot imutável.</p>
            <div className="mx-auto mt-6 max-w-md rounded-xl bg-slate-950 p-4 text-left text-white"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Protocolo</p><p className="mt-1 break-all font-mono text-lg font-bold">{result.protocolo}</p></div>
            {result.pdfPendente ? (
              <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><Loader2 className="h-4 w-4 animate-spin" />PDF oficial em processamento. Esta página atualizará automaticamente.</div>
            ) : (
              <Button className="mt-5" asChild><a href={result.pdfUrl || `${apiBase}/pdf`} download><Download className="mr-2 h-4 w-4" />Baixar PDF oficial</a></Button>
            )}
            <div className="mt-4"><Button variant="outline" asChild><a href={result.verificacaoUrl} target="_blank" rel="noreferrer"><FileCheck2 className="mr-2 h-4 w-4" />Verificar autenticidade</a></Button></div>
            <p className="mt-6 text-xs leading-relaxed text-slate-500">Quando esta sessão terminar, o PDF continuará disponível na página permanente de verificação mediante informação do CPF completo usado na assinatura.</p>
          </section>
        )}
      </div>
    </main>
  );
}
