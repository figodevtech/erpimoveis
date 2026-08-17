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
