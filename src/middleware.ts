// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth-edge";
import { expandPermissions, normalizePermission, PERMS, permissionSetHas, type Permission } from "@/app/api/_authz/permission-constants";
import { getDefaultRouteForPerms } from "@/app/api/_authz/default-route";
import { permissionForAction } from "@/app/api/_authz/action-permission";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
// REMOVED GLOBAL CLIENT TO AVOID STATE LEAKAGE

type FreshUserState = { available: boolean; user: { ativo?: boolean } | null };
const USER_STATE_CACHE_TTL_MS = 15_000;
const freshUserStateCache = new Map<string, { expiresAt: number; value: FreshUserState }>();
let lastUserVerificationWarningAt = 0;

const PUBLIC_PATHS = [
  "/login",
  "/recuperar-senha",
  "/os",
  "/venda",
  "/verificar/checklist",
  "/assinar/checklist",
  // NextAuth
  "/api/auth",
];

// âœ… APIs pÃºblicas (adicione aqui as que podem sem login)
const PUBLIC_API_PREFIXES = [
  "/api/auth/check-email",
  "/api/auth/send-recovery",
  // ex: "/api/public",

  "/api/ordens/aprovacao",
  "/api/venda/aprovacao",
  "/api/verificar/checklist",
  "/api/assinar/checklist",
  "/api/site/agendamentos",
  // Chamadas servidor-servidor. Cada rota aplica sua propria validacao.
  "/api/integracoes/mercadolivre/cron",
  "/api/integracoes/mercadolivre/webhook",
  "/api/integracoes/shopee/cron",
  "/api/integracoes/telegram/webhook",
  "/api/integracoes/telegram/processar",
  "/api/integracoes/telegram/financeiro/processar",
];

function isStaticAsset(pathname: string) {
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/images")
  ) {
    return true;
  }
  return /\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|json|webmanifest)$/.test(
    pathname,
  );
}

