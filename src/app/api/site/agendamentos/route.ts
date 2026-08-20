export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { onlyDigits } from "@/lib/agendamentos";
import { checkLoginRateLimit, registerLoginFailure } from "@/lib/login-rate-limit";
import { buildAppointmentRateLimitKeys } from "@/lib/login-security";
import { verifyTurnstileToken } from "@/lib/turnstile";

const PUBLIC_SELECT = `
  inicio,
  fim
`;

const MAX_BODY_BYTES = 32 * 1024;

function requiredString(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  if (!text) {
    const error = new Error(`${field} e obrigatorio`);
    (error as any).statusCode = 400;
    throw error;
  }
  return text;
}

function boundedString(value: unknown, field: string, maxLength: number, required = false) {
  const text = String(value ?? "").trim();
  if (required && !text) {
    const error = new Error(`${field} e obrigatorio`);
    (error as any).statusCode = 400;
    throw error;
  }
  if (text.length > maxLength) {
    const error = new Error(`${field} excede o tamanho permitido`);
    (error as any).statusCode = 400;
    throw error;
  }
  return text || null;
}

function parseDate(value: unknown, field: string) {
  const date = new Date(requiredString(value, field));
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${field} invalido`);
    (error as any).statusCode = 400;
    throw error;
  }
  return date.toISOString();
}

function validEmail(value?: string | null) {
  if (!value) return true;
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

function getSolicitantePayload(body: any) {
  const cpfcnpj = onlyDigits(requiredString(body?.cpfcnpj, "cpfcnpj"));
  const telefone = boundedString(body?.telefone, "telefone", 32);
  const email = boundedString(body?.email, "email", 254);
  const nome = boundedString(body?.nome, "nome", 120, true)!;

  if (![11, 14].includes(cpfcnpj.length)) {
    const error = new Error("cpfcnpj invalido");
    (error as any).statusCode = 400;
    throw error;
  }

  if (!telefone) {
    const error = new Error("telefone e obrigatorio");
    (error as any).statusCode = 400;
    throw error;
  }

  if (!validEmail(email)) {
    const error = new Error("email invalido");
    (error as any).statusCode = 400;
    throw error;
  }

  return {
    solicitante_nome: nome,
    solicitante_cpfcnpj: cpfcnpj,
    solicitante_telefone: telefone,
    solicitante_email: email,
  };
}

function formatVeiculoDescricao(body: any) {
  const placa = boundedString(body?.placa, "placa", 10)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? null;
  const marca = boundedString(body?.marca, "marca", 80);
  const modelo = boundedString(body?.modelo, "modelo", 80);
  const parts = [
    placa ? `Placa: ${placa}` : null,
    marca ? `Marca: ${marca}` : null,
    modelo ? `Modelo: ${modelo}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom")?.trim();
    const dateTo = searchParams.get("dateTo")?.trim();

    if ((dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) || (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo))) {
      return NextResponse.json({ error: "Periodo invalido" }, { status: 400 });
    }
    if (dateFrom && dateTo) {
      const rangeDays = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000;
      if (rangeDays < 0 || rangeDays > 93) {
        return NextResponse.json({ error: "Periodo invalido" }, { status: 400 });
      }
    }

    const configRes = await supabaseAdmin
      .from("config_geral")
      .select("agendamento_intervalo_minutos, agendamento_hora_inicio, agendamento_hora_fim, agendamento_dias_trabalho")
      .limit(1)
      .maybeSingle();

    if (configRes.error) throw configRes.error;

    let query = supabaseAdmin
      .from("agendamento")
      .select(PUBLIC_SELECT)
      .not("status", "in", "(RECUSADO,CANCELADO)")
      .order("inicio", { ascending: true })
      .limit(500);

    if (dateFrom) query = query.gte("inicio", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("inicio", `${dateTo}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      config: {
        agendamento_intervalo_minutos: Number(configRes.data?.agendamento_intervalo_minutos ?? 60),
        agendamento_hora_inicio: String(configRes.data?.agendamento_hora_inicio ?? "08:00").slice(0, 5),
        agendamento_hora_fim: String(configRes.data?.agendamento_hora_fim ?? "18:00").slice(0, 5),
        agendamento_dias_trabalho: configRes.data?.agendamento_dias_trabalho ?? [1, 2, 3, 4, 5],
      },
      ocupados: data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao consultar agenda" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const declaredLength = Number(req.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      const error = new Error("Payload muito grande");
      (error as any).statusCode = 413;
      throw error;
    }

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      const error = new Error("Payload muito grande");
      (error as any).statusCode = 413;
      throw error;
    }
    const body = JSON.parse(rawBody);
    const clienteBody = body?.cliente ?? body;
    const veiculoBody = body?.veiculo ?? body;
    const solicitante = getSolicitantePayload(clienteBody);
    const rateLimitKeys = buildAppointmentRateLimitKeys(solicitante.solicitante_cpfcnpj, req);
    const retryAfter = await checkLoginRateLimit(rateLimitKeys);
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: "Muitas solicitações. Aguarde antes de tentar novamente." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    const blockedFor = await registerLoginFailure(rateLimitKeys);
    if (blockedFor > 0) {
      return NextResponse.json(
        { error: "Muitas solicitações. Aguarde antes de tentar novamente." },
        { status: 429, headers: { "Retry-After": String(blockedFor) } },
      );
    }

    const turnstile = await verifyTurnstileToken(
      body?.turnstileToken ?? body?.captchaToken ?? body?.["cf-turnstile-response"],
      req,
    );
    if (!turnstile.success) {
      const error = new Error("Verificacao anti-bot invalida");
      (error as any).statusCode = 400;
      throw error;
    }

    const veiculoDescricao = formatVeiculoDescricao(veiculoBody);
    const inicio = parseDate(body?.inicio, "inicio");

    if (new Date(inicio).getTime() < Date.now()) {
      const error = new Error("Nao e possivel solicitar agendamento em data anterior");
      (error as any).statusCode = 400;
      throw error;
    }

    let fim = body?.fim ? parseDate(body.fim, "fim") : null;
    if (!fim) {
      const { data: config, error: configError } = await supabaseAdmin
        .from("config_geral")
        .select("agendamento_intervalo_minutos")
        .limit(1)
        .maybeSingle();
      if (configError) throw configError;
      const intervalMinutes = Math.max(15, Number(config?.agendamento_intervalo_minutos ?? 60));
      fim = new Date(new Date(inicio).getTime() + intervalMinutes * 60_000).toISOString();
    }
    if (fim && new Date(fim).getTime() <= new Date(inicio).getTime()) {
      const error = new Error("fim deve ser maior que inicio");
      (error as any).statusCode = 400;
      throw error;
    }

    const { data: existente, error: existenteError } = await supabaseAdmin
      .from("agendamento")
      .select("id")
      .eq("inicio", inicio)
      .not("status", "in", "(RECUSADO,CANCELADO)")
      .maybeSingle();

    if (existenteError) throw existenteError;
    if (existente) {
      const error = new Error("Horario indisponivel");
      (error as any).statusCode = 409;
      throw error;
    }

    const { data, error } = await supabaseAdmin
      .from("agendamento")
      .insert({
        clienteid: null,
        veiculoid: null,
        titulo: boundedString(body?.titulo, "titulo", 120) ?? "Solicitacao pelo site",
        descricao: [boundedString(body?.descricao, "descricao", 2000), veiculoDescricao].filter(Boolean).join("\n") || null,
        inicio,
        fim,
        status: "PENDENTE_APROVACAO",
        origem: "SITE",
        ...solicitante,
      })
      .select("id, status, origem, inicio, fim, solicitante_nome, solicitante_telefone, solicitante_email")
      .single();

    if (error) throw error;

    return NextResponse.json(
      {
        data,
        message: "Solicitacao recebida. A oficina vai analisar e retornar a confirmacao.",
      },
      { status: 201 },
    );
  } catch (e: any) {
    const status =
      ["23505", "23P01"].includes(String(e?.code))
        ? 409
        : e instanceof SyntaxError
          ? 400
          : e?.statusCode ?? 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao solicitar agendamento" }, { status });
  }
}
