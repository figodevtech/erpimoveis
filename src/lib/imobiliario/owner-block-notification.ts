import type { SystemNotificationInput } from "@/lib/system-notifications";

/** Bloqueio de uso próprio que o proprietário criou, alterou ou cancelou pelo site. */
export type OwnerBlockEvent = {
  acao: "CRIADO" | "ALTERADO" | "CANCELADO";
  ocupacaoId: number;
  imovelId: number;
  imovelTitulo: string;
  proprietarioId: number;
  proprietarioNome: string;
  /** Período do bloqueio como em imovel_ocupacao: fim exclusivo (dia seguinte ao último). */
  inicio: string;
  fim: string;
  /** Período antes da alteração (só em ALTERADO). */
  anterior?: { inicio: string; fim: string };
  /** Marca da alteração (updated_at): cada alteração vira um aviso; a repetição da mesma, não. */
  versao?: string;
};

const DAY = 86_400_000;
const civil = (value: string) => Date.parse(`${value}T12:00:00Z`);
const br = (value: string) => new Date(civil(value)).toLocaleDateString("pt-BR", { timeZone: "UTC" });

/** "20/12/2026 a 27/12/2026 (8 dias)": o último dia é o que o proprietário escolheu (fim − 1). */
export function ownerBlockPeriod(inicio: string, fim: string) {
  const dias = Math.round((civil(fim) - civil(inicio)) / DAY);
  const ultimo = new Date(civil(fim) - DAY).toISOString().slice(0, 10);
  const quantidade = `${dias} ${dias === 1 ? "dia" : "dias"}`;
  return dias === 1 ? `${br(inicio)} (${quantidade})` : `${br(inicio)} a ${br(ultimo)} (${quantidade})`;
}

/** Aviso para a equipe: o calendário do imóvel mudou por ação do proprietário no site. */
export function ownerBlockNotification(event: OwnerBlockEvent): SystemNotificationInput {
  const quem = event.proprietarioNome.trim() || "O proprietário";
  const imovel = event.imovelTitulo.trim() || `Imóvel #${event.imovelId}`;
  const periodo = ownerBlockPeriod(event.inicio, event.fim);
  const texto = {
    CRIADO: {
      title: "Proprietário bloqueou período para uso próprio",
      message: `${quem} bloqueou ${imovel} para uso próprio: ${periodo}.`,
    },
    ALTERADO: {
      title: "Proprietário alterou bloqueio de uso próprio",
      message: `${quem} alterou o bloqueio de uso próprio de ${imovel}${event.anterior ? ` de ${ownerBlockPeriod(event.anterior.inicio, event.anterior.fim)}` : ""} para ${periodo}.`,
    },
    CANCELADO: {
      title: "Proprietário cancelou bloqueio de uso próprio",
      message: `${quem} cancelou o bloqueio de uso próprio de ${imovel}: ${periodo}. O período voltou a ficar livre.`,
    },
  }[event.acao];
  return {
    category: "IMOBILIARIO",
    priority: "INFO",
    ...texto,
    // Abre o imóvel direto na aba Disponibilidade, onde o bloqueio aparece.
    href: `/imoveis?abrir=${event.imovelId}&aba=disponibilidade`,
    source: "SITE_OWNER_BLOCK",
    sourceEventId: `BLOQUEIO:${event.ocupacaoId}:${event.acao}${event.acao === "ALTERADO" && event.versao ? `:${event.versao}` : ""}`,
    metadata: {
      acao: event.acao,
      ocupacaoId: event.ocupacaoId,
      imovelId: event.imovelId,
      proprietarioId: event.proprietarioId,
      inicio: event.inicio,
      fim: event.fim,
      ...(event.anterior ? { anterior: event.anterior } : {}),
    },
  };
}
