import { NextResponse } from "next/server";
import { z } from "zod";
import { platformConfiguration } from "@/lib/platform-billing/client";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = z.object({ id: z.string().uuid() }).parse(await params);
  const config = platformConfiguration();
  if (!config.configured) return NextResponse.json({ error: "Central financeira não configurada." }, { status: 503 });

  const response = await fetch(`${config.url}/api/v1/charges/${id}/boleto`, {
    cache: "no-store",
    headers: { "X-Installation-Id": config.installationId!, Authorization: `Bearer ${config.secret}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response) return NextResponse.json({ error: "Central financeira indisponível." }, { status: 502 });
  if (!response.ok) return NextResponse.json({ error: await response.text() }, { status: response.status });

  return new NextResponse(await response.arrayBuffer(), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="boleto-${id}.pdf"`,
      "Content-Type": response.headers.get("content-type") ?? "application/pdf",
    },
  });
}
