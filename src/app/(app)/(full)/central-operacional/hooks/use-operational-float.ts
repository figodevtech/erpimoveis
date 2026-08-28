"use client";

import * as React from "react";
import {
  animate,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";

import type { OperationalNodeModule } from "@/lib/central-operacional/contracts";

/**
 * Amplitude e faixa de duração de cada nó. A duração é de UM trecho — a viagem
 * até o próximo destino sorteado —, então uma ida e volta leva o dobro.
 */
export const OPERATIONAL_NODE_FLOAT_PROFILES: Record<OperationalNodeModule, {
  amplitudeX: number;
  amplitudeY: number;
  durationRange: readonly [number, number];
  delay: number;
}> = {
  VENDAS: { amplitudeX: 2.6, amplitudeY: 4.6, durationRange: [2.2, 6], delay: 0 },
  ORDENS: { amplitudeX: 3, amplitudeY: 5.2, durationRange: [2.6, 6.6], delay: 0.9 },
  CONTAS_RECEBER: { amplitudeX: 2.4, amplitudeY: 4.2, durationRange: [2, 5.6], delay: 1.7 },
  CONTAS_PAGAR: { amplitudeX: 2.9, amplitudeY: 5, durationRange: [2.4, 6.3], delay: 0.5 },
  FINANCEIRO: { amplitudeX: 2.7, amplitudeY: 4.8, durationRange: [2.3, 6.1], delay: 2.2 },
  FISCAL: { amplitudeX: 2.5, amplitudeY: 4.4, durationRange: [2.1, 5.8], delay: 1.3 },
};

/** Curva de seno — a mesma `sine.inOut` que o GSAP usa para flutuação. */
export const OPERATIONAL_FLOAT_EASE = [0.37, 0, 0.63, 1] as const;

/** Volta ao repouso: chegada, não corte. */
export const OPERATIONAL_FLOAT_REST = { duration: 0.5, ease: [0.33, 1, 0.68, 1] as const };

export type OperationalFloatLeg = { target: number; duration: number };

/**
 * Sorteia o próximo trecho da deriva.
 *
 * Oscilar entre dois pontos fixos é previsível por definição: por mais lento e
 * curvo que seja o caminho, o olho aprende o ritmo e vira motor. O que faz um
 * objeto parecer boiando é o destino mudar a cada chegada — nunca a mesma
 * distância, nunca o mesmo tempo.
 *
 * O destino cai sempre na metade oposta à posição atual, e nunca aquém de 35%
 * da amplitude: sorteio livre escolheria, de vez em quando, um ponto colado no
 * atual, e o nó ficaria vários segundos praticamente parado.
 */
export function nextOperationalFloatLeg(
  current: number,
  amplitude: number,
  [minDuration, maxDuration]: readonly [number, number],
  random: () => number = Math.random,
): OperationalFloatLeg {
  const direction = current > 0 ? -1 : 1;
  const magnitude = amplitude * (0.35 + random() * 0.65);

  return {
    target: direction * magnitude,
    duration: minDuration + random() * (maxDuration - minDuration),
  };
}

/**
 * Deriva contínua de um eixo. Cada eixo corre sozinho, com sorteios próprios,
 * então os dois nunca trocam de direção no mesmo instante — é o que impede a
 * composição de estacionar, já que a curva de seno zera a velocidade a cada
 * chegada.
 */
function driftAxis(
  value: MotionValue<number>,
  amplitude: number,
  durationRange: readonly [number, number],
  delay: number,
) {
  let stopped = false;
  let current: { stop: () => void } | null = null;

  const step = (legDelay: number) => {
    if (stopped) return;
    const leg = nextOperationalFloatLeg(value.get(), amplitude, durationRange);
    current = animate(value, leg.target, {
      duration: leg.duration,
      delay: legDelay,
      ease: OPERATIONAL_FLOAT_EASE,
      onComplete: () => step(0),
    });
  };

  step(delay);

  return () => {
    stopped = true;
    current?.stop();
  };
}

/**
 * Deriva do nó, entregue pronta na propriedade CSS `translate`.
 *
 * `translate` e `transform` são propriedades distintas e compõem entre si: a
 * deriva mora aqui e o `transform` fica inteiro para o Motion animar impacto,
 * escala e hover, sem que os dois disputem o mesmo valor.
 */
export function useOperationalFloat(
  module: OperationalNodeModule,
  enabled: boolean,
) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const profile = OPERATIONAL_NODE_FLOAT_PROFILES[module];

  const translate = useTransform(
    [x, y],
    ([driftX, driftY]: number[]) =>
      `calc(-50% + ${driftX}px) calc(-50% + ${driftY}px)`,
  );

  // O halo acompanha a altura em vez de pulsar no próprio ritmo: subiu, brilha
  // um pouco mais. Sai de graça e herda a irregularidade da deriva.
  const glowOpacity = useTransform(y, [-profile.amplitudeY, profile.amplitudeY], [0.3, 0.12]);
  const glowScale = useTransform(y, [-profile.amplitudeY, profile.amplitudeY], [1.05, 0.97]);

  React.useEffect(() => {
    if (!enabled) {
      const settleX = animate(x, 0, OPERATIONAL_FLOAT_REST);
      const settleY = animate(y, 0, OPERATIONAL_FLOAT_REST);
      return () => {
        settleX.stop();
        settleY.stop();
      };
    }

    const stopX = driftAxis(x, profile.amplitudeX, profile.durationRange, profile.delay);
    // Meio segundo depois do eixo X para os dois primeiros trechos já nascerem
    // fora de fase.
    const stopY = driftAxis(y, profile.amplitudeY, profile.durationRange, profile.delay + 0.5);
    return () => {
      stopX();
      stopY();
    };
  }, [enabled, profile, x, y]);

  return { translate, glowOpacity, glowScale };
}
