/**
 * Voltar para a aba dispara `visibilitychange` e `focus` quase juntos (e
 * `online`, ao recuperar a rede). Cada tela que ouvia os dois fazia a mesma
 * busca duas vezes. `onAppResume` entrega um unico aviso por retorno.
 */
const JANELA_DO_MESMO_RETORNO_MS = 1_000;

type ResumeTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type ResumeDocument = ResumeTarget & { visibilityState: DocumentVisibilityState };

export function onAppResume(
  handler: () => void,
  {
    includeOnline = false,
    target = window,
    doc = document,
    now = Date.now,
  }: {
    includeOnline?: boolean;
    target?: ResumeTarget;
    doc?: ResumeDocument;
    now?: () => number;
  } = {},
): () => void {
  let ultimoAviso = Number.NEGATIVE_INFINITY;

  const avisar = () => {
    if (doc.visibilityState !== "visible") return;
    const agora = now();
    if (agora - ultimoAviso < JANELA_DO_MESMO_RETORNO_MS) return;
    ultimoAviso = agora;
    handler();
  };

  target.addEventListener("focus", avisar);
  doc.addEventListener("visibilitychange", avisar);
  if (includeOnline) target.addEventListener("online", avisar);

  return () => {
    target.removeEventListener("focus", avisar);
    doc.removeEventListener("visibilitychange", avisar);
    if (includeOnline) target.removeEventListener("online", avisar);
  };
}
