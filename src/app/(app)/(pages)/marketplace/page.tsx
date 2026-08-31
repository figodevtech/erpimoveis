import { Suspense } from "react";
import MarketplaceHub from "./marketplace-hub";

export const dynamic = "force-dynamic";

export default function MarketplacePage() {
  const shopeeEnabled = process.env.NEXT_PUBLIC_SHOPEE_INTEGRATION_ENABLED === "true";
  return <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-muted/40" />}><MarketplaceHub shopeeEnabled={shopeeEnabled} /></Suspense>;
}
