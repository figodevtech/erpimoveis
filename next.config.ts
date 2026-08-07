import type { NextConfig } from "next";
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
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
