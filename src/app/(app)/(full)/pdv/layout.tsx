"use client";

import { useEffect, useState } from "react";
import { ConfigProvider } from "../../(pages)/config-context";
import { Config } from "../../(pages)/type";
import { Settings } from "@/components/animate-ui/icons/settings";
import { Progress } from "@/components/ui/progress";
import { Pizza } from "lucide-react";
import { PinchLock } from "@/components/pinch-lock";

export const dynamic = "force-dynamic";

const CONFIG_CACHE_KEY = "erpoficina:config-cache";

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

export default function PdvLayout({ children }: { children: React.ReactNode }) {
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
      setProgress(background ? 100 : 70);
      const data = await response.json();

      if (data.config) {
        writeCachedConfig(data.config);
        setConfig(data.config);
        setProgress(100);
      }
    } catch (error) {
      console.error("Erro ao buscar configuração:", error);
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

  if (loadingConfigs || !config) {
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
    <ConfigProvider config={config}>
      <div data-pinch="off" className="min-h-screen bg-background text-foreground">
        <PinchLock />
        {children}
      </div>
    </ConfigProvider>
  );
}
