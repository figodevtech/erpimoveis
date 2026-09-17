/**
 * Qualidade do anúncio como fração de 0 a 1, que é o que a coluna `health` guarda.
 *
 * O campo `health` do item vem da API /health, que o Mercado Livre descontinuou
 * em fevereiro de 2025, e hoje volta nulo. Como o vínculo mantinha o último valor
 * quando ele vinha nulo, o ERP ficou mostrando uma nota antiga. A nota que o
 * vendedor vê no Mercado Livre é `score` (0 a 100) em `/item/{id}/performance`,
 * que para anúncio de User Product já responde com a nota do User Product.
 * O campo legado só vale enquanto a nota nova ainda não foi calculada.
 */
export function mercadoLivreListingHealth(performance: unknown, legacyHealth?: unknown) {
  const score = finiteNumber((performance as { score?: unknown } | null | undefined)?.score);
  if (score != null) return Math.min(Math.max(score, 0), 100) / 100;
  return finiteNumber(legacyHealth);
}

export type MercadoLivreQualityGoal = {
  key: string;
  title: string;
  detail: string | null;
  group: string | null;
  mode: string | null;
  label: string | null;
  link: string | null;
};

export type MercadoLivreListingQuality = {
  score: number | null;
  level: string | null;
  calculatedAt: string | null;
  goals: MercadoLivreQualityGoal[];
};

/**
 * Nota e objetivos pendentes do anúncio, como o Mercado Livre mostra ao vendedor.
 *
 * Cada `bucket` reúne um grupo de objetivos ("Dados do produto", "Condições de
 * venda") e cada `variable` pendente é um objetivo. O texto explicativo fica na
 * primeira `rule`, que também traz o link para concluir o objetivo.
 */
export function mercadoLivreListingQuality(performance: unknown): MercadoLivreListingQuality | null {
  if (!performance || typeof performance !== "object") return null;
  const source = performance as Record<string, any>;
  const buckets = Array.isArray(source.buckets) ? source.buckets : [];
  const goals: MercadoLivreQualityGoal[] = [];

  for (const bucket of buckets) {
    for (const variable of Array.isArray(bucket?.variables) ? bucket.variables : []) {
      if (!pending(variable?.status)) continue;
      const rules = Array.isArray(variable?.rules) ? variable.rules : [];
      const rule = rules.find((candidate: any) => pending(candidate?.status)) ?? rules[0] ?? null;
      const title = text(variable?.title) ?? text(rule?.wordings?.title);
      if (!title) continue;
      const detail = text(rule?.wordings?.title);
      goals.push({
        key: text(variable?.key) ?? text(rule?.key) ?? title,
        title,
        detail: detail && detail !== title ? detail : null,
        group: text(bucket?.title),
        mode: text(rule?.mode),
        label: text(rule?.wordings?.label),
        link: text(rule?.wordings?.link),
      });
    }
  }

  const score = finiteNumber(source.score);
  return {
    score: score == null ? null : Math.min(Math.max(score, 0), 100),
    level: text(source.level_wording) ?? text(source.level),
    calculatedAt: text(source.calculated_at),
    goals,
  };
}

function pending(status: unknown) {
  return String(status ?? "").toUpperCase() !== "COMPLETED";
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
