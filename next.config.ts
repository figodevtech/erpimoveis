import type { NextConfig } from "next";
import type { Asset, Compilation } from "webpack";
// O pacote fornece default e runtimeCaching no mesmo namespace CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextPWA = require("@ducanh2912/next-pwa");

type RuntimeCachingRule = {
  urlPattern: unknown;
  handler: string;
  options?: { cacheName?: string };
};

type RouteMatch = {
  url: URL;
  request: Request;
  sameOrigin: boolean;
};

// O service worker existe somente em producao: `next dev` desliga o PWA. As
// regras padrao do workbox interceptam todo GET de outra origem, e radio e
// playlist sao streams continuos que nao sobrevivem a Cache Storage. Sem estas
// duas trocas, o audio funciona em desenvolvimento e falha em producao.
const runtimeCaching = (nextPWA.runtimeCaching as RuntimeCachingRule[]).map((rule) => {
  // Audio da propria aplicacao continua em cache; stream de emissora, nunca.
  if (rule.options?.cacheName === "static-audio-assets") {
    return {
      ...rule,
      urlPattern: (match: RouteMatch) =>
        match.sameOrigin && /\.(?:mp3|wav|ogg)$/i.test(match.url.pathname),
    };
  }

  // Regra final do workbox: sem esta excecao ela captura o manifesto HLS, os
  // segmentos e o stream direto que o player consome.
  if (rule.options?.cacheName === "cross-origin") {
    return {
      ...rule,
      urlPattern: (match: RouteMatch) => {
        if (match.sameOrigin) return false;
        const destination = match.request.destination;
        if (destination === "audio" || destination === "video") return false;
        return !/\.(?:m3u8|m3u|pls|aac|aacp|ts|mp3|m4a|ogg|opus|flac|wav)$/i.test(
          match.url.pathname,
        );
      },
    };
  }

  return rule;
});

const isDevelopment = process.env.NODE_ENV === "development";

// Páginas, respostas RSC e APIs dependem de sessão/permissões e nunca podem
// voltar de um cache antigo. Os arquivos estáticos com hash continuam usando
// as regras do Workbox, assim como o service worker necessário ao Web Push.
runtimeCaching.unshift({
  urlPattern: (match: RouteMatch) =>
    match.sameOrigin &&
    (match.url.pathname === "/api" || match.url.pathname.startsWith("/api/")),
  handler: "NetworkOnly",
  options: { cacheName: "api-network-only" },
});
runtimeCaching.unshift({
  urlPattern: (match: RouteMatch) =>
    match.sameOrigin &&
    !match.url.pathname.startsWith("/api/") &&
    (match.request.mode === "navigate"
      || match.request.destination === "document"
      || match.request.headers.get("RSC") === "1"),
  handler: "NetworkOnly",
  options: { cacheName: "application-network-only" },
});

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // O microfone e liberado somente para a propria origem: e ele que a
    // mensagem de voz do chat usa, sempre depois de uma acao explicita do
    // usuario. Camera e localizacao continuam bloqueadas.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      isDevelopment
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
        : "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' data: blob: https: http:",
      isDevelopment ? "connect-src 'self' https: ws: wss:" : "connect-src 'self' https: wss:",
      "frame-src https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join("; "),
  },
];

const withPWA = nextPWA.default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  // O ERP é autenticado e muda frequentemente. A página inicial não pode ser
  // reutilizada entre versões ou sessões.
  cacheStartUrl: false,
  dynamicStartUrl: false,
  reloadOnOnline: false,
  workboxOptions: {
    runtimeCaching,
    // O codec HEIC tem ~3 MB e so e solicitado ao selecionar uma foto HEIC.
    // Mantem o download sob demanda e o cache de runtime dos scripts, sem
    // baixa-lo em toda instalacao do PWA. Identifica o modulo, nao o hash.
    exclude: [
      /\/_next\/static\/.*(?<!\.p)\.woff2/,
      /\.map$/,
      /^manifest.*\.js$/,
      // Manifestos internos nao sao servidos como assets publicos em producao.
      /(?:^|\/)(?:(?:app-)?build-manifest|react-loadable-manifest)\.json$/,
      /(?:^|\/)server\//,
      ({ asset, compilation }: { asset: Asset; compilation: Compilation }) => {
        if (!asset.name.endsWith(".js")) return false;
        for (const chunk of compilation.chunks) {
          if (!chunk.files.has(asset.name)) continue;
          for (const chunkModule of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
            if (chunkModule.identifier().replaceAll("\\", "/").includes("/node_modules/heic-to/")) return true;
          }
        }
        return false;
      },
    ],
  },
});

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    tsconfigPath: process.env.NEXT_TSCONFIG_PATH || "tsconfig.json",
    // A checagem de tipos custa ~135s dos ~145s da build e roda com 3,1GB num
    // heap de 4,3GB, o que faz a deploy travar em GC. O gate nao sumiu: vive em
    // .github/workflows/typecheck.yml, fora do caminho critico da deploy.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // A maquina de build da Vercel tem 2 nucleos e 8GB. Com varios workers em
  // paralelo, cada um com heap grande, a soma passa dos 8GB e o container mata
  // o build por falta de memoria (SIGKILL). Menos workers e o modo de memoria
  // do webpack trocam alguns segundos por um pico bem menor.
  experimental: {
    ...(!isDevelopment ? { webpackMemoryOptimizations: true, cpus: 1 } : {}),
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      { source: "/(.*)", headers: securityHeaders },
    ];
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',     // ou '**.supabase.co'
        port: '',
        pathname: '/storage/v1/object/public/**',

        // Next < 15.3.0: normalmente precisa existir ('' = NÃO permitir querystring)
        // Se você usa URLs assinadas (com ?token=...), remova essa linha pra permitir search params.
        search: '',
      },
    ],
  },
}

// O plugin adiciona um hook de Webpack mesmo desabilitado. No desenvolvimento,
// exportamos a configuracao diretamente para permitir o uso do Turbopack.
export default isDevelopment ? nextConfig : withPWA(nextConfig);
