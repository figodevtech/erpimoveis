import { GET as getCustomerStatusCounter } from "@/app/api/customers/status-counter/route";

export const runtime = "nodejs";

export async function GET() {
  return getCustomerStatusCounter();
}
