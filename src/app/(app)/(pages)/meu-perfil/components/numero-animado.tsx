// src/app/(app)/(pages)/meu-perfil/components/numero-animado.tsx
"use client";

import { useEffect, useState } from "react";
import { useReducedMotion, useSpring } from "motion/react";

type Props = {
  valor: number;
  /** Precisa ser estavel entre renders (funcao de modulo, nao inline). */
  formatar: (valor: number) => string;
  className?: string;
};

/**
 * Conta ate o valor em vez de troca-lo de uma vez. Num painel pessoal isso e o
 * que da a sensacao de "o numero foi calculado agora" quando o periodo muda.
 *
 * O texto renderizado e sempre o valor final quando o usuario pede menos
 * movimento — a contagem e enfeite, o numero e informacao.
 */
export function NumeroAnimado({ valor, formatar, className }: Props) {
  const reduzirMovimento = useReducedMotion();
  const mola = useSpring(0, { stiffness: 110, damping: 26, mass: 0.6 });
  const [exibido, setExibido] = useState(() => formatar(0));

  useEffect(() => {
    // MotionValue e um sistema externo: `jump` posiciona sem animar.
    if (reduzirMovimento) mola.jump(valor);
    else mola.set(valor);
  }, [mola, reduzirMovimento, valor]);

  useEffect(() => mola.on("change", (atual) => setExibido(formatar(atual))), [formatar, mola]);

  return (
    <span className={className} suppressHydrationWarning>
      {exibido}
    </span>
  );
}
