export function statusDoEventoStone(tipo: unknown): "PAGO" | "ESTORNADO" | "RECUSADO" | null {
  switch (tipo) {
    case "charge.paid": return "PAGO";
    case "charge.refunded": return "ESTORNADO";
    case "charge.payment_failed": return "RECUSADO";
    default: return null;
  }
}

export function identificadoresStone(dados: Record<string, any>): string[] {
  return [...new Set([dados.order?.id, dados.order?.code, dados.id, dados.code]
    .filter((id): id is string => typeof id === "string" && id.length > 0))];
}
