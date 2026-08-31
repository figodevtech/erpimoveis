"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  aumentarFonteImpressao,
  diminuirFonteImpressao,
  lerEscalaFonteImpressao,
  percentualFonteImpressao,
  PRINT_DEFAULT_FONT_SCALE,
  PRINT_FONT_SCALE_ATTRIBUTE,
  PRINT_FONT_SCALE_PROPERTY,
  PRINT_FONT_SCALE_STORAGE_KEY,
  PRINT_MAX_FONT_SCALE,
  type PrintFontScale,
} from "@/lib/print/fontScale";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";

export function PrintFontSizeControl() {
  const [fontScale, setFontScale] = useState<PrintFontScale>(PRINT_DEFAULT_FONT_SCALE);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

  useEffect(() => {
    try {
      const savedScale = lerEscalaFonteImpressao(
        window.localStorage.getItem(PRINT_FONT_SCALE_STORAGE_KEY),
      );
      if (savedScale !== null) setFontScale(savedScale);
    } catch {
      // O navegador pode bloquear o armazenamento; a impressão continua em 100%.
    } finally {
      setPreferenceLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!preferenceLoaded) return;

    const root = document.documentElement;
    root.style.setProperty(PRINT_FONT_SCALE_PROPERTY, String(fontScale));
    root.setAttribute(PRINT_FONT_SCALE_ATTRIBUTE, String(fontScale));

    try {
      window.localStorage.setItem(PRINT_FONT_SCALE_STORAGE_KEY, String(fontScale));
    } catch {
      // A alteração segue válida nesta tela mesmo sem armazenamento persistente.
    }
  }, [fontScale, preferenceLoaded]);

  useEffect(() => {
    return () => {
      const root = document.documentElement;
      root.style.removeProperty(PRINT_FONT_SCALE_PROPERTY);
      root.removeAttribute(PRINT_FONT_SCALE_ATTRIBUTE);
    };
  }, []);

  return (
    <div
      aria-label="Tamanho do texto da impressão"
      className="print:hidden flex items-center gap-1"
      role="group"
    >
      <Button
        aria-label="Diminuir texto da impressão"
        className={`min-w-9 px-2 font-bold ${PRINT_ACTION_BUTTON_CLASS}`}
        disabled={fontScale === PRINT_DEFAULT_FONT_SCALE}
        onClick={() => setFontScale((current) => diminuirFonteImpressao(current))}
        size="sm"
        title="Diminuir texto"
        type="button"
        variant="outline"
      >
        <span aria-hidden="true">A−</span>
      </Button>
      <span
        aria-live="polite"
        className="min-w-[72px] text-center text-xs font-semibold text-slate-700"
      >
        Texto {percentualFonteImpressao(fontScale)}%
      </span>
      <Button
        aria-label="Aumentar texto da impressão"
        className={`min-w-9 px-2 font-bold ${PRINT_ACTION_BUTTON_CLASS}`}
        disabled={fontScale === PRINT_MAX_FONT_SCALE}
        onClick={() => setFontScale((current) => aumentarFonteImpressao(current))}
        size="sm"
        title={fontScale === PRINT_MAX_FONT_SCALE ? "Tamanho máximo atingido" : "Aumentar texto"}
        type="button"
        variant="outline"
      >
        <span aria-hidden="true">A+</span>
      </Button>
    </div>
  );
}
