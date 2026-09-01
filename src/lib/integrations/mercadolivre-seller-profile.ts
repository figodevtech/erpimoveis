export type MercadoLivreSellerProfile = {
  userType: string | null;
  accountStatus: string | null;
  sellingAllowed: boolean | null;
  reputationLevelId: string | null;
  reputationLabel: string;
  powerSellerStatus: string | null;
  powerSellerLabel: string | null;
  completedSales: number | null;
  totalSales: number | null;
  businessEnabled: boolean;
};

export function parseMercadoLivreSellerProfile(value: unknown): MercadoLivreSellerProfile {
  const user = asRecord(value);
  const status = asRecord(user.status);
  const sell = asRecord(status.sell);
  const reputation = asRecord(user.seller_reputation);
  const transactions = asRecord(reputation.transactions);
  const reputationLevelId = nullableText(reputation.level_id);
  const powerSellerStatus = nullableText(reputation.power_seller_status)?.toLowerCase() ?? null;
  const tags = (Array.isArray(user.tags) ? user.tags : []).map((tag) => String(tag).toLowerCase());

  return {
    userType: nullableText(user.user_type),
    accountStatus: nullableText(status.site_status),
    sellingAllowed: typeof sell.allow === "boolean" ? sell.allow : null,
    reputationLevelId,
    reputationLabel: reputationLabel(reputationLevelId),
    powerSellerStatus,
    powerSellerLabel: powerSellerLabel(powerSellerStatus),
    completedSales: nullableNumber(transactions.completed),
    totalSales: nullableNumber(transactions.total),
    businessEnabled: tags.includes("business"),
  };
}

function reputationLabel(levelId: string | null) {
  if (!levelId) return "Vendedor sem reputação";
  const color = levelId.split("_").slice(1).join("_");
  const labels: Record<string, string> = {
    red: "Reputação vermelha",
    orange: "Reputação laranja",
    yellow: "Reputação amarela",
    light_green: "Reputação verde-clara",
    green: "Reputação verde",
  };
  return labels[color] ?? `Reputação ${levelId}`;
}

function powerSellerLabel(status: string | null) {
  if (!status) return null;
  const labels: Record<string, string> = {
    silver: "MercadoLíder Silver",
    gold: "MercadoLíder Gold",
    platinum: "MercadoLíder Platinum",
  };
  return labels[status] ?? `MercadoLíder ${status}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && value !== null && value !== "" ? number : null;
}