function isPublicPath(pathname: string) {
  if (isStaticAsset(pathname)) return true;
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function isPublicApi(pathname: string) {
  if (!pathname.startsWith("/api")) return false;
  if (pathname.startsWith("/api/auth")) return true; // NextAuth sempre pÃºblico
  if (pathname === "/api/webhooks/focus") return true;
  return PUBLIC_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/**
 * Regras por prefixo -> permissÃ£o necessÃ¡ria
 */
const ROUTE_PERMS: Array<{ prefix: string; perm: Permission }> = [
  { prefix: "/api/central-operacional", perm: PERMS.ACOMPANHAMENTO },
  { prefix: "/api/execucao", perm: PERMS.EXECUCAO_OS },
  { prefix: "/api/dashboard", perm: PERMS.DASHBOARD },
  { prefix: "/api/customers", perm: PERMS.CLIENTES },
  { prefix: "/api/clientes", perm: PERMS.CLIENTES },
  { prefix: "/api/ordens", perm: PERMS.ORDENS },
  { prefix: "/api/checklist-documentos", perm: PERMS.ORDENS },
  { prefix: "/api/orcamentos", perm: PERMS.ORCAMENTOS },
  { prefix: "/api/agendamentos", perm: PERMS.AGENDAMENTOS },
  { prefix: "/api/products", perm: PERMS.ESTOQUE },
  { prefix: "/api/entradas", perm: PERMS.ESTOQUE },
  { prefix: "/api/usoconsumo", perm: PERMS.USOCONSUMO },
  { prefix: "/api/veiculos", perm: PERMS.VEICULOS },
  { prefix: "/api/venda", perm: PERMS.VENDAS },
  { prefix: "/api/transaction", perm: PERMS.FINANCEIRO },
  { prefix: "/api/dre", perm: PERMS.FINANCEIRO },
  { prefix: "/api/pagamentos", perm: PERMS.FINANCEIRO },
  { prefix: "/api/banks", perm: PERMS.FINANCEIRO },
  { prefix: "/api/fiscal", perm: PERMS.FINANCEIRO_NOTAS_FISCAIS },
  { prefix: "/api/nfe", perm: PERMS.FINANCEIRO_NOTAS_FISCAIS },
  { prefix: "/api/nfce", perm: PERMS.FINANCEIRO_NOTAS_FISCAIS },
  { prefix: "/api/nfse", perm: PERMS.FINANCEIRO_NOTAS_FISCAIS },
  { prefix: "/api/empresa", perm: PERMS.CONFIG },
  { prefix: "/api/users", perm: PERMS.USUARIOS },
  { prefix: "/api/perfis", perm: PERMS.PERMISSOES },
  { prefix: "/api/config", perm: PERMS.CONFIG },
  { prefix: "/api/auditoria", perm: PERMS.CONFIG },

  { prefix: "/execucao", perm: PERMS.EXECUCAO_OS },
  { prefix: "/dashboard", perm: PERMS.DASHBOARD },
  { prefix: "/clientes", perm: PERMS.CLIENTES },
  { prefix: "/ordens", perm: PERMS.ORDENS },
  { prefix: "/print/checklist", perm: PERMS.ORDENS },
  { prefix: "/orcamentos", perm: PERMS.ORCAMENTOS },
  { prefix: "/print/orcamento", perm: PERMS.ORCAMENTOS },
  { prefix: "/print/produto", perm: PERMS.ESTOQUE },
  { prefix: "/agendamentos", perm: PERMS.AGENDAMENTOS },
  { prefix: "/estoque/uso-consumo", perm: PERMS.USOCONSUMO },
  // Os dois estoques simples usam as mesmas permissoes usoconsumo:*.
  { prefix: "/estoque/geral", perm: PERMS.USOCONSUMO },
  { prefix: "/estoque/movimentacao", perm: PERMS.USOCONSUMO },
  { prefix: "/estoque/historico", perm: PERMS.USOCONSUMO },
  { prefix: "/estoque", perm: PERMS.ESTOQUE },
  { prefix: "/usoconsumo", perm: PERMS.USOCONSUMO },
  { prefix: "/relatorios", perm: PERMS.RELATORIOS },

  { prefix: "/configuracoes/perfis", perm: PERMS.PERMISSOES },
  { prefix: "/configuracoes", perm: PERMS.CONFIG },
  { prefix: "/usuarios", perm: PERMS.USUARIOS },
  { prefix: "/acompanhamento", perm: PERMS.ACOMPANHAMENTO },
  { prefix: "/central-operacional", perm: PERMS.ACOMPANHAMENTO },

  { prefix: "/dre", perm: PERMS.FINANCEIRO },
  { prefix: "/fluxodecaixa", perm: PERMS.FINANCEIRO },
  { prefix: "/pagamentodeordens", perm: PERMS.FINANCEIRO },
  { prefix: "/pagamentodevendas", perm: PERMS.FINANCEIRO },
  { prefix: "/eventos-financeiros", perm: PERMS.FINANCEIRO },
  { prefix: "/fiscal", perm: PERMS.FINANCEIRO_NOTAS_FISCAIS },

  { prefix: "/historicovendas", perm: PERMS.VENDAS },
  { prefix: "/pdv", perm: PERMS.VENDAS },
  { prefix: "/vendas", perm: PERMS.VENDAS },

  { prefix: "/acompanhamento", perm: PERMS.ACOMPANHAMENTO },

  { prefix: "/veiculos", perm: PERMS.VEICULOS },
];

const ROUTE_ANY_PERMS: Array<{ prefix: string; perms: Permission[] }> = [
  { prefix: "/movimentacao", perms: [PERMS.ESTOQUE, PERMS.USOCONSUMO] },
  {
    prefix: "/api/etiquetas",
    perms: [
      PERMS.ESTOQUE, PERMS.ESTOQUE_CRIAR, PERMS.ESTOQUE_EDITAR,
      PERMS.USOCONSUMO, PERMS.USOCONSUMO_CRIAR, PERMS.USOCONSUMO_EDITAR,
    ],
  },
  { prefix: "/etiquetas", perms: [PERMS.ESTOQUE, PERMS.USOCONSUMO] },
  { prefix: "/print/etiquetas", perms: [PERMS.ESTOQUE, PERMS.USOCONSUMO] },
];

const API_ACTION_PERMS: Array<{
  prefix: string;
  read: Permission;
  create?: Permission;
  edit?: Permission;
  delete?: Permission;
}> = [
  { prefix: "/api/customers", read: PERMS.CLIENTES, create: PERMS.CLIENTES_CRIAR, edit: PERMS.CLIENTES_EDITAR, delete: PERMS.CLIENTES_EXCLUIR },
  { prefix: "/api/clientes", read: PERMS.CLIENTES, create: PERMS.CLIENTES_CRIAR, edit: PERMS.CLIENTES_EDITAR, delete: PERMS.CLIENTES_EXCLUIR },
  { prefix: "/api/ordens", read: PERMS.ORDENS, create: PERMS.ORDENS_CRIAR, edit: PERMS.ORDENS_EDITAR, delete: PERMS.ORDENS_EXCLUIR },
  { prefix: "/api/orcamentos", read: PERMS.ORCAMENTOS, create: PERMS.ORCAMENTOS_CRIAR, edit: PERMS.ORCAMENTOS_EDITAR, delete: PERMS.ORCAMENTOS_EXCLUIR },
  { prefix: "/api/agendamentos", read: PERMS.AGENDAMENTOS, create: PERMS.AGENDAMENTOS_CRIAR, edit: PERMS.AGENDAMENTOS_EDITAR, delete: PERMS.AGENDAMENTOS_EXCLUIR },
  { prefix: "/api/products", read: PERMS.ESTOQUE, create: PERMS.ESTOQUE_CRIAR, edit: PERMS.ESTOQUE_EDITAR, delete: PERMS.ESTOQUE_EXCLUIR },
  { prefix: "/api/entradas", read: PERMS.ESTOQUE, create: PERMS.ESTOQUE_CRIAR, edit: PERMS.ESTOQUE_EDITAR, delete: PERMS.ESTOQUE_EXCLUIR },
  { prefix: "/api/usoconsumo", read: PERMS.USOCONSUMO },
  { prefix: "/api/veiculos", read: PERMS.VEICULOS, create: PERMS.VEICULOS_CRIAR, edit: PERMS.VEICULOS_EDITAR, delete: PERMS.VEICULOS_EXCLUIR },
  { prefix: "/api/venda", read: PERMS.VENDAS, create: PERMS.VENDAS_CRIAR, edit: PERMS.VENDAS_EDITAR, delete: PERMS.VENDAS_EXCLUIR },
  { prefix: "/api/transaction", read: PERMS.FINANCEIRO, create: PERMS.FINANCEIRO_CRIAR, edit: PERMS.FINANCEIRO_EDITAR, delete: PERMS.FINANCEIRO_EXCLUIR },
  // A lista global de eventos financeiros de OS. As mesmas ações do painel da
  // ordem, mas sob permissão do financeiro: quem lança o pagamento no caixa não
  // precisa de acesso de edição à ordem inteira para corrigir uma despesa.
  { prefix: "/api/eventos-financeiros", read: PERMS.FINANCEIRO, create: PERMS.FINANCEIRO_CRIAR, edit: PERMS.FINANCEIRO_EDITAR, delete: PERMS.FINANCEIRO_EXCLUIR },
  { prefix: "/api/pagamentos", read: PERMS.FINANCEIRO, create: PERMS.FINANCEIRO_CRIAR, edit: PERMS.FINANCEIRO_EDITAR, delete: PERMS.FINANCEIRO_EXCLUIR },
  { prefix: "/api/banks", read: PERMS.FINANCEIRO, create: PERMS.FINANCEIRO_CRIAR, edit: PERMS.FINANCEIRO_EDITAR, delete: PERMS.FINANCEIRO_EXCLUIR },
  { prefix: "/api/users", read: PERMS.USUARIOS, create: PERMS.USUARIOS_CRIAR, edit: PERMS.USUARIOS_EDITAR, delete: PERMS.USUARIOS_EXCLUIR },
  { prefix: "/api/perfis", read: PERMS.PERMISSOES, create: PERMS.PERMISSOES_CRIAR, edit: PERMS.PERMISSOES_EDITAR, delete: PERMS.PERMISSOES_EXCLUIR },
  { prefix: "/api/config", read: PERMS.CONFIG, edit: PERMS.CONFIG_EDITAR },
  { prefix: "/api/empresa", read: PERMS.CONFIG, create: PERMS.CONFIG_EDITAR, edit: PERMS.CONFIG_EDITAR, delete: PERMS.CONFIG_EDITAR },
];

const API_MUTATION_PERMS: Array<{ prefix: string; perm: Permission }> = [
  // As listas auxiliares abastecem formulários de várias áreas e continuam
  // legíveis para usuários logados. Somente a configuração pode alterá-las.
  { prefix: "/api/tipos", perm: PERMS.CONFIG_EDITAR },
  { prefix: "/api/checklist-modelos", perm: PERMS.CONFIG_EDITAR },
];

function matchRule(pathname: string) {
  return ROUTE_PERMS.find(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"),
  );
}

function matchAnyRule(pathname: string) {
  return ROUTE_ANY_PERMS.find(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"),
  );
}

function matchApiActionRule(pathname: string, method: string) {
  const rule = API_ACTION_PERMS.find(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"),
  );
  if (!rule) return null;

  return permissionForAction(pathname, method, rule);
}

function matchApiMutationRule(pathname: string, method: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return null;
  if (/^\/api\/checklist-modelos\/[^/]+\/aplicar$/.test(pathname)) {
    return PERMS.ORDENS_EDITAR;
  }
  return API_MUTATION_PERMS.find(
    (rule) => pathname === rule.prefix || pathname.startsWith(rule.prefix + "/"),
  )?.perm ?? null;
}

function hasPermFromSession(user: any, perm: string) {
  return permissionSetHas(user?.permissoes, perm);
}

function getSessionPerms(user: any) {
  return expandPermissions(user?.permissoes);
}

function isExecutorOnly(user: any) {
  const perms = getSessionPerms(user);
  if (!perms.includes(normalizePermission(PERMS.EXECUCAO_OS))) return false;

  // Ver outros perfis so muda o que aparece em /meu-perfil, que o executor ja
  // acessa: nao pode tira-lo da tela de execucao.
  const mantemModoExecutor = [PERMS.EXECUCAO_OS, PERMS.USUARIOS_VER_PERFIS].map((p) => normalizePermission(p));
  const appPerms = Object.values(PERMS).map((p) => normalizePermission(p));
  return perms.every((p) => mantemModoExecutor.includes(p) || !appPerms.includes(p));
}

async function fetchFreshUserState(userId: string) {
  if (!supabaseUrl || !serviceKey) return { available: false as const, user: null };

  const cached = freshUserStateCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL(`${supabaseUrl}/rest/v1/usuario`);
  url.searchParams.set("id", `eq.${userId}`);
  url.searchParams.set("select", "ativo");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.error("[Middleware] Erro ao buscar usuario:", res.status, await res.text().catch(() => ""));
    return { available: false as const, user: null };
  }

  const rows = await res.json().catch(() => []);
  const value = {
    available: true as const,
    user: Array.isArray(rows) ? rows[0] ?? null : null,
  };
  freshUserStateCache.set(userId, { value, expiresAt: Date.now() + USER_STATE_CACHE_TTL_MS });
  if (freshUserStateCache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of freshUserStateCache) {
      if (entry.expiresAt <= now) freshUserStateCache.delete(key);
    }
  }
  return value;
}

