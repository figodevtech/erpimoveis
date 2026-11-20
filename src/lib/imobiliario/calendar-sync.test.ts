import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { channelConfigSchema } from "./channel-config";
import { parseOccupancyCalendar } from "./ical-import";

function load(fetcher: typeof fetch) {
  const applied: unknown[] = [], errors: unknown[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      if (name === "imob_claim_calendario") return { data: { canal: "AIRBNB", calendario_url: "https://www.airbnb.com/calendar/ical/test.ics?s=private" } };
      applied.push(args); return { data: { eventos: 1, conflitos: 0 } };
    },
    from: () => { const query = { update: (value: unknown) => { errors.push(value); return query; }, eq: () => query, then: (resolve: (value: unknown) => void) => resolve({ error: null }) }; return query; },
  };
  const loaded = { exports: {} as any };
  const source = ts.transpileModule(readFileSync("src/lib/imobiliario/calendar-sync.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(source, { exports: loaded.exports, fetch: fetcher, AbortSignal, TextDecoder, Date, URL,
    require(name: string) {
      if (name === "server-only") return {};
      if (name === "node:crypto") return { randomUUID };
      if (name === "./server") return { db };
      if (name === "./channel-config") return { channelConfigSchema };
      if (name === "./ical-import") return { parseOccupancyCalendar };
      throw new Error(name);
    }, TypeError, Error,
  });
  return { ...loaded.exports, applied, errors };
}
test("download restrito a hosts oficiais, sem redirecionar tokens", async () => {
  let options: RequestInit | undefined, calls = 0;
  const api = load((async (_url, init) => { calls++; options = init; return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"); }) as typeof fetch);
  await api.downloadCalendar("https://www.airbnb.com/calendar/ical/test.ics", "AIRBNB");
  assert.equal(options?.redirect, "manual"); assert.equal(options?.cache, "no-store");
  await assert.rejects(api.downloadCalendar("https://localhost/private", "AIRBNB"));
  assert.equal(calls, 1);
});
test("segue redirecionamento regional apenas para calendários oficiais do mesmo canal", async () => {
  const calls: string[] = [];
  const api = load((async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://www.airbnb.com/calendar/ical/123.ics?t=example-token" } })
      : new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n");
  }) as typeof fetch);
  await api.downloadCalendar("https://www.airbnb.com.br/calendar/ical/123.ics?t=example-token", "AIRBNB");
  assert.equal(calls.length, 2);
  for (const location of ["https://evil.test/calendar.ics", "http://www.airbnb.com/calendar/ical/123.ics", "https://www.airbnb.com/login", "https://ical.booking.com/v1/export?t=x"]) {
    let count = 0;
    const invalid = load((async () => { count++; return new Response(null, { status: 302, headers: { location } }); }) as typeof fetch);
    await assert.rejects(invalid.downloadCalendar("https://www.airbnb.com.br/calendar/ical/123.ics", "AIRBNB"));
    assert.equal(count, 1);
  }
  let count = 0;
  const loop = load((async () => { count++; return new Response(null, { status: 302, headers: { location: "/calendar/ical/123.ics" } }); }) as typeof fetch);
  await assert.rejects(loop.downloadCalendar("https://www.airbnb.com.br/calendar/ical/123.ics", "AIRBNB"));
  assert.equal(count, 4);
});
test("falha HTTP, HTML e corpo excessivo não aplicam snapshot nem apagam ocupações", async () => {
  for (const response of [() => new Response("unavailable", { status: 503 }), () => new Response("<html>Login</html>"), () => new Response("x".repeat(2_000_001))]) {
    const api = load((async () => response()) as typeof fetch);
    const result = await api.syncCalendar(1);
    assert.equal(result.status, "ERRO"); assert.equal(api.applied.length, 0); assert.equal(api.errors.length, 1);
    assert.ok(!JSON.stringify(api.errors).includes("private"));
  }
});
test("snapshot válido e vazio chega atomicamente ao reconciliador para cancelar eventos removidos", async () => {
  const api = load((async () => new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n")) as typeof fetch);
  assert.equal((await api.syncCalendar(1)).status, "OK");
  assert.equal(api.applied.length, 1);
  assert.equal(JSON.stringify((api.applied[0] as any).p_eventos), "[]");
});
