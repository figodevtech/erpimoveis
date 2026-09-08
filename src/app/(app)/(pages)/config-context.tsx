"use client";

import * as React from "react";
import type { Config } from "./type";

type ConfigContextValue = {
  config: Config | null;
};

const ConfigContext = React.createContext<ConfigContextValue | null>(null);

export function ConfigProvider({
  config,
  children,
}: {
  config: Config | null;
  children: React.ReactNode;
}) {
  /*
   * Drawers saíram do produto: no celular vale o mesmo diálogo do desktop.
   *
   * A decisão é forçada aqui, e não em cada tela, porque `habilitar_drawers`
   * continua no banco e na API — nenhuma tela oferece o botão para desligar, e
   * quem já tem a coluna ligada continuaria no caminho antigo. Ele custava caro:
   * `useMediaQuery` começa em `false`, então a abertura montava o conteúdo
   * dentro do Drawer e trocava para o Dialog no efeito seguinte. Trocar o tipo
   * do elemento remonta a árvore inteira, e toda busca feita na montagem do
   * formulário saía duas vezes.
   */
  const valor = React.useMemo<ConfigContextValue>(
    () => ({ config: config ? { ...config, habilitar_drawers: false } : null }),
    [config],
  );

  return (
    <ConfigContext.Provider value={valor}>{children}</ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = React.useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useConfig deve ser usado dentro de <ConfigProvider />");
  }
  return ctx.config;
}
