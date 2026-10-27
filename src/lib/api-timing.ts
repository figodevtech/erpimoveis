import { NextResponse } from "next/server";

/** Tempos de fases, sem parametros/dados; disponiveis apenas no desenvolvimento. */
export function createApiTiming() {
  const enabled = process.env.NODE_ENV === "development";
  const started = performance.now();
  const phases: string[] = [];
  return {
    async measure<T>(name: string, run: () => PromiseLike<T>): Promise<T> {
      const start = performance.now();
      try { return await run(); }
      finally {
        if (enabled) phases.push(`${name};dur=${(performance.now() - start).toFixed(1)}`);
      }
    },
    json(body: unknown, init?: ResponseInit) {
      const response = NextResponse.json(body, init);
      if (enabled) response.headers.set("Server-Timing", [...phases, `handler;dur=${(performance.now() - started).toFixed(1)}`].join(", "));
      return response;
    },
  };
}