function warnUserVerificationUnavailable(error: unknown) {
  const now = Date.now();
  if (now - lastUserVerificationWarningAt < 60_000) return;
  lastUserVerificationWarningAt = now;
  const name = error instanceof Error ? error.name : "Erro";
  const message = name === "TimeoutError"
    ? "Supabase não respondeu em 5 segundos; usando temporariamente o estado da sessão."
    : error instanceof Error ? error.message : String(error);
  console.warn(`[Middleware] Verificação temporariamente indisponível: ${message}`);
}

async function fetchPlatformAccess() {
  const url = process.env.PLATFORM_API_URL?.trim().replace(/\/$/, "");
  const installationId = process.env.PLATFORM_INSTALLATION_ID?.trim();
  const secret = process.env.PLATFORM_API_SECRET?.trim();
  if (!url || !installationId || !secret) return null;

  try {
    const response = await fetch(`${url}/api/v1/subscription`, {
      cache: "no-store",
      headers: { "X-Installation-Id": installationId, Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return typeof payload?.access?.allowed === "boolean" ? payload.access.allowed : null;
  } catch {
    // Falha aberta: indisponibilidade da Central nunca deve parar a oficina.
    return null;
  }
}

export default auth(async (req: NextRequest & { auth?: any }) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // ignora assets
  if (isStaticAsset(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api");

  // Rotas públicas não dependem da consulta adicional ao Supabase. Isso evita
  // que uma oscilação do banco interrompa login, sessão e recuperação.
  if (isApi && isPublicApi(pathname)) return NextResponse.next();
  if (!isApi && isPublicPath(pathname)) {
    const response = NextResponse.next();
    if (pathname === "/assinar/checklist" || pathname.startsWith("/assinar/checklist/")) {
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      response.headers.set("X-Frame-Options", "DENY");
    }
    return response;
  }

  const session = req.auth;
  const user = session?.user;

  const isLoggedIn = !!user;

  // VariÃ¡veis locais para decisÃ£o (evita mutar o objeto user da sessÃ£o original se possÃ­vel)
  let isInactive = false;
  let userVerificationUnavailable = false;

  // Se tiver usuÃ¡rio, pega o ID e consulta dados frescos
  const userId = (user as any)?.id as string | undefined;

  // Inicializa com o que veio do token (fallback)
  if (isLoggedIn) {
    isInactive = (user as any).ativo === false;
  }

  if (userId) {
    try {
      const result = await fetchFreshUserState(userId);
      if (!result.available) {
        userVerificationUnavailable = true;
      } else if (result.user) {
        // Atualiza as variÃ¡veis locais com a verdade do banco
        isInactive = result.user.ativo === false;
      } else {
        // Sessão aponta para um usuário que já não existe na aplicação.
        isInactive = true;
      }
    } catch (err) {
      warnUserVerificationUnavailable(err);
      userVerificationUnavailable = true;
    }
  }

  // âŒ nÃ£o logado
  if (!isLoggedIn) {
    if (isApi) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const url = new URL("/login", nextUrl);
    url.searchParams.set("callbackUrl", pathname + nextUrl.search);
    return NextResponse.redirect(url);
  }

  // âŒ inativo
  if (isInactive) {
    if (isApi) {
      return NextResponse.json({ error: "INACTIVE_USER" }, { status: 403 });
    }

    const url = new URL("/login", nextUrl);
    url.searchParams.set("reason", "inactive");
    return NextResponse.redirect(url);
  }

  const isBillingPath = pathname === "/plano" || pathname.startsWith("/plano/");
  const isBillingApi = pathname === "/api/plano" || pathname.startsWith("/api/plano/");
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
  if (isApi && isMutation && !isBillingApi && !pathname.startsWith("/api/auth")) {
    const platformAllowed = await fetchPlatformAccess();
    if (platformAllowed === false) {
      return NextResponse.json({ error: "SUBSCRIPTION_BLOCKED" }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }
  if (!isApi) {
    const platformAllowed = await fetchPlatformAccess();
    if (platformAllowed === false && !isBillingPath) {
      return NextResponse.redirect(new URL("/plano", nextUrl), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (isBillingPath) {
      return NextResponse.next({ headers: { "Cache-Control": "no-store" } });
    }
  }

  const executorOnly = isExecutorOnly(user);
  if (executorOnly) {
    const allowedExecutorPath =
      pathname === "/execucao" ||
      pathname.startsWith("/execucao/") ||
      pathname.startsWith("/api/execucao") ||
      // O chat e uma funcionalidade global para todo usuario autenticado e
      // ativo, inclusive quem possui apenas acesso a execucao de OS.
      pathname.startsWith("/api/chat") ||
      pathname.startsWith("/api/tipos/setores") ||
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/config") ||
      // Central Pessoal: so devolve dados do proprio usuario, e o executor e
      // justamente quem mais tem servicos realizados para consultar.
      pathname === "/meu-perfil" ||
      pathname.startsWith("/meu-perfil/") ||
      pathname === "/preferencias" ||
      pathname.startsWith("/preferencias/") ||
      pathname === "/api/me" ||
      pathname.startsWith("/api/me/") ||
      pathname === "/nao-autorizado";

    if (!allowedExecutorPath) {
      if (isApi) {
        return NextResponse.json(
          { error: "FORBIDDEN" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }

      return NextResponse.redirect(new URL("/execucao", nextUrl), {
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  const apiActionPerm = isApi ? matchApiActionRule(pathname, req.method) : null;
  if (
    pathname === "/api/config" &&
    ["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())
  ) {
    return NextResponse.next({ headers: { "Cache-Control": "no-store" } });
  }

  if (apiActionPerm) {
    const ok = hasPermFromSession(user, apiActionPerm);
    if (!ok) {
      return NextResponse.json(
        { error: "FORBIDDEN" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (userVerificationUnavailable) {
    // A sessão JWT continua autenticada e carrega permissões assinadas. Durante
    // uma falha transitória, leituras e navegação permanecem disponíveis, mas
    // nenhuma escrita é autorizada sem confirmar o estado atual do usuário.
    if (isApi && isMutation) {
      return NextResponse.json(
        { error: "USER_VERIFICATION_UNAVAILABLE" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const apiMutationPerm = isApi ? matchApiMutationRule(pathname, req.method) : null;
  if (apiMutationPerm && !hasPermFromSession(user, apiMutationPerm)) {
    return NextResponse.json(
      { error: "FORBIDDEN" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  // âœ… autorizaÃ§Ã£o por permissÃ£o (rotas)
  const rule = matchRule(pathname);
  if (rule) {
    const ok = hasPermFromSession(user, rule.perm);
    if (!ok) {
      if (isApi) {
        return NextResponse.json(
          { error: "FORBIDDEN" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }

      const fallbackPath = getDefaultRouteForPerms((user as any)?.permissoes);
      const targetPath = fallbackPath !== pathname ? fallbackPath : "/nao-autorizado";

      return NextResponse.redirect(new URL(targetPath, nextUrl), {
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  const anyRule = matchAnyRule(pathname);
  if (anyRule) {
    const ok = anyRule.perms.some((perm) => hasPermFromSession(user, perm));
    if (!ok) {
      if (isApi) {
        return NextResponse.json(
          { error: "FORBIDDEN" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }

      const fallbackPath = getDefaultRouteForPerms((user as any)?.permissoes);
      const targetPath = fallbackPath !== pathname ? fallbackPath : "/nao-autorizado";
      return NextResponse.redirect(new URL(targetPath, nextUrl), {
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  return NextResponse.next({ headers: { "Cache-Control": "no-store" } });
});

export const config = {
  // âœ… Protege TUDO (inclusive /api), exceto assets do Next
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images).*)"],
};
