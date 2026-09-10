/**
 * Tradução do estado de um anúncio Mercado Livre.
 *
 * `status` sozinho não explica nada ao vendedor: "under_review" e "closed" são
 * a mesma palavra para dezenas de motivos diferentes. Quem carrega o motivo é o
 * `sub_status`, e o texto humano vem de
 * `GET /moderations/last_moderation/{ITEM_ID}-ITM`.
 *
 * Fonte: "Sincronização e modificação de publicações" (fluxo e estados das
 * publicações) e "Moderações com pausado".
 */

export type MercadoLivreListingStatusInfo = {
  status: string;
  subStatus: string[];
  /** Rótulo curto para o badge. */
  label: string;
  /** Frase explicando o estado, quando o sub_status permite. */
  detail: string | null;
  tone: "active" | "paused" | "review" | "closed" | "unknown";
  /** O vendedor precisa agir para o anúncio voltar. */
  requiresAction: boolean;
  /** Excluído em definitivo: não republica nem reativa. */
  deleted: boolean;
  /** Encerrado pelo Mercado Livre, não pelo vendedor. */
  closedByMercadoLivre: boolean;
};

const SUB_STATUS_DETAIL: Record<string, string> = {
  // under_review
  warning: "O anúncio segue ativo, mas o Mercado Livre apontou uma correção pendente. Sem correção em 2 dias ele é ocultado.",
  waiting_for_patch: "O Mercado Livre ocultou o anúncio até que a infração apontada seja corrigida.",
  held: "O anúncio está oculto aguardando revisão manual do Mercado Livre.",
  pending_documentation: "O anúncio está oculto até que a documentação solicitada pelo Mercado Livre seja enviada.",
  forbidden: "O Mercado Livre cancelou o anúncio por moderação. Nesse estado ele só pode ser excluído.",
  // paused
  out_of_stock: "Pausado por falta de estoque. Volta a ficar ativo sozinho quando houver unidades.",
  paused_by_seller: "Pausado pelo vendedor. Não reativa sozinho, nem depois de repor o estoque.",
  moderation_penalty: "Pausado preventivamente pelo Mercado Livre. Revise o apontamento e reative o anúncio.",
  picture_downloading_pending: "Pausado até o Mercado Livre terminar de baixar as imagens. Reativa sozinho em seguida.",
  // closed
  expired: "O anúncio chegou à data de encerramento ainda com estoque.",
  deleted: "Anúncio excluído em definitivo. Não é possível reativar nem republicar.",
  suspended: "Anúncio suspenso pelo Mercado Livre.",
  freezed: "Anúncio congelado pelo Mercado Livre.",
};

/** sub_status que indicam encerramento por decisão do Mercado Livre, não do vendedor. */
const CLOSED_BY_MERCADO_LIVRE = new Set(["waiting_for_patch", "held", "suspended", "freezed", "forbidden"]);

const ACTION_REQUIRED = new Set([
  "warning",
  "waiting_for_patch",
  "pending_documentation",
  "moderation_penalty",
  "paused_by_seller",
  "forbidden",
]);

export function describeMercadoLivreListingStatus(input: {
  status?: unknown;
  subStatus?: unknown;
  tags?: unknown;
}): MercadoLivreListingStatusInfo {
  const status = normalize(input.status);
  const subStatus = unique([...toList(input.subStatus), ...toList(input.tags)]);
  const deleted = subStatus.includes("deleted");

  const label = deleted
    ? "Excluído"
    : status === "active"
      ? "Ativo"
      : status === "paused"
        ? "Pausado"
        : status === "under_review"
          ? "Em análise pelo Mercado Livre"
          : status === "closed"
            ? subStatus.some((entry) => CLOSED_BY_MERCADO_LIVRE.has(entry))
              ? "Finalizado pelo Mercado Livre"
              : "Finalizado"
            : status === "inactive"
              ? "Inativo"
              : status === "payment_required"
                ? "Aguardando pagamento"
                : status
                  ? status
                  : "Sem status";

  const detail = subStatus.map((entry) => SUB_STATUS_DETAIL[entry]).find(Boolean) ?? null;

  return {
    status,
    subStatus,
    label,
    detail,
    tone:
      status === "active"
        ? "active"
        : status === "paused" || status === "payment_required"
          ? "paused"
          : status === "under_review"
            ? "review"
            : status === "closed" || status === "inactive"
              ? "closed"
              : "unknown",
    requiresAction: subStatus.some((entry) => ACTION_REQUIRED.has(entry)),
    deleted,
    closedByMercadoLivre: status === "closed" && subStatus.some((entry) => CLOSED_BY_MERCADO_LIVRE.has(entry)),
  };
}

export type MercadoLivreModeration = {
  code: string | null;
  reason: string | null;
  remedy: string | null;
  evidence: string[];
  createdAt: string | null;
};

