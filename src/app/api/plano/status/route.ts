import { NextResponse } from "next/server";
import { getPlatformSubscription } from "@/lib/platform-billing/client";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getPlatformSubscription());
}
