import { AlertTriangle } from "lucide-react";
import { getPlatformSubscription } from "@/lib/platform-billing/client";
import { PlanoClient } from "./plano-client";

export const dynamic = "force-dynamic";

export default async function PlanoPage() {
  const result = await getPlatformSubscription(true);
  if (!result.data) return <div className="mx-auto max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950"><div className="flex gap-3"><AlertTriangle className="size-5 shrink-0" /><div><h1 className="font-semibold">Mensalidades temporariamente indisponíveis</h1><p className="mt-1 text-sm">{result.error}</p></div></div></div>;
  return <PlanoClient stale={result.stale} value={result.data} />;
}
