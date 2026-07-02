// src/app/api/rastreio/consultar/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchPacoteVicioCorreios } from "@/lib/tracking/pacotevicio";

function toInt(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function isPaid(status: string | null | undefined) {
  const s = String(status ?? "").toUpperCase();
  return s === "PAGO" || s === "FINALIZADA";
}

function entregaRank(v: any): number {
  const s = String(v ?? "").toUpperCase();
  if (!s) return 0;
  if (s === "SEPARACAO") return 1;
  if (s === "ENVIO") return 2;
  if (s === "ENTREGUE") return 3;
  return 0;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { vendaId?: number; transportadora?: string }
      | null;

    const vendaId = toInt(body?.vendaId);
    if (!vendaId) {
      return NextResponse.json({ error: "vendaId e obrigatorio." }, { status: 400 });
    }

    const { data: venda, error: vendaErr } = await supabaseAdmin
      .from("venda")
      .select(
        "id, canal, status, status_entrega, codigo_rastreio, transportadora_rastreio, ultimo_evento_rastreio, ultimo_evento_rastreio_em"
      )
      .eq("id", vendaId)
      .single();

    if (vendaErr) {
      console.error("[rastreio/consultar] erro ao buscar venda:", vendaErr);
      return NextResponse.json({ error: "Erro ao buscar venda." }, { status: 500 });
    }
    if (!venda) {
      return NextResponse.json({ error: "Venda nao encontrada." }, { status: 404 });
    }

    if (!isMarketplaceCanal((venda as any).canal)) {
      return NextResponse.json({ error: "Rastreio disponivel apenas para vendas de marketplace." }, { status: 400 });
    }

    const carrier = String(body?.transportadora ?? (venda as any).transportadora_rastreio ?? "CORREIOS").toUpperCase();
    if (carrier !== "CORREIOS") {
      return NextResponse.json({ error: "Transportadora nao suportada no momento." }, { status: 400 });
    }

    const code = String((venda as any).codigo_rastreio ?? "").trim();
    if (!code) {
      return NextResponse.json({ error: "Codigo de rastreio nao informado." }, { status: 400 });
    }

    const tracking = await fetchPacoteVicioCorreios(code);

    const nowIso = new Date().toISOString();
    const lastAtIso = tracking.lastEventAt ?? null;
    const lastTitle = tracking.lastEventTitle ?? null;

    // Se o provedor retornar sem eventos, evitamos "apagar" eventos antigos do banco.
    const patch: Record<string, any> = {
      transportadora_rastreio: "CORREIOS",
      rastreio_atualizado_em: nowIso,
      updatedat: nowIso,
    };

    if (tracking.events.length) {
      patch.eventos_rastreio = tracking.events; // normalized
    }
    if (lastTitle) patch.ultimo_evento_rastreio = lastTitle;
    if (lastAtIso) patch.ultimo_evento_rastreio_em = lastAtIso;
    if (tracking.isDelivered) patch.status_rastreio = "ENTREGUE";
    else if (tracking.isOutForDelivery) patch.status_rastreio = "SAIU_PARA_ENTREGA";

    // Alinha o status_entrega ao status do rastreio (somente se venda estiver paga/finalizada).
    const paid = isPaid((venda as any).status);
    if (paid) {
      const current = (venda as any).status_entrega ?? null;
      const currentRank = entregaRank(current);

      const derived =
        tracking.isDelivered ? "ENTREGUE" : tracking.isOutForDelivery ? "ENVIO" : null;
      const derivedRank = entregaRank(derived);

      // Nunca "volta" o status; apenas avanca conforme o rastreio.
      if (derived && derivedRank > currentRank) {
        patch.status_entrega = derived;
      }
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("venda")
      .update(patch)
      .eq("id", vendaId)
      .select(
        "id, canal, status, status_entrega, codigo_rastreio, transportadora_rastreio, ultimo_evento_rastreio, ultimo_evento_rastreio_em, status_rastreio, eventos_rastreio, rastreio_atualizado_em"
      )
      .single();

    if (updErr) {
      console.error("[rastreio/consultar] erro ao atualizar venda:", updErr);
      return NextResponse.json({ error: "Erro ao atualizar rastreio no banco." }, { status: 500 });
    }

    const warning =
      tracking.events.length === 0
        ? "O provedor nao retornou eventos para este codigo. Verifique se o codigo esta correto e se o rastreio ja possui movimentacoes."
        : null;

    return NextResponse.json({ data: updated, tracking, warning });
  } catch (e: any) {
    console.error("[rastreio/consultar] erro:", e);
    return NextResponse.json({ error: e?.message || "Erro interno." }, { status: 500 });
  }
}

function isMarketplaceCanal(canal: unknown) {
  const value = String(canal ?? "").toUpperCase();
  return value === "ONLINE" || value === "MERCADO_LIVRE" || value === "SHOPEE";
}
