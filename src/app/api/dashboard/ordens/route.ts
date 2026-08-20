import { GET as getOrderInsights } from "@/app/api/ordens/insights/route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return getOrderInsights(request);
}
