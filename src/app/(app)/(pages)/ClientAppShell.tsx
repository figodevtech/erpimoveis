// src/app/(app)/ClientAppShell.tsx
"use client";

import * as React from "react";
import axios from "axios";
import { signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

import { AppSidebar } from "../components/sidebar/sidebar";
import { ModeToggle } from "../components/mode-toggle";
import DateTimeBadge from "../components/date-time-badge";
import { useConfig } from "./config-context";

const routeTitles: Record<string, string> = {
  "/execucao": "Execução de Ordens",
  "/": "Início",
  "/usuarios": "Gerenciamento de Usuários",
  "/estoque": "Gerenciamento de Estoque",
  "/config": "Configurações",
  "/ordens": "Gerenciamento de Ordens de Serviço",
  "/clientes": "Gerenciamento de Clientes",
  "/equipes": "Acompanhamento de Equipes",
  "/financeiro": "Financeiro",
  "/fluxodecaixa": "Fluxo de Caixa",
  "/bancos": "Bancos",
  "/pagamentodeordens": "Assistente de Pagamento",
  "/pagamentodevendas": "Assistente de Pagamento",
  "/acompanhamento": "Acompanhamento",
  "/configuracoes/geral": "Configurações Gerais",
  "/configuracoes/fiscal-pagamentos": "Configurações Fiscais e de Pagamentos",
  "/configuracoes/checklist": "Gerenciamento de Checklists",
  "/nao-autorizado": "Acesso não autorizado",
  "/configuracoes/tipos": "Configurações de Tipos",
  "/historicovendas": "Histórico de Vendas",
  "/configuracoes/perfis": "Perfis de Permissões",
};

function humanize(path: string) {
  const clean = path.split("?")[0].split("#")[0];
  const seg = clean.split("/").filter(Boolean)[0] ?? "";
  if (!seg) return "Início";

  const dic: Record<string, string> = {
    execucao: "Execução de Ordens",
    ordens: "Ordens de Serviço",
    assistentepagamento: "Assistente de Pagamento",
    fluxodecaixa: "Fluxo de Caixa",
    bancos: "Bancos",
    usuarios: "Gerenciamento de Usuários",
    estoque: "Gerenciamento de Estoque",
    clientes: "Gerenciamento de Clientes",
    equipes: "Acompanhamento de Equipes",
    financeiro: "Financeiro",
    acompanhamento: "Acompanhamento",
    config: "Configurações",
  };

  return dic[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1);
}

export default function ClientAppShell({
  children,
  hideHeader = false,
}: {
  children: React.ReactNode;
  hideHeader?: boolean;
}) {
  const pathname = usePathname();
  const title = routeTitles[pathname] ?? humanize(pathname);
  const router = useRouter();
  const config = useConfig();

  const [sideBarOpen, setSidebarOpen] = React.useState(true);
  const [hoverHabilitado, setHoverHabilitado] = React.useState(true);
  const hoverTimerRef = React.useRef<number | null>(null);
  const loggingOutRef = React.useRef(false);

  React.useEffect(() => {
    // limpa timer anterior se trocar de rota rápido
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    const isOrdens = pathname === "/ordens" || pathname.startsWith("/ordens/");

    if (isOrdens) {
      setSidebarOpen(false);

      // bloqueia hover por 1s (tempo da animação de fechar)
      setHoverHabilitado(false);
      hoverTimerRef.current = window.setTimeout(() => {
        setHoverHabilitado(true);
      }, 1000);
    } else {
      // fora de ordens, deixa normal
      setHoverHabilitado(true);
    }

    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
  }, [pathname]);

  React.useEffect(() => {
    if (!config?.aviso_pagamento) return;
    toast.warning(
      <div>
        <span className="text-xs text-center">Pagamento pendente, contate o time da FIGO</span>
      </div>,
      {
        richColors: true,
        closeButton: false,
        duration: 999999999,
        position: "bottom-center",
        dismissible: false,
      }
    );
  }, [config?.aviso_pagamento]);

  // Opção 1: "sob demanda".
  // Quando o usuário tentar fazer algo (API call) e receber INACTIVE_USER,
  // encerramos a sessão do Auth.js e mandamos para o login.
  React.useEffect(() => {
    let alive = true;

    async function doLogout() {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      try {
        await signOut({ redirect: false });
      } finally {
        if (alive) router.replace("/login?reason=inactive");
      }
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await originalFetch(...args);
      try {
        const url =
          typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : "";

        // não interferir com endpoints do Auth.js (signOut usa /api/auth/*)
        if (url.includes("/api/auth")) return res;

        if (
          (res.status === 401 || res.status === 403) &&
          (res.headers.get("content-type") || "").includes("application/json")
        ) {
          const j = await res.clone().json().catch(() => ({} as any));
          if (j?.error === "INACTIVE_USER") void doLogout();
        }
      } catch {
        // ignore
      }
      return res;
    };

    const axiosId = axios.interceptors.response.use(
      (resp) => resp,
      async (err) => {
        const url = String(err?.config?.url ?? "");
        if (!url.includes("/api/auth")) {
          const status = err?.response?.status;
          const data = err?.response?.data;
          if ((status === 401 || status === 403) && data?.error === "INACTIVE_USER") {
            await doLogout();
          }
        }
        return Promise.reject(err);
      }
    );

    return () => {
      alive = false;
      window.fetch = originalFetch;
      axios.interceptors.response.eject(axiosId);
      loggingOutRef.current = false;
    };
  }, [router]);

  return (
    <SidebarProvider open={sideBarOpen} onOpenChange={setSidebarOpen}>
      <AppSidebar hoverHabilitado={hoverHabilitado} setOpen={setSidebarOpen} />

      <SidebarInset className="flex min-h-screen min-w-0">
        {!hideHeader ? (
          <header className="flex h-16 w-full shrink-0 items-center gap-2 border-b bg-card/95 px-4 shadow-sm backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />

            <h2 className="text-base md:text-lg font-medium text-foreground/80">{title}</h2>
            <div className="flex-1" />

            <DateTimeBadge />
            <ModeToggle />
          </header>
        ) : (
          // quando não tem header, mostra um trigger flutuante no mobile
          <div className="md:hidden fixed left-3 top-3 z-50">
            <SidebarTrigger className="h-10 w-10 rounded-md border bg-background/90 shadow-sm backdrop-blur" />
          </div>
        )}

        <main className="flex-1 min-w-0 bg-background dark:bg-muted-foreground/5">
          {/* se estiver sem header, adiciona padding-top pra não ficar por baixo do trigger flutuante */}
          <div className={`mx-auto w-full px-4 md:px-6 py-4 md:py-6 ${hideHeader ? "pt-14" : ""}`}>{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
