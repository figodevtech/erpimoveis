import { GET as getCustomerInsights } from "@/app/api/customers/insights/route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return getCustomerInsights(request);
}
