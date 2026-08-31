"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MercadoLivreMarketplace from "./marketplace-client";
import ShopeeMarketplace from "./shopee-marketplace";
import MarketplaceAll from "./marketplace-all";
import { MarketplaceChannelProvider, type MarketplaceChannel } from "./marketplace-channel";

export default function MarketplaceHub({ shopeeEnabled }: { shopeeEnabled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("canal");
  const channel: MarketplaceChannel = shopeeEnabled
    ? requested === "shopee" || requested === "mercadolivre" ? requested : "all"
    : "mercadolivre";

  function setChannel(nextChannel: MarketplaceChannel) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("canal", nextChannel);
    const currentSection = params.get("secao");
    if (nextChannel === "all" && currentSection === "products") params.set("secao", "catalog");
    if (nextChannel !== "all" && currentSection === "catalog") params.set("secao", "products");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <MarketplaceChannelProvider channel={channel} setChannel={setChannel} shopeeEnabled={shopeeEnabled}>
      {!shopeeEnabled || channel === "mercadolivre" ? <MercadoLivreMarketplace /> : channel === "all" ? <MarketplaceAll /> : <ShopeeMarketplace />}
    </MarketplaceChannelProvider>
  );
}
