export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import type { Metadata } from "next";
import { ChecklistOnlineSigning } from "./signing-client";

export const metadata: Metadata = {
  title: "Assinar checklist",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function ChecklistOnlineSigningPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ChecklistOnlineSigning token={token} />;
}
