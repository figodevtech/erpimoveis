import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

import * as sharedLookup from "@/lib/shared-lookup";

const source = readFileSync(path.join(process.cwd(), "src/app/api/notifications/route.ts"), "utf8");
const routeCode = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadRoute(reconcile: () => Promise<number>) {
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    const head = String(init?.method ?? "GET").toUpperCase() === "HEAD";
    return head
      ? new Response(null, { status: 200, headers: { "content-range": "0-0/0" } })
      : Response.json([]);
  };
  const supabaseAdmin = createClient("https://notificacoes.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/lib/integrations/mercadolivre-system-notification-reconciliation": {
      reconcileMercadoLivreSystemNotifications: reconcile,
    },
    "@/lib/shared-lookup": sharedLookup,
    "./_lib": {
      requireNotificationUser: async () => ({ userId: "u1" }),
      notificationJson: (data: unknown, status = 200) => Response.json(data, { status }),
      notificationErrorResponse: (_scope: string, error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
    },
  };
  runInNewContext(routeCode, {
    exports,
    URL,
    require: (name: string) => {
      assert.ok(name in dependencies, `Dependência inesperada: ${name}`);
      return dependencies[name];
    },
  });
  return { GET: exports.GET!, requests };
}

test("reconciliacao do Mercado Livre roda uma vez por intervalo, nao a cada leitura", async () => {
  let execucoes = 0;
  const { GET } = loadRoute(async () => { execucoes += 1; return 0; });

  await Promise.all([
    GET(new Request("https://app.test/api/notifications?limit=50")),
    GET(new Request("https://app.test/api/notifications?limit=50")),
  ]);
  const terceira = await GET(new Request("https://app.test/api/notifications?limit=50"));

  assert.equal(execucoes, 1);
  assert.equal(terceira.status, 200);
});

test("falha na reconciliacao nao bloqueia a central e a proxima leitura tenta de novo", async () => {
  let execucoes = 0;
  const { GET } = loadRoute(async () => {
    execucoes += 1;
    if (execucoes === 1) throw new Error("mercado livre fora");
    return 0;
  });
  const erroOriginal = console.error;
  console.error = () => undefined;

  try {
    const primeira = await GET(new Request("https://app.test/api/notifications"));
    assert.equal(primeira.status, 200);
    await GET(new Request("https://app.test/api/notifications"));
  } finally {
    console.error = erroOriginal;
  }

  assert.equal(execucoes, 2);
});
