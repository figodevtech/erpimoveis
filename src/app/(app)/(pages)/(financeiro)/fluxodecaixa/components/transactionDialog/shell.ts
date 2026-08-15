/**
 * Classes do "casco" do dialog de transação.
 *
 * O dialog ocupa a maior altura possível e mantém cabeçalho e rodapé fixos: só o
 * miolo rola. Isso exige altura DEFINIDA no container — com `h-auto`, o
 * `min-h-0`/`overflow-y-auto` de dentro não tem contra o que resolver, o
 * conteúdo transborda e o rodapé sai da tela.
 *
 * Mesma receita usada no dialog de Pagamento de Ordens, para os dois se
 * comportarem igual no mobile.
 */

/** Mobile: tela cheia sem cantos. Desktop: quase a altura toda, centralizado. */
export const CONTEUDO_DIALOG =
  "h-dvh w-[100svw] max-w-[100svw] min-w-0 gap-0 overflow-hidden rounded-none border-foreground/20 p-0 shadow-2xl " +
  "sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[95vw] sm:min-w-0 sm:max-w-[1100px] sm:rounded-lg";

/** `mt-0` e `max-h-none` anulam o `mt-24`/`max-h-[80vh]` que o vaul aplica. */
export const CONTEUDO_DRAWER =
  "mt-0 flex h-[100dvh] min-h-dvh max-h-none flex-col gap-0 rounded-none border-foreground/20 p-0";

/** Coluna que ocupa todo o casco: cabeçalho, miolo rolável e rodapé. */
export const COLUNA_CHEIA = "flex h-full min-h-0 min-w-0 flex-col";

/** Único trecho que rola. `min-h-0` é o que permite o encolhimento no flex. */
export const MIOLO_ROLAVEL = "min-h-0 flex-1 overflow-y-auto overflow-x-hidden";

export const CABECALHO_FIXO =
  "relative shrink-0 overflow-hidden border-b border-border bg-card px-5 py-4 pr-12 text-left " +
  "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary sm:px-6 sm:pr-14";
export const RODAPE_FIXO =
  "shrink-0 border-t border-border bg-card px-4 py-3 sm:px-6 sm:py-4";

export function classesDoConteudo(isDesktop: boolean) {
  return isDesktop ? CONTEUDO_DIALOG : CONTEUDO_DRAWER;
}
