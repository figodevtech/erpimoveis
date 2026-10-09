"use client";

import { createContext, useContext } from "react";
import { Check, ChevronDown, Globe2, Layers3, ShoppingBag, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type MarketplaceChannel = "all" | "loja" | "mercadolivre" | "shopee";

const MarketplaceChannelContext = createContext<{
  channel: MarketplaceChannel;
  setChannel: (channel: MarketplaceChannel) => void;
  shopeeEnabled: boolean;
} | null>(null);

export function MarketplaceChannelProvider({ channel, setChannel, shopeeEnabled, children }: {
  channel: MarketplaceChannel;
  setChannel: (channel: MarketplaceChannel) => void;
  shopeeEnabled: boolean;
  children: React.ReactNode;
}) {
  return <MarketplaceChannelContext.Provider value={{ channel, setChannel, shopeeEnabled }}>{children}</MarketplaceChannelContext.Provider>;
}

export function MarketplaceChannelSwitcher() {
  const context = useContext(MarketplaceChannelContext);
  if (!context) return null;
  const channels = CHANNELS.filter((item) => item.id !== "shopee" || context.shopeeEnabled);
  const current = channels.find((item) => item.id === context.channel) ?? channels[0];
  if (channels.length === 1) return null;
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-auto w-full min-w-0 justify-between gap-3 bg-card px-3 py-2 shadow-sm sm:w-auto sm:min-w-52">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${current.iconClass}`}>
              <CurrentIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Canal de venda</span>
              <span className="block truncate text-sm font-semibold">{current.label}</span>
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1.5">
        {channels.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.id} className="gap-3 rounded-md p-3" onClick={() => context.setChannel(item.id)}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${item.iconClass}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
              </span>
              {item.id === context.channel ? <Check className="h-4 w-4 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const CHANNELS = [
  { id: "all", label: "Todos os canais", description: "Visão consolidada da operação", icon: Layers3, iconClass: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  { id: "loja", label: "Site", description: "Catálogo, preço, estoque e sincronização", icon: Globe2, iconClass: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  { id: "mercadolivre", label: "Mercado Livre", description: "Anúncios, pedidos e atendimento", icon: Store, iconClass: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  { id: "shopee", label: "Shopee", description: "Pedidos, catálogo e sincronização", icon: ShoppingBag, iconClass: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
] satisfies Array<{ id: MarketplaceChannel; label: string; description: string; icon: typeof Store; iconClass: string }>;
