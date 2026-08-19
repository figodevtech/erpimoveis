// src/app/(app)/(shell)/layout.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import ClientAppShell from "./ClientAppShell";
import { Pizza } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Settings } from "@/components/animate-ui/icons/settings";
import { Config } from "./type";
import { ConfigProvider } from "./config-context";
import { UserPreferencesProvider } from "../components/user-preferences-provider";

const CONFIG_CACHE_KEY = "erpoficina:config-cache";

const DEFAULT_CONFIG: Config = {
  id: 0,
  aviso_pagamento: false,
  checklist_obrigatorio: true,
  alerta_estoque_pdv: true,
  habilitar_emissao_nfe: false,
  emissao_nf_no_modulo_ordens: true,
  emissao_nf_no_modulo_vendas: false,
  emissao_nf_ordens_nao_pagas: false,
  emissao_nf_vendas_nao_pagas: false,
  habilitar_drawers: true,
  agendamento_intervalo_minutos: 60,
  agendamento_hora_inicio: "08:00",
  agendamento_hora_fim: "18:00",
  agendamento_dias_trabalho: [1, 2, 3, 4, 5],
  impressao_cor_primaria: "#2563eb",
  impressao_cor_secundaria: "#0891b2",
  modo_baixa_estoque_os: "ORCAMENTO",
  produto_preco_medio_compra_obrigatorio: false,
  produto_ncm_obrigatorio: false,
  habilitar_edicao_transacoes: false,
  permitir_produto_avulso_os: false,
  setor_padrao_os_id: null,
  created_at: "",
};

function readCachedConfig(): Config | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = window.sessionStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as Config;
  } catch {
    return undefined;
  }
}

function writeCachedConfig(config: Config) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
  } catch {
    // ignore cache failures
  }
}

export default function ShellLayout({ children }: { children: ReactNode }) {
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [progress, setProgress] = useState(0);
  const [config, setConfig] = useState<Config | undefined>(undefined);

  const handleGetConfig = async (background = false) => {
    if (!background) {
      setLoadingConfigs(true);
      setProgress(10);
    }

    try {
      setProgress(background ? 100 : 40);
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Falha ao buscar configuração: ${response.status}`);
      }
      setProgress(background ? 100 : 70);
      const data = await response.json();

      if (data.config) {
        writeCachedConfig(data.config);
        setConfig(data.config);
        setProgress(100);
      }
    } catch (error) {
      console.error("Erro ao buscar configuração:", error);
      if (!background) {
        setConfig(DEFAULT_CONFIG);
        setProgress(100);
      }
    } finally {
      if (!background) {
        setLoadingConfigs(false);
      }
    }
  };

  useEffect(() => {
    const cachedConfig = readCachedConfig();

    if (cachedConfig) {
      setConfig(cachedConfig);
      setProgress(100);
      setLoadingConfigs(false);
      void handleGetConfig(true);
      return;
    }

    void handleGetConfig(false);
  }, []);

  useEffect(() => {
    const handleConfigUpdated = (event: Event) => {
      const nextConfig = (event as CustomEvent<Config>).detail;
      if (!nextConfig) return;
      writeCachedConfig(nextConfig);
      setConfig(nextConfig);
    };

    window.addEventListener("erpoficina:config-updated", handleConfigUpdated);
    return () => window.removeEventListener("erpoficina:config-updated", handleConfigUpdated);
  }, []);

  if (loadingConfigs) {
    return (
      <div className="w-screen h-screen flex items-center justify-center gap-2">
        <div className="flex flex-col items-center justify-center">
          <div className="flex flex-row gap-2 items-center justify-center mb-4">
            <Settings
              animateOnView
              loop={true}
              className="text-muted-foreground"
            />
          </div>

          <Progress value={progress} className="w-50" />
          <span className="text-xs text-muted-foreground mt-2 text-nowrap flex flex-row gap-1 items-center">
            Estamos esquentando a pizza. <Pizza className="w-3 h-3 animate-bounce" />
          </span>
          <span className="text-[10px] text-muted-foreground font-serif">
            Powered by FIGO.
          </span>
        </div>
      </div>
    );
  }

  return (
    <ConfigProvider config={config ?? DEFAULT_CONFIG}>
      <UserPreferencesProvider>
        <ClientAppShell>{children}</ClientAppShell>
      </UserPreferencesProvider>
    </ConfigProvider>
  );
}
