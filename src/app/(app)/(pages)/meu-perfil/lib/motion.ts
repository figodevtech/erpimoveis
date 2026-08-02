// src/app/(app)/(pages)/meu-perfil/lib/motion.ts
import type { Transition, Variants } from "motion/react";

/**
 * Tokens de movimento da Central Pessoal.
 *
 * Tudo na tela usa estas molas, e nao duracoes avulsas: a coerencia entre os
 * elementos e o que faz a interface parecer um sistema, e nao um conjunto de
 * animacoes soltas. Acessibilidade fica a cargo do `<MotionConfig
 * reducedMotion="user">` na raiz da pagina — quem pede menos movimento no SO
 * recebe apenas as transicoes de opacidade.
 */

/** Resposta rapida para elementos que o usuario acabou de acionar. */
export const MOLA: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };

/** Mais macia, para superficies grandes (cartoes, blocos que expandem). */
export const MOLA_SUAVE: Transition = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 };

/** Saidas sao sempre mais rapidas que entradas: sumir nao precisa de enfase. */
export const SAIDA: Transition = { duration: 0.16, ease: [0.4, 0, 1, 1] };

/** Container que escalona a entrada dos filhos. */
export const containerEscalonado: Variants = {
  oculto: {},
  visivel: {
    transition: { staggerChildren: 0.055, delayChildren: 0.04 },
  },
};

/** Entrada padrao: sobe e materializa. */
export const itemQueSobe: Variants = {
  oculto: { opacity: 0, y: 14 },
  visivel: { opacity: 1, y: 0, transition: MOLA_SUAVE },
};

/** Entrada de linhas de tabela — deslocamento menor, cadencia mais curta. */
export const containerDeLinhas: Variants = {
  oculto: {},
  visivel: { transition: { staggerChildren: 0.028 } },
};

export const linha: Variants = {
  oculto: { opacity: 0, y: 6 },
  visivel: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] } },
};

/** Troca de aba: entra pelo lado de onde veio. */
export const painelDeAba: Variants = {
  oculto: (direcao: number) => ({ opacity: 0, x: direcao * 24 }),
  visivel: { opacity: 1, x: 0, transition: MOLA_SUAVE },
  saindo: (direcao: number) => ({ opacity: 0, x: direcao * -24, transition: SAIDA }),
};
