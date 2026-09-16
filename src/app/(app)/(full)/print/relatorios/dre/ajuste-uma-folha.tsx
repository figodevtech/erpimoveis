"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Abaixo disso a linha fica pequena demais para ler no papel (cerca de 7px sobre
 * os 9,4px normais): melhor ir para a segunda folha.
 */
const DENSIDADE_MINIMA = 0.74;
const PASSO = 0.02;

/**
 * Mantém a DRE numa folha só.
 *
 * O layout já cabe numa folha com o modelo padrão. Se ainda assim o conteúdo
 * transbordar — nome de conta que quebra linha, modelo com mais linhas —, a
 * fonte e o respiro das linhas diminuem em passos pequenos até caber, pela
 * variável `--dre-densidade`.
 *
 * Roda em layout effect, antes do `PrintA4Paginator` medir: a variável fica no
 * estilo da folha de origem, e as folhas que ele clona herdam o mesmo valor. Se
 * nem na densidade mínima couber, o paginador divide em folhas como antes, sem
 * cortar nada.
 */
export function AjusteUmaFolha() {
  const marcador = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const folha = marcador.current
      ?.closest("[data-print-pagination-root]")
      ?.querySelector<HTMLElement>("[data-print-pagination-source]");
    const conteudo = folha?.querySelector<HTMLElement>(":scope > .conteudo");
    if (!folha || !conteudo) return;

    const transborda = () => conteudo.scrollHeight > conteudo.clientHeight + 1;

    let densidade = 1;
    folha.style.setProperty("--dre-densidade", "1");
    while (transborda() && densidade > DENSIDADE_MINIMA) {
      densidade = Math.max(DENSIDADE_MINIMA, Number((densidade - PASSO).toFixed(2)));
      folha.style.setProperty("--dre-densidade", String(densidade));
    }
  }, []);

  return <span ref={marcador} hidden aria-hidden="true" />;
}
