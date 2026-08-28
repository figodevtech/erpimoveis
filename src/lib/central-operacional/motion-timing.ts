export const OPERATIONAL_FLOW_TRAVEL_MS = 1_250;
export const OPERATIONAL_NODE_IMPACT_DELAY_MS = 1_080;
export const OPERATIONAL_NODE_FEED_DURATION_MS = 720;
export const OPERATIONAL_VISUAL_EVENT_DURATION_MS = 2_050;

/**
 * Expansão de um card do feed.
 *
 * Mola, e não duração fixa: o card cresce de uma altura medida até preencher a
 * lista, e uma mola macia sustenta esse percurso melhor que uma curva de tempo,
 * que precisaria ser reajustada conforme a distância. Mesmos parâmetros da
 * `MOLA_SUAVE` que a Central Pessoal já usa em blocos que expandem.
 */
export const OPERATIONAL_EXPANSION_SPRING = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 0.9,
} as const;

/** Sair não precisa de ênfase: o fechamento é sempre mais rápido que a abertura. */
export const OPERATIONAL_EXPANSION_EXIT = {
  duration: 0.18,
  ease: [0.4, 0, 1, 1],
} as const;
