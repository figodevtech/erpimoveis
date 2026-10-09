import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup() {
  const effects: Array<() => void | (() => void)> = [];
  const subscriptions = new Set<(table?: string) => void>();
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Map<number, () => void>();
  let now = 0, nextTimer = 0;
  const add = (event: string, callback: () => void) => { const set = listeners.get(event) ?? new Set(); set.add(callback); listeners.set(event, set); };
  const remove = (event: string, callback: () => void) => { listeners.get(event)?.delete(callback); };
  const doc = { visibilityState: "visible", addEventListener: add, removeEventListener: remove };
  const context = {
    exports: {} as { useRealtimeTabelas: (tables: string[], callback: () => void) => void },
    require: (name: string) => {
      if (name === "react") return { useRef: (value: unknown) => ({ current: value }), useEffect: (effect: typeof effects[number]) => effects.push(effect) };
      if (name.includes("use-session-ready")) return { useSessionReady: () => ({ ready: true, userId: "user" }) };
      if (name.includes("realtime-contracts")) return { ORDENS_REALTIME_TABLES: ["ordemservico", "osservico", "osservico_realizador"] };
      return { subscribeOrdensRealtime: (_user: string, callback: (table?: string) => void) => { subscriptions.add(callback); return () => { subscriptions.delete(callback); }; } };
    },
    Date: { now: () => now }, document: doc,
    window: { addEventListener: add, removeEventListener: remove, setInterval: () => 1, clearInterval: () => undefined },
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (timer: number) => { timers.delete(timer); },
  };
  const source = readFileSync(new URL("./use-realtime-tabelas.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return {
    mount: (tables: string[], callback: () => void) => { context.exports.useRealtimeTabelas(tables, callback); const cleanups = effects.splice(0).map(effect => effect()); return () => cleanups.forEach(cleanup => cleanup?.()); },
    emit: (table?: string) => subscriptions.forEach(callback => callback(table)),
    event: (event: string) => listeners.get(event)?.forEach(callback => callback()),
    flush: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
    hidden: () => { doc.visibilityState = "hidden"; },
    visible: (time: number) => { doc.visibilityState = "visible"; now = time; },
    subscriptionCount: () => subscriptions.size,
  };
}

test("os:refresh atualiza imediatamente lista e contadores", () => {
  const h = setup(); let list = 0, counters = 0;
  const cleanupList = h.mount(["ordemservico"], () => list++);
  const cleanupCounters = h.mount(["ordemservico"], () => counters++);
  h.event("os:refresh");
  assert.equal(list, 1); assert.equal(counters, 1);
  cleanupList(); cleanupCounters();
  assert.equal(h.subscriptionCount(), 0);
});

test("eventos recebidos em aba oculta são reconciliados mesmo antes de 15 segundos", () => {
  const h = setup(); let changes = 0;
  const cleanup = h.mount(["ordemservico"], () => changes++);
  h.hidden(); h.emit("ordemservico"); h.flush();
  assert.equal(changes, 0);
  h.visible(5000); h.event("visibilitychange");
  assert.equal(changes, 1); cleanup();
});

test("agrupa rajadas sem descartar a mudança seguinte e ignora tabelas não acompanhadas", () => {
  const h = setup(); let changes = 0;
  const cleanup = h.mount(["ordemservico"], () => changes++);
  h.emit("osservico"); h.flush(); assert.equal(changes, 0);
  h.emit("ordemservico"); h.emit("ordemservico"); h.flush(); assert.equal(changes, 1);
  h.emit("ordemservico"); h.flush(); assert.equal(changes, 2);
  cleanup();
});
