import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup() {
  const effects: Array<() => void | (() => void)> = [];
  const listeners = new Map<string, Set<() => void>>();
  const intervals = new Map<number, () => void>();
  let now = 0, nextTimer = 0;
  const add = (event: string, callback: () => void) => { const set = listeners.get(event) ?? new Set(); set.add(callback); listeners.set(event, set); };
  const remove = (event: string, callback: () => void) => { listeners.get(event)?.delete(callback); };
  const doc = { visibilityState: "visible", addEventListener: add, removeEventListener: remove };
  const context = {
    exports: {} as { useRealtimeTabelas: (tables: string[], callback: () => void) => void },
    require: (name: string) => {
      if (name === "react") return { useRef: (value: unknown) => ({ current: value }), useEffect: (effect: typeof effects[number]) => effects.push(effect) };
      throw new Error(`módulo inesperado: ${name}`);
    },
    Date: { now: () => now }, document: doc,
    window: {
      addEventListener: add, removeEventListener: remove,
      setInterval: (callback: () => void) => { intervals.set(++nextTimer, callback); return nextTimer; },
      clearInterval: (timer: number) => { intervals.delete(timer); },
    },
  };
  const source = readFileSync(new URL("./use-realtime-tabelas.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return {
    mount: (tables: string[], callback: () => void) => { context.exports.useRealtimeTabelas(tables, callback); const cleanups = effects.splice(0).map(effect => effect()); return () => cleanups.forEach(cleanup => cleanup?.()); },
    event: (event: string) => listeners.get(event)?.forEach(callback => callback()),
    tick: () => intervals.forEach(callback => callback()),
    at: (time: number) => { now = time; },
    hidden: () => { doc.visibilityState = "hidden"; },
    visible: () => { doc.visibilityState = "visible"; },
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
    intervalCount: () => intervals.size,
  };
}

test("voltar o foco atualiza só depois do intervalo mínimo", () => {
  const h = setup(); let changes = 0;
  const cleanup = h.mount(["transacao"], () => changes++);
  h.at(5_000); h.event("focus");
  assert.equal(changes, 0);
  h.at(15_000); h.event("focus");
  assert.equal(changes, 1);
  cleanup();
});

test("a reconciliação periódica não atualiza aba oculta", () => {
  const h = setup(); let changes = 0;
  const cleanup = h.mount(["venda"], () => changes++);
  h.hidden(); h.at(60_000); h.tick();
  assert.equal(changes, 0);
  h.visible(); h.event("visibilitychange");
  assert.equal(changes, 1);
  cleanup();
});

test("desmontar remove intervalo e ouvintes; sem tabelas nada é ligado", () => {
  const h = setup();
  const cleanup = h.mount(["transacao"], () => undefined);
  assert.equal(h.intervalCount(), 1);
  cleanup();
  assert.equal(h.intervalCount(), 0);
  assert.equal(h.listenerCount(), 0);
  h.mount([], () => undefined);
  assert.equal(h.intervalCount(), 0);
});
