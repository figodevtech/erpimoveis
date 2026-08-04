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
  "h-dvh w-[100svw] max-w-[100svw] min-w-0 overflow-hidden rounded-none p-0 " +
  "sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[95vw] sm:min-w-0 sm:max-w-[1100px] sm:rounded-2xl";

/** `mt-0` e `max-h-none` anulam o `mt-24`/`max-h-[80vh]` que o vaul aplica. */
export const CONTEUDO_DRAWER =
  "mt-0 flex h-[100dvh] min-h-dvh max-h-none flex-col rounded-none p-0";

/** Coluna que ocupa todo o casco: cabeçalho, miolo rolável e rodapé. */
export const COLUNA_CHEIA = "flex h-full min-h-0 min-w-0 flex-col";

/** Único trecho que rola. `min-h-0` é o que permite o encolhimento no flex. */
export const MIOLO_ROLAVEL = "min-h-0 flex-1 overflow-y-auto overflow-x-hidden";

export const CABECALHO_FIXO = "shrink-0 border-b px-6 py-4";
export const RODAPE_FIXO = "shrink-0 border-t bg-background px-6 py-4";

export function classesDoConteudo(isDesktop: boolean) {
  return isDesktop ? CONTEUDO_DIALOG : CONTEUDO_DRAWER;
}
