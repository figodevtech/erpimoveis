"use client";

import { useLayoutEffect } from "react";

const ATRIBUTO = "data-ui-scale";
// Roda no parse do HTML, antes da primeira pintura: a folha já nasce em 100%.
const MARCAR_NO_CARREGAMENTO = `document.documentElement.setAttribute("${ATRIBUTO}","off")`;
let marcas = 0;

/**
 * Tira a tela da escala global da interface (ver --app-ui-scale em
 * globals.css) enquanto estiver montada: documentos em mm, como as impressões
 * e a DANFE, não podem encolher junto com o resto do app.
 *
 * A marca vai direto no html. O CSS lia `html:has([data-ui-scale="off"])`, e
 * o navegador reavaliava esse seletor a cada mudança no DOM: paginar um
 * relatório de milhares de linhas levava ~20s só em recálculo de estilo.
 * - No carregamento, o script marca antes da primeira pintura.
 * - Numa navegação dentro do app, o efeito marca e desmarca ao sair.
 */
export function UiScaleOff() {
  useLayoutEffect(() => {
    const html = document.documentElement;
    marcas += 1;
    html.setAttribute(ATRIBUTO, "off");
    return () => {
      marcas -= 1;
      if (marcas === 0) html.removeAttribute(ATRIBUTO);
    };
  }, []);

  return <script dangerouslySetInnerHTML={{ __html: MARCAR_NO_CARREGAMENTO }} />;
}
