"use client";

import type { ChecklistTipo } from "@/lib/ordens/checklist-documento";
import type { ChecklistDocumentoProgress } from "@/lib/ordens/checklist-documentos-server";

type CreatedChecklistDocument = {
  publicId: string;
  versao: number;
};

type ChecklistDocumentStreamEvent =
  | { type: "progress"; progress: ChecklistDocumentoProgress }
  | { type: "complete"; document: CreatedChecklistDocument }
  | { type: "error"; error: string; code?: string };

export type ChecklistPreparationController = {
  update: (progress: ChecklistDocumentoProgress) => void;
  fail: (message: string) => void;
  finish: () => void;
};

const PREPARATION_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>Preparando documento...</title>
  <style>
    :root { color-scheme: light; --bg:#eff6ff; --card:#fff; --text:#0f172a; --muted:#64748b; --line:#dbe5f1; --soft:#f8fafc; --blue:#2563eb; --cyan:#0891b2; --track:#dbeafe; --shadow:0 28px 80px rgba(15,23,42,.16); }
    * { box-sizing:border-box; }
    html,body { min-height:100%; margin:0; }
    body { min-height:100vh; display:grid; place-items:center; padding:24px; overflow-x:hidden; background:radial-gradient(circle at 20% 10%,rgba(37,99,235,.15),transparent 34%),radial-gradient(circle at 85% 85%,rgba(8,145,178,.14),transparent 36%),var(--bg); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
    .card { position:relative; width:min(640px,100%); overflow:hidden; border:1px solid rgba(148,163,184,.32); border-radius:28px; background:var(--card); box-shadow:var(--shadow); text-align:center; }
    .topline { height:6px; background:linear-gradient(90deg,var(--blue),var(--cyan)); }
    .content { padding:42px 44px 36px; }
    .icon { width:72px; height:72px; margin:0 auto 20px; display:grid; place-items:center; border-radius:22px; background:linear-gradient(145deg,#2563eb,#0891b2); color:#fff; box-shadow:0 14px 30px rgba(37,99,235,.28); }
    .icon svg { width:38px; height:38px; }
    .eyebrow { margin:0 0 8px; color:var(--blue); font-size:12px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
    h1 { margin:0; font-size:clamp(27px,5vw,36px); line-height:1.12; letter-spacing:-.035em; }
    .lead { max-width:500px; margin:12px auto 28px; color:var(--muted); font-size:15px; line-height:1.6; }
    .progress-head { display:flex; align-items:end; justify-content:space-between; gap:16px; margin-bottom:9px; text-align:left; }
    .progress-head span:first-child { color:var(--muted); font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .percent { color:var(--blue); font-size:22px; font-weight:850; font-variant-numeric:tabular-nums; }
    .track { width:100%; height:12px; overflow:hidden; border-radius:999px; background:var(--track); box-shadow:inset 0 1px 2px rgba(15,23,42,.08); }
    .bar { position:relative; width:2%; height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--blue),var(--cyan)); transition:width .35s ease; }
    .bar::after { content:""; position:absolute; inset:0; background:linear-gradient(100deg,transparent 15%,rgba(255,255,255,.55) 45%,transparent 75%); transform:translateX(-100%); animation:shine 1.5s linear infinite; }
    @keyframes shine { to { transform:translateX(100%); } }
    .activity { margin-top:22px; padding:18px 20px; border:1px solid var(--line); border-radius:18px; background:var(--soft); }
    .activity-title { display:flex; align-items:center; justify-content:center; gap:9px; margin:0; font-size:16px; font-weight:800; }
    .pulse { width:9px; height:9px; flex:none; border-radius:50%; background:#10b981; box-shadow:0 0 0 0 rgba(16,185,129,.45); animation:pulse 1.6s infinite; }
    @keyframes pulse { 70% { box-shadow:0 0 0 9px rgba(16,185,129,0); } 100% { box-shadow:0 0 0 0 rgba(16,185,129,0); } }
    .detail { min-height:42px; margin:8px auto 0; color:var(--muted); font-size:14px; line-height:1.5; }
    .counter { display:none; width:max-content; margin:12px auto 0; border-radius:999px; padding:5px 10px; background:#dbeafe; color:#1d4ed8; font-size:12px; font-weight:750; }
    .steps { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:24px; }
    .step { min-width:0; color:#94a3b8; font-size:11px; font-weight:700; }
    .step-dot { width:26px; height:26px; display:grid; place-items:center; margin:0 auto 7px; border:1px solid var(--line); border-radius:50%; background:var(--card); font-size:11px; }
    .step.active { color:var(--blue); }
    .step.active .step-dot { border-color:var(--blue); box-shadow:0 0 0 4px rgba(37,99,235,.10); }
    .step.done { color:#047857; }
    .step.done .step-dot { border-color:#10b981; background:#d1fae5; color:#047857; }
    .why { margin-top:25px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:12.5px; line-height:1.55; }
    .why b { color:var(--text); }
    .elapsed { margin:13px 0 0; color:#94a3b8; font-size:11px; font-variant-numeric:tabular-nums; }
    .close { display:none; margin:20px auto 0; border:0; border-radius:12px; padding:10px 17px; background:#dc2626; color:#fff; font:inherit; font-size:13px; font-weight:750; cursor:pointer; }
    .card.error .topline,.card.error .bar { background:#dc2626; }
    .card.error .icon { background:#dc2626; box-shadow:0 14px 30px rgba(220,38,38,.22); }
    .card.error .pulse { background:#dc2626; animation:none; box-shadow:none; }
    .card.error .percent { color:#dc2626; }
    .card.error .close { display:block; }
    @media (max-width:560px) { body { padding:12px; } .card { border-radius:22px; } .content { padding:30px 20px 26px; } .steps { gap:3px; } .step { font-size:9.5px; } }
    @media (prefers-color-scheme:dark) { :root { color-scheme:dark; --bg:#08111f; --card:#0f172a; --text:#f8fafc; --muted:#a8b5c7; --line:#26364c; --soft:#111d31; --track:#1e3a5f; --shadow:0 28px 80px rgba(0,0,0,.42); } .counter { background:#172f52; color:#93c5fd; } }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
  </style>
</head>
<body>
  <main class="card" id="preparation-card">
    <div class="topline"></div>
    <div class="content">
      <div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/><path d="m9 9 1 1 2-2"/></svg></div>
      <p class="eyebrow" id="document-kind">Checklist</p>
      <h1 id="main-title">Preparando documento</h1>
      <p class="lead">Estamos criando uma versão imutável e preservando todos os dados para a impressão.</p>
      <div class="progress-head"><span>Progresso da preparação</span><span class="percent" id="progress-percent">2%</span></div>
      <div class="track" id="progress-track" role="progressbar" aria-label="Progresso da preparação" aria-valuemin="0" aria-valuemax="100" aria-valuenow="2"><div class="bar" id="progress-bar"></div></div>
      <section class="activity" aria-live="polite" aria-atomic="true">
        <p class="activity-title"><span class="pulse"></span><span id="activity-title">Iniciando a preparação</span></p>
        <p class="detail" id="activity-detail">Verificando o histórico e reservando a próxima versão.</p>
        <p class="counter" id="photo-counter"></p>
      </section>
      <div class="steps" aria-hidden="true">
        <div class="step active" data-stage="0"><span class="step-dot">1</span><span>Dados</span></div>
        <div class="step" data-stage="1"><span class="step-dot">2</span><span>Imagens</span></div>
        <div class="step" data-stage="2"><span class="step-dot">3</span><span>Versão</span></div>
        <div class="step" data-stage="3"><span class="step-dot">4</span><span>Pronto</span></div>
      </div>
      <p class="why"><b>Por que pode demorar?</b> Cada fotografia precisa ser baixada, corrigida para impressão, copiada para o armazenamento privado e conferida por hash. O tempo depende da quantidade e do tamanho das imagens e da velocidade da conexão.</p>
      <p class="elapsed" id="elapsed-time">Tempo decorrido: 0s · mantenha esta aba aberta</p>
      <button class="close" id="close-window" type="button">Fechar esta aba</button>
    </div>
  </main>
</body>
</html>`;

function node<T extends HTMLElement>(preview: Window, id: string) {
  return preview.document.getElementById(id) as T | null;
}

function preparationStage(percentual: number) {
  if (percentual >= 100) return 3;
  if (percentual >= 86) return 2;
  if (percentual >= 24) return 1;
  return 0;
}

export function prepareChecklistDocumentWindow(preview: Window, tipo: ChecklistTipo): ChecklistPreparationController {
  preview.document.open();
  preview.document.write(PREPARATION_HTML);
  preview.document.close();
  node(preview, "document-kind")!.textContent = `Checklist de ${tipo === "ENTRADA" ? "entrada" : "saída"}`;
  node<HTMLButtonElement>(preview, "close-window")?.addEventListener("click", () => preview.close());

  const startedAt = Date.now();
  let currentPercent = 2;
  const elapsedTimer = window.setInterval(() => {
    if (preview.closed) {
      window.clearInterval(elapsedTimer);
      return;
    }
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1_000));
    const elapsed = node(preview, "elapsed-time");
    if (elapsed) elapsed.textContent = `Tempo decorrido: ${seconds}s · mantenha esta aba aberta`;
  }, 1_000);

  const update = (progress: ChecklistDocumentoProgress) => {
    if (preview.closed) return;
    currentPercent = Math.max(currentPercent, Math.min(100, Math.round(progress.percentual)));
    const percent = `${currentPercent}%`;
    const percentNode = node(preview, "progress-percent");
    const bar = node(preview, "progress-bar");
    const track = node(preview, "progress-track");
    const title = node(preview, "activity-title");
    const detail = node(preview, "activity-detail");
    if (percentNode) percentNode.textContent = percent;
    if (bar) bar.style.width = percent;
    track?.setAttribute("aria-valuenow", String(currentPercent));
    if (title) title.textContent = progress.titulo;
    if (detail) detail.textContent = progress.detalhe;
    preview.document.title = `${percent} · ${progress.titulo}`;

    const counter = node(preview, "photo-counter");
    if (counter) {
      const showCounter = typeof progress.total === "number" && progress.total > 0 && typeof progress.atual === "number";
      counter.style.display = showCounter ? "block" : "none";
      counter.textContent = showCounter ? `${progress.atual} de ${progress.total} fotografias` : "";
    }

    const activeStage = preparationStage(currentPercent);
    preview.document.querySelectorAll<HTMLElement>("[data-stage]").forEach((stageNode) => {
      const stage = Number(stageNode.dataset.stage);
      stageNode.classList.toggle("active", stage === activeStage);
      stageNode.classList.toggle("done", stage < activeStage || currentPercent === 100);
      const dot = stageNode.querySelector<HTMLElement>(".step-dot");
      if (dot) dot.textContent = stage < activeStage || currentPercent === 100 ? "✓" : String(stage + 1);
    });
  };

  return {
    update,
    fail(message) {
      window.clearInterval(elapsedTimer);
      if (preview.closed) return;
      node(preview, "preparation-card")?.classList.add("error");
      const mainTitle = node(preview, "main-title");
      const title = node(preview, "activity-title");
      const detail = node(preview, "activity-detail");
      const elapsed = node(preview, "elapsed-time");
      if (mainTitle) mainTitle.textContent = "Não foi possível preparar o documento";
      if (title) title.textContent = "A preparação foi interrompida";
      if (detail) detail.textContent = message;
      if (elapsed) elapsed.textContent = "Nenhuma versão incompleta foi disponibilizada.";
      preview.document.title = "Falha ao preparar checklist";
    },
    finish() {
      window.clearInterval(elapsedTimer);
    },
  };
}

function parseEvent(line: string): ChecklistDocumentStreamEvent | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as ChecklistDocumentStreamEvent;
  } catch {
    throw new Error("O servidor retornou uma atualização de progresso inválida.");
  }
}

export async function createChecklistDocumentWithProgress(args: {
  ordemServicoId: number;
  tipo: ChecklistTipo;
  onProgress: (progress: ChecklistDocumentoProgress) => void;
}) {
  const response = await fetch("/api/checklist-documentos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({ ordemServicoId: args.ordemServicoId, tipo: args.tipo }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || "Não foi possível criar a versão do checklist.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !contentType.includes("application/x-ndjson")) {
    const payload = await response.json().catch(() => ({}));
    if (!payload?.document) throw new Error(payload?.error || "A versão foi criada sem resposta do servidor.");
    return payload as { document: CreatedChecklistDocument };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: { document: CreatedChecklistDocument } | null = null;

  const consume = (line: string) => {
    const event = parseEvent(line);
    if (!event) return;
    if (event.type === "progress") args.onProgress(event.progress);
    else if (event.type === "complete") completed = { document: event.document };
    else throw new Error(event.error || "Não foi possível criar a versão do checklist.");
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!completed) throw new Error("A preparação terminou sem confirmar a versão criada.");
  return completed;
}
