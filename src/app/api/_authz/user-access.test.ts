import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

import * as permissionConstants from "./permission-constants";
import * as ttlCache from "@/lib/ttl-cache";

function transpile(relative: string) {
  const source = readFileSync(path.join(process.cwd(), relative), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const userAccessCode = transpile("src/app/api/_authz/user-access.ts");
const permsCode = transpile("src/app/api/_authz/perms.ts");
const chatRouteUtilsCode = transpile("src/app/api/chat/_lib/route-utils.ts");
const notificationsLibCode = transpile("src/app/api/notifications/_lib.ts");

type Usuario = {
  id: string;
  email: string;
  nome: string;
  perfilid: number | null;
  setorid: number | null;
  ativo: boolean;
  permissoes: string[];
};

function load(module: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(module, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Dependência inesperada: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

function montar(usuarios: Usuario[], sessao: { id?: string; email?: string } | null) {
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(url.pathname, "/rest/v1/usuario", `Tabela inesperada: ${url.pathname}`);
    const [coluna, filtro] = [...url.searchParams].find(([key]) => key === "id" || key === "email")!;
    const valor = filtro.replace(/^eq\./, "");
    const rows = usuarios
      .filter((usuario) => (usuario as any)[coluna] === valor)
      .map(({ permissoes, ...usuario }) => ({
        ...usuario,
        perfil: usuario.perfilid == null
          ? null
          : { perfilpermissao: permissoes.map((nome) => ({ permissao: { nome } })) },
      }));
    const querObjeto = String(new Headers(init?.headers).get("accept") ?? "").includes("vnd.pgrst.object");
    if (querObjeto) {
      return rows.length ? Response.json(rows[0]) : Response.json({ code: "PGRST116" }, { status: 406 });
    }
    return Response.json(rows);
  };
  const supabaseAdmin = createClient("https://auth.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });

  const userAccess = load(userAccessCode, {
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/lib/ttl-cache": ttlCache,
    "./permission-constants": permissionConstants,
  });
  const auth = { auth: async () => (sessao ? { user: sessao } : null) };
  const perms = load(permsCode, {
    "@/lib/auth": auth,
    "./permission-constants": permissionConstants,
    "./user-access": userAccess,
  });
  return { requests, userAccess, perms, auth, supabaseAdmin };
}

const ADMIN: Usuario = {
  id: "u-admin",
  email: "admin@oficina.test",
  nome: "Admin",
  perfilid: 1,
  setorid: 2,
  ativo: true,
  permissoes: ["ordens:visualizar", "vendas:visualizar", "estoque:visualizar"],
};

test("uma unica consulta traz usuario, perfil e permissoes — nenhuma em perfilpermissao", async () => {
  const { requests, userAccess } = montar([ADMIN], null);

  const access = await userAccess.loadUserAccess({ userId: ADMIN.id });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, "/rest/v1/usuario");
  assert.match(requests[0].searchParams.get("select") ?? "", /perfilpermissao\(permissao:permissaoid\(nome\)\)/);
  assert.equal(access.ativo, true);
  assert.equal(access.perfilId, 1);
  assert.ok(access.permissoes.includes(permissionConstants.normalizePermission(permissionConstants.PERMS.ORDENS)));
});

test("varias checagens na mesma rota fazem uma so leitura", async () => {
  const { requests, perms } = montar([ADMIN], { id: ADMIN.id, email: ADMIN.email });

  await perms.requireOSAccess();
  await perms.requireVendasAccess();
  assert.equal(await perms.hasEstoqueAccess(), true);
  await Promise.all([perms.requireOSAccess(), perms.requireVendasAccess()]);

  assert.equal(requests.length, 1);
});

test("permissao ausente continua negada com 403", async () => {
  const { perms } = montar([ADMIN], { id: ADMIN.id });

  await assert.rejects(perms.requireFinanceiroEdit(), (error: any) => error.statusCode === 403);
  assert.equal(await perms.hasFinanceiroAccess(), false);
});

test("usuario desativado nao tem permissao nenhuma, mesmo com perfil completo", async () => {
  const inativo = { ...ADMIN, id: "u-inativo", ativo: false };
  const { perms, userAccess } = montar([inativo], { id: inativo.id });

  const access = await userAccess.loadUserAccess({ userId: inativo.id });
  assert.equal(access.ativo, false);
  assert.equal(access.permissoes.length, 0);
  await assert.rejects(perms.requireOSAccess(), (error: any) => error.statusCode === 403);
  assert.equal((await perms.getUserPermissionSet()).size, 0);
});

test("sem sessao continua exigindo autenticacao", async () => {
  const { perms } = montar([ADMIN], null);
  await assert.rejects(perms.getUserPermissionSet(), /Não autenticado/);
  assert.equal(await perms.getCurrentUserAccess(), null);
});

test("sem linha pelo id, procura pelo e-mail (mesma regra de antes)", async () => {
  const { requests, userAccess } = montar([ADMIN], null);

  const access = await userAccess.loadUserAccess({ userId: "id-antigo", email: ADMIN.email });

  assert.equal(access.id, ADMIN.id);
  assert.deepEqual(requests.map((url) => [...url.searchParams.keys()].find((k) => k === "id" || k === "email")), ["id", "email"]);
});

test("fresh relê o banco e invalidate descarta a copia local", async () => {
  const { requests, userAccess } = montar([ADMIN], null);

  await userAccess.loadUserAccess({ userId: ADMIN.id });
  await userAccess.loadUserAccess({ userId: ADMIN.id }, { fresh: true });
  assert.equal(requests.length, 2);

  userAccess.invalidateUserAccess(ADMIN.id);
  await userAccess.loadUserAccess({ userId: ADMIN.id });
  assert.equal(requests.length, 3);

  userAccess.invalidateUserAccess();
  await userAccess.loadUserAccess({ userId: ADMIN.id });
  assert.equal(requests.length, 4);
});

test("erro do banco nao fica em cache", async () => {
  let falhar = true;
  const fetch: typeof globalThis.fetch = async () => {
    if (falhar) return Response.json({ message: "timeout" }, { status: 500 });
    return Response.json([{ ...ADMIN, perfil: { perfilpermissao: [] } }]);
  };
  const supabaseAdmin = createClient("https://auth.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  const userAccess = load(userAccessCode, {
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/lib/ttl-cache": ttlCache,
    "./permission-constants": permissionConstants,
  });

  await assert.rejects(userAccess.loadUserAccess({ userId: ADMIN.id }));
  falhar = false;
  assert.equal((await userAccess.loadUserAccess({ userId: ADMIN.id })).id, ADMIN.id);
});

test("chat e notificacoes bloqueiam usuario desativado com INACTIVE_USER", async () => {
  const inativo = { ...ADMIN, id: "u-inativo", ativo: false };
  const { userAccess, auth } = montar([inativo, ADMIN], { id: inativo.id });
  const nextServer = { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
  const zod = { ZodError: class extends Error {} };

  const chat = load(chatRouteUtilsCode, {
    "next/server": nextServer,
    zod,
    "@/app/api/_authz/user-access": userAccess,
    "@/lib/auth": auth,
  });
  await assert.rejects(chat.requireActiveChatUser(), (error: any) => error.code === "INACTIVE_USER" && error.status === 403);

  const notifications = load(notificationsLibCode, {
    "next/server": nextServer,
    "@/app/api/_authz/user-access": userAccess,
    "@/lib/auth": auth,
  });
  await assert.rejects(notifications.requireNotificationUser(), (error: any) => error.statusCode === 403);
});

test("chat libera usuario ativo reaproveitando a mesma leitura", async () => {
  const { userAccess, requests } = montar([ADMIN], null);
  const auth = { auth: async () => ({ user: { id: ADMIN.id } }) };
  const chat = load(chatRouteUtilsCode, {
    "next/server": { NextResponse: { json: Response.json } },
    zod: { ZodError: class extends Error {} },
    "@/app/api/_authz/user-access": userAccess,
    "@/lib/auth": auth,
  });

  await chat.requireActiveChatUser();
  await chat.requireActiveChatUser();

  assert.equal(requests.length, 1);
});
