export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPaymentMethodValues } from "@/lib/payment-methods-server";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const values = await getPaymentMethodValues();
    return NextResponse.json({ data: values.map((value) => ({ value })) });
  } catch (error) {
    console.error("GET /api/payment-methods", error);
    return NextResponse.json(
      { error: "Falha ao carregar formas de pagamento." },
      { status: 500 },
    );
  }
}
