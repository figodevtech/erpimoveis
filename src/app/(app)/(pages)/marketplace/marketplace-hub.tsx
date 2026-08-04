"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MercadoLivreMarketplace from "./marketplace-client";
import ShopeeMarketplace from "./shopee-marketplace";
import { MarketplaceChannelProvider, type MarketplaceChannel } from "./marketplace-channel";

export default function MarketplaceHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("canal");
  const channel: MarketplaceChannel = requested === "shopee" ? "shopee" : "mercadolivre";

  function setChannel(nextChannel: MarketplaceChannel) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("canal", nextChannel);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <MarketplaceChannelProvider channel={channel} setChannel={setChannel}>
      {channel === "mercadolivre" ? <MercadoLivreMarketplace /> : <ShopeeMarketplace />}
    </MarketplaceChannelProvider>
  );
}
