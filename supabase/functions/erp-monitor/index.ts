/// <reference lib="deno.ns" />

const TELEGRAM_API = "https://api.telegram.org";
const SUPABASE_API = "https://api.supabase.com/v1/projects";

type Project = {
  name: string;
  ref: string;
  topicEnv: string;
};

type LogRow = {
  logged_at?: string;
  timestamp?: string;
  status_code?: number | string;
  path?: string;
  event_message?: string;
};

type LogResponse = {
  result?: LogRow[];
  error?: string;
};

const PROJECTS: Project[] = [
  {
    name: "Alpha Garage",
    ref: "mbiztfbgsctkuutaldph",
    topicEnv: "TELEGRAM_TOPIC_ALPHA",
  },
  {
    name: "Demir Diesel",
    ref: "lkpwaiynvnfedvxcjmrp",
    topicEnv: "TELEGRAM_TOPIC_DEMIR",
  },
];

const QUERIES = {
  clickhouse: {
    edge: `
      SELECT
        timestamp AS logged_at,
        toInt32OrZero(log_attributes['response.status_code']) AS status_code,
        log_attributes['request.path'] AS path
      FROM logs
      WHERE source = 'edge_logs'
        AND toInt32OrZero(log_attributes['response.status_code']) BETWEEN 500 AND 599
      ORDER BY timestamp DESC
      LIMIT 20
    `,
    postgres: `
      SELECT timestamp AS logged_at, event_message
      FROM logs
      WHERE source = 'postgres_logs'
        AND (
          match(log_attributes['parsed.error_severity'], '(?i)WARNING|ERROR|FATAL|PANIC')
          OR match(event_message, '(?i)warning|error|fatal|panic')
        )
      ORDER BY timestamp DESC
      LIMIT 20
    `,
  },
  legacy: {
    edge: `
      SELECT datetime(timestamp) AS logged_at, status_code, path
      FROM edge_logs
      CROSS JOIN UNNEST(metadata) AS metadata
      CROSS JOIN UNNEST(request) AS request
      CROSS JOIN UNNEST(response) AS response
      WHERE status_code >= 500
      ORDER BY timestamp DESC
      LIMIT 20
    `,
    postgres: `
      SELECT datetime(timestamp) AS logged_at, event_message
      FROM postgres_logs
      WHERE REGEXP_CONTAINS(event_message, r'(?i)(warning|error|fatal|panic)')
      ORDER BY timestamp DESC
      LIMIT 20
    `,
  },
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Secret ausente: ${name}`);
  return value;
}

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/'([^']|'')*'/g, "'[redacted]'")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 350);
}

function windowFor(now = new Date()): { start: string; end: string } {
  const end = new Date(now);
  end.setUTCSeconds(0, 0);
  const start = new Date(end.getTime() - 10 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function queryLogs(
  token: string,
  projectRef: string,
  kind: "edge" | "postgres",
  start: string,
  end: string,
): Promise<LogRow[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const params = new URLSearchParams({
    sql: QUERIES.clickhouse[kind],
    iso_timestamp_start: start,
    iso_timestamp_end: end,
  });
  const modernUrl = `${SUPABASE_API}/${projectRef}/analytics/endpoints/logs?${params}`;
  const modernResponse = await fetch(modernUrl, { headers });
  const modernBody = (await modernResponse.json()) as LogResponse;

  if (modernResponse.ok && !modernBody.error) return modernBody.result ?? [];

  params.set("sql", QUERIES.legacy[kind]);
  const legacyUrl = `${SUPABASE_API}/${projectRef}/analytics/endpoints/logs.all?${params}`;
  const legacyResponse = await fetch(legacyUrl, { headers });
  const legacyBody = (await legacyResponse.json()) as LogResponse;

  if (!legacyResponse.ok || legacyBody.error) {
    throw new Error(
      `Consulta de ${kind} falhou (${legacyResponse.status}): ${legacyBody.error ?? "erro desconhecido"}`,
    );
  }

  return legacyBody.result ?? [];
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  topicId: string,
  text: string,
): Promise<void> {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_thread_id: Number(topicId),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram falhou (${response.status}): ${body.slice(0, 200)}`);
  }
}

function buildAlert(project: Project, edge: LogRow[], postgres: LogRow[]): string {
  const lines = [
    `🚨 <b>${html(project.name)}</b>`,
    `Janela: últimos 10 minutos`,
    `API 5xx: <b>${edge.length}</b>`,
    `Postgres warning/erro: <b>${postgres.length}</b>`,
  ];

  for (const row of edge.slice(0, 5)) {
    const status = html(String(row.status_code ?? "5xx"));
    const path = html(redact(row.path ?? "rota não informada"));
    lines.push(`• API ${status} — <code>${path}</code>`);
  }

  for (const row of postgres.slice(0, 5)) {
    const message = html(redact(row.event_message ?? "mensagem não informada"));
    lines.push(`• Banco — <code>${message}</code>`);
  }

  if (edge.length > 5 || postgres.length > 5) {
    lines.push("Mais ocorrências existem no painel de logs do Supabase.");
  }

  return lines.join("\n").slice(0, 4000);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const cronSecret = requiredEnv("ERP_MONITOR_CRON_SECRET");
    if (request.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabaseToken = requiredEnv("ERP_MONITOR_SUPABASE_TOKEN");
    const botToken = requiredEnv("TELEGRAM_BOT_TOKEN");
    const chatId = requiredEnv("TELEGRAM_ALERT_CHAT_ID");
    const { start, end } = windowFor();
    const results: Record<string, string> = {};

    for (const project of PROJECTS) {
      try {
        const [edge, postgres] = await Promise.all([
          queryLogs(supabaseToken, project.ref, "edge", start, end),
          queryLogs(supabaseToken, project.ref, "postgres", start, end),
        ]);

        if (edge.length || postgres.length) {
          await sendTelegram(
            botToken,
            chatId,
            requiredEnv(project.topicEnv),
            buildAlert(project, edge, postgres),
          );
          results[project.name] = `alerta enviado (${edge.length} API, ${postgres.length} banco)`;
        } else {
          results[project.name] = "sem alertas";
        }
      } catch (error) {
        results[project.name] = error instanceof Error ? error.message : "erro desconhecido";
      }
    }

    return Response.json({ ok: true, window: { start, end }, projects: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
