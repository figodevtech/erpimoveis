import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet, mercadoLivreApiPost } from "@/lib/integrations/mercadolivre";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MercadoLivreAccount = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
};

type MercadoLivreQuestion = {
  id: number;
  item_id?: string;
  seller_id?: number;
  status?: string;
  text?: string;
  date_created?: string;
  deleted_from_listing?: boolean;
  hold?: boolean;
  suspected_spam?: boolean;
  answer?: {
    text?: string;
    status?: string;
    date_created?: string;
  } | null;
  from?: {
    id?: number;
    answered_questions?: number;
  };
};

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();

    const account = await getActiveAccount(await requireEmpresaId());
    const accessToken = await ensureAccessToken(account);
    const status = req.nextUrl.searchParams.get("status")?.trim();
    const itemId = req.nextUrl.searchParams.get("itemId")?.trim();
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 30), 1), 50);
    const offset = Math.max(Number(req.nextUrl.searchParams.get("offset") ?? 0), 0);

    const params = new URLSearchParams({
      api_version: "4",
      limit: String(limit),
      offset: String(offset),
    });

    if (itemId) {
      params.set("item_id", itemId);
    } else {
      params.set("seller_id", String(account.ml_user_id));
    }

    if (status && status !== "all") {
      params.set("status", status);
    }

    const result = await mercadoLivreApiGetWithRefresh<{
      total?: number;
      limit?: number;
      offset?: number;
      questions?: MercadoLivreQuestion[];
    }>(account, accessToken, `/questions/search?${params.toString()}`);

    return NextResponse.json({
      data: (result.questions ?? []).map(normalizeQuestion),
      pagination: {
        total: result.total ?? 0,
        limit: result.limit ?? limit,
        offset: result.offset ?? offset,
      },
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/questions", e);
    if (isReconnectRequiredError(e)) {
      return NextResponse.json({ error: e.message, requiresReconnect: true }, { status: 409 });
    }
    return NextResponse.json({ error: friendlyMercadoLivreError(e, "Falha ao carregar perguntas do Mercado Livre.") }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireVendasEdit();

    const body = await req.json().catch(() => ({}));
    const questionId = Number(body?.questionId);
    const text = String(body?.text ?? "").trim();

    if (!Number.isFinite(questionId) || questionId <= 0) {
      return NextResponse.json({ error: "Pergunta inválida." }, { status: 400 });
    }
    if (text.length < 2) {
      return NextResponse.json({ error: "Informe a resposta." }, { status: 400 });
    }

    const account = await getActiveAccount(await requireEmpresaId());
    const accessToken = await ensureAccessToken(account);

    const result = await mercadoLivreApiPostWithRefresh<MercadoLivreQuestion>(account, accessToken, "/answers", {
      question_id: questionId,
      text,
    });

    return NextResponse.json({ ok: true, data: normalizeQuestion(result) });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/questions", e);
    if (isReconnectRequiredError(e)) {
      return NextResponse.json({ error: e.message, requiresReconnect: true }, { status: 409 });
    }
    return NextResponse.json({ error: friendlyMercadoLivreError(e, "Falha ao responder pergunta no Mercado Livre.") }, { status: 500 });
  }
}

async function getActiveAccount(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.access_token) throw new Error("Nenhuma conta Mercado Livre conectada.");
  return data as MercadoLivreAccount;
}

async function ensureAccessToken(account: MercadoLivreAccount) {
  return ensureMercadoLivreToken(account);
}

async function forceRefreshAccessToken(account: MercadoLivreAccount) {
  return ensureMercadoLivreToken(account, account.access_token);
}

async function mercadoLivreApiGetWithRefresh<T>(account: MercadoLivreAccount, accessToken: string, path: string) {
  try {
    return await mercadoLivreApiGet<T>(accessToken, path);
  } catch (e: any) {
    if (!isUnauthorizedMercadoLivreError(e)) throw e;
    const refreshedToken = await forceRefreshAccessToken(account);
    return mercadoLivreApiGet<T>(refreshedToken, path);
  }
}

async function mercadoLivreApiPostWithRefresh<T>(account: MercadoLivreAccount, accessToken: string, path: string, body: unknown) {
  try {
    return await mercadoLivreApiPost<T>(accessToken, path, body);
  } catch (e: any) {
    if (!isUnauthorizedMercadoLivreError(e)) throw e;
    const refreshedToken = await forceRefreshAccessToken(account);
    return mercadoLivreApiPost<T>(refreshedToken, path, body);
  }
}

function isUnauthorizedMercadoLivreError(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("falhou (401)") || message.includes("invalid access token") || message.includes("unauthorized");
}

function isReconnectRequiredError(error: any) {
  return String(error?.message ?? "").includes("Reconecte a conta");
}

function normalizeQuestion(question: MercadoLivreQuestion) {
  return {
    id: question.id,
    itemId: question.item_id ?? null,
    sellerId: question.seller_id ?? null,
    status: question.status ?? null,
    text: question.text ?? "",
    dateCreated: question.date_created ?? null,
    deletedFromListing: Boolean(question.deleted_from_listing),
    hold: Boolean(question.hold),
    suspectedSpam: Boolean(question.suspected_spam),
    answer: question.answer
      ? {
          text: question.answer.text ?? "",
          status: question.answer.status ?? null,
          dateCreated: question.answer.date_created ?? null,
        }
      : null,
    from: question.from
      ? {
          id: question.from.id ?? null,
          answeredQuestions: question.from.answered_questions ?? null,
        }
      : null,
  };
}

function friendlyMercadoLivreError(error: any, fallback: string) {
  const message = String(error?.message ?? "");
  const jsonStart = message.indexOf("{");

  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart));
      return parsed?.message || parsed?.error || fallback;
    } catch {
      return message;
    }
  }

  return message || fallback;
}
import { ensureMercadoLivreToken } from "@/lib/integrations/mercadolivre-token";
