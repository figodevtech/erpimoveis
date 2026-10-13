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

function bloquearGesto(event: Event) {
  event.preventDefault();
}

/**
 * Trava o zoom enquanto estiver montado. Renderize dentro do container marcado
 * com `data-pinch="off"` (o CSS do globals.css trava a pinca pelo touch-action).
 * - `maximum-scale=1`: o iOS deixa de ampliar ao focar campo com fonte < 16px.
 * - `gesturestart`: reforco do Safari para a pinca.
 * Ao desmontar (rotas de impressao, DANFE, paginas publicas) tudo volta.
 */
export function PinchLock() {
  const pathname = usePathname();

  useEffect(() => {
    travas += 1;
    aplicarViewport();
    document.addEventListener("gesturestart", bloquearGesto, { passive: false });
    return () => {
      travas -= 1;
      aplicarViewport();
      if (travas === 0) document.removeEventListener("gesturestart", bloquearGesto);
    };
  }, []);

  // O Next pode recriar a meta do viewport numa navegacao; reaplica a cada rota.
  useEffect(() => {
    aplicarViewport();
  }, [pathname]);

  return null;
}
