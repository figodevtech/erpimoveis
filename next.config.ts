import type { NextConfig } from "next";
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

// Respostas de API dependem de cookie/permissões e nunca podem sobreviver à
// troca de usuário no Cache Storage do navegador.
runtimeCaching.unshift({
  urlPattern: (match: RouteMatch) =>
    match.sameOrigin &&
    (match.url.pathname === "/api" || match.url.pathname.startsWith("/api/")),
  handler: "NetworkOnly",
  options: { cacheName: "api-network-only" },
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
  workboxOptions: { runtimeCaching },
});

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    tsconfigPath: process.env.NEXT_TSCONFIG_PATH || "tsconfig.json",
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
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

export default withPWA(nextConfig);
