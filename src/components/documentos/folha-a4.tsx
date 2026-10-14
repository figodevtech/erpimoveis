"use client";

import { forwardRef, useEffect, useRef, useState } from "react";

import { ALTURA_MINIMA_FRAME_PX, FolhaDocumento, LARGURA_FRAME_PX, type FolhaDocumentoHandle } from "./folha-documento";

export type ZoomFolha = "ajustar" | "real";

type Props = {
  html: string;
  titulo: string;
  /** "ajustar" reduz a folha para caber na largura; "real" mantém 100%. */
  zoom?: ZoomFolha;
};

/**
 * As folhas sempre com a largura de um A4 (794px), reduzidas na tela quando
 * não cabem. A escala é só visual: o frame continua medindo A4, então as quebras de
 * linha e de tabela são as mesmas da impressão — que sai do próprio frame, em
 * tamanho real.
 */
export const FolhaA4 = forwardRef<FolhaDocumentoHandle, Props>(function FolhaA4({ html, titulo, zoom = "ajustar" }, ref) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  const [altura, setAltura] = useState(ALTURA_MINIMA_FRAME_PX);

  useEffect(() => {
    const elemento = caixa.current;
    if (!elemento) return;
    const observador = new ResizeObserver(([entrada]) => setLargura(entrada.contentRect.width));
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  const escala = zoom === "real" || largura === 0 ? 1 : Math.min(1, Math.max(0.3, largura / LARGURA_FRAME_PX));

  return (
    <div ref={caixa} className="w-full">
      <div className="mx-auto" style={{ width: LARGURA_FRAME_PX * escala, height: altura * escala }}>
        {/* As folhas (papel, sombra e espaço entre elas) são desenhadas dentro do frame. */}
        <div className="origin-top-left" style={{ width: LARGURA_FRAME_PX, transform: `scale(${escala})` }}>
          <FolhaDocumento ref={ref} html={html} titulo={titulo} onAltura={setAltura} />
        </div>
      </div>
    </div>
  );
});
