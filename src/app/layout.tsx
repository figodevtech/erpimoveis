import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/theme-provider";
import NProgressHandler from "@/components/NProgressHandler";
import { RouteAwareToaster } from "@/components/route-aware-toaster";
import { developmentWorkerCleanup } from "@/lib/development-worker-cleanup";

export const metadata: Metadata = {
  title: "ERP Imóveis",
  description: "Sistema de gestão para oficinas",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-512x512.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ERP Imóveis',
  },
};

export const viewport: Viewport = {
  themeColor: "#6d28d9",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "development" ? (
          <script id="development-worker-cleanup" dangerouslySetInnerHTML={{ __html: developmentWorkerCleanup }} />
        ) : null}
      </head>
      {/* Some browser extensions inject attributes into <body> before hydration (e.g. cz-shortcut-listen). */}
      <body className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
        <Providers attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NProgressHandler />
          {children}
          <RouteAwareToaster />
        </Providers>
      </body>
    </html>
  );
}
