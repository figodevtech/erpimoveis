"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const LIMITE = "maximum-scale=1";
let travas = 0;

function aplicarViewport() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const partes = meta.content
    .split(",")
    .map((parte) => parte.trim())
    .filter((parte) => parte && !parte.startsWith("maximum-scale"));
  if (travas > 0) partes.push(LIMITE);
  const content = partes.join(", ");
  if (meta.content !== content) meta.content = content;
}

// A marca no html leva a trava aos dialogs e drawers que o Radix desenha fora
// do container. O CSS lê o atributo direto: um html:has(...) era reavaliado a
// cada mudança no DOM.
function marcarDocumento() {
  if (travas > 0) document.documentElement.setAttribute("data-pinch", "off");
  else document.documentElement.removeAttribute("data-pinch");
}

function bloquearGesto(event: Event) {
  event.preventDefault();
}

/**
 * Trava o zoom enquanto estiver montado. Renderize dentro do container marcado
 * com `data-pinch="off"` (o CSS do globals.css trava a pinca pelo touch-action);
 * montado, ele marca também o html.
 * - `maximum-scale=1`: o iOS deixa de ampliar ao focar campo com fonte < 16px.
 * - `gesturestart`: reforco do Safari para a pinca.
 * Ao desmontar (rotas de impressao, DANFE, paginas publicas) tudo volta.
 */
export function PinchLock() {
  const pathname = usePathname();

  useEffect(() => {
    travas += 1;
    aplicarViewport();
    marcarDocumento();
    document.addEventListener("gesturestart", bloquearGesto, { passive: false });
    return () => {
      travas -= 1;
      aplicarViewport();
      marcarDocumento();
      if (travas === 0) document.removeEventListener("gesturestart", bloquearGesto);
    };
  }, []);

  // O Next pode recriar a meta do viewport numa navegacao; reaplica a cada rota.
  useEffect(() => {
    aplicarViewport();
  }, [pathname]);

  return null;
}