/**
 * Normaliza `GET /moderations/last_moderation/{ITEM_ID}-ITM`. As frases vêm
 * prontas em português dentro de `wordings`, então são exibidas como o Mercado
 * Livre escreveu — é o texto que o vendedor vê no painel dele.
 */
export function normalizeMercadoLivreModeration(raw: unknown): MercadoLivreModeration | null {
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;

  const wordings = Array.isArray(record.wordings) ? record.wordings : [];
  const wordingValue = (type: string) => {
    const found = wordings.find(
      (item) => item && typeof item === "object" && normalize((item as Record<string, unknown>).type) === type,
    ) as Record<string, unknown> | undefined;
    const value = String(found?.value ?? "").trim();
    return value || null;
  };

  const evidence = (Array.isArray(record.evidence) ? record.evidence : [])
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      return String((item as Record<string, unknown>).text_matched ?? "").trim();
    })
    .filter(Boolean);

  const code = String(record.name ?? "").trim() || null;
  const reason = wordingValue("reason");
  const remedy = wordingValue("remedy");
  if (!code && !reason && !remedy && !evidence.length) return null;

  return {
    code,
    reason,
    remedy,
    evidence,
    createdAt: String(record.date_created ?? "").trim() || null,
  };
}

export type ModerationTextSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

const ANCHOR = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * As frases de moderação vêm com HTML embutido — o Mercado Livre inclui
 * âncoras como "Verifique as categorias possíveis <a href='...'>Aqui</a>".
 * Renderizar isso como texto mostra a marcação crua; injetar o HTML confiaria
 * numa string de terceiro. Então extraímos só os links http(s) e descartamos
 * qualquer outra tag.
 */
export function parseModerationText(value: string | null | undefined): ModerationTextSegment[] {
  const raw = String(value ?? "");
  if (!raw.trim()) return [];

  const segments: ModerationTextSegment[] = [];
  let cursor = 0;

  ANCHOR.lastIndex = 0;
  for (let match = ANCHOR.exec(raw); match; match = ANCHOR.exec(raw)) {
    pushText(segments, raw.slice(cursor, match.index));
    const href = (match[1] ?? match[2] ?? "").trim();
    const label = cleanText(match[3]) || href;
    if (/^https?:\/\//i.test(href)) segments.push({ type: "link", text: label, href });
    else pushText(segments, label);
    cursor = match.index + match[0].length;
  }
  pushText(segments, raw.slice(cursor));

  return segments;
}

function pushText(segments: ModerationTextSegment[], value: string) {
  const text = cleanText(value);
  if (text) segments.push({ type: "text", text });
}

function cleanText(value: string) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export type MercadoLivreCategoryOption = {
  id: string;
  name: string;
  path: string | null;
  domainId: string | null;
  searchUrl: string | null;
  /** A categoria aceita Mercado Envios 2. */
  hasMe2: boolean;
  /** Confiança do categorizador, quando é uma sugestão. */
  score: number | null;
};

export type MercadoLivreWrongCategoryDiagnosis = {
  itemId: string | null;
  title: string | null;
  current: MercadoLivreCategoryOption | null;
  suggestions: MercadoLivreCategoryOption[];
};

/**
 * Normaliza o diagnóstico de categoria que o próprio Mercado Livre indica no
 * texto da moderação (`/tagging/wrong-domain/prustomer/{ITEM_ID}`).
 *
 * As sugestões vêm de um categorizador automático e nem sempre fazem sentido —
 * por isso guardamos o `score` e a trilha completa, para o vendedor julgar em
 * vez de confiar na ordem.
 */
export function normalizeWrongCategoryDiagnosis(raw: unknown): MercadoLivreWrongCategoryDiagnosis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const current = normalizeCategoryOption(record.category);
  const suggestions = (Array.isArray(record.suggested_categories) ? record.suggested_categories : [])
    .map((entry) => normalizeCategoryOption(entry))
    .filter((entry): entry is MercadoLivreCategoryOption => Boolean(entry))
    .filter((entry) => entry.id !== current?.id)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (!current && !suggestions.length) return null;

  return {
    itemId: textOrNull(record.item_id),
    title: textOrNull(record.title),
    current,
    suggestions,
  };
}

function normalizeCategoryOption(value: unknown): MercadoLivreCategoryOption | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = textOrNull(record.id);
  const name = textOrNull(record.name);
  if (!id || !name) return null;

  const score = Number(record.score);
  return {
    id,
    name,
    path: textOrNull(record.path),
    domainId: textOrNull(record.domain_id),
    searchUrl: textOrNull(record.search_url),
    hasMe2: record.has_me2 === true,
    score: Number.isFinite(score) ? score : null,
  };
}

function textOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

/** Referência exigida pelo endpoint de moderações. */
export function moderationReferenceId(itemId: string) {
  return `${String(itemId ?? "").trim().toUpperCase()}-ITM`;
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function toList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(normalize).filter(Boolean);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
