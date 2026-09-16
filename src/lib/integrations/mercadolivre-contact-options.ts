export type ContactOption = { id: string; label: string; templateId: string | null; charLimit: number; deliveryVariables?: { start: string; end: string } };
const labels: Record<string, string> = {
  REQUEST_VARIANTS: "Confirmar características do produto",
  REQUEST_BILLING_INFO: "Solicitar dados de faturamento",
  SEND_INVOICE_LINK: "Enviar link de faturamento",
  OTHER: "Outro assunto",
  DELIVERY_PROMISE: "Informar horário de entrega (Flex)",
};

export function contactOptions(guide: unknown): ContactOption[] {
  const options = (guide as { options?: unknown[] } | null)?.options;
  if (!Array.isArray(options)) return [];
  return options.flatMap<ContactOption>((raw) => {
    const option = raw as Record<string, any> | null;
    if (!option || !labels[option.id] || option.enabled !== true || option.actionable !== true || !(option.cap_available > 0)) return [];
    if (option.id === "DELIVERY_PROMISE" && String(option.type).toLowerCase() === "template") {
      const template = Array.isArray(option.templates) ? option.templates.find((t: any) =>
        typeof t?.id === "string" && Array.isArray(t.vars) && t.vars.length === 2 &&
        t.vars.every((v: any) => v?.type === "NUMBER") &&
        t.vars.some((v: any) => v.id === `${t.id}___VAR___INIT`) &&
        t.vars.some((v: any) => v.id === `${t.id}___VAR___LIMIT`)) : null;
      return template ? [{ id: option.id, label: labels[option.id], templateId: template.id, charLimit: 0,
        deliveryVariables: { start: `${template.id}___VAR___INIT`, end: `${template.id}___VAR___LIMIT` } }] : [];
    }
    if (option.type === "free_text" && ["OTHER", "SEND_INVOICE_LINK"].includes(option.id)) {
      if (!Number.isInteger(option.char_limit) || option.char_limit <= 0) return [];
      return [{ id: option.id, label: labels[option.id], templateId: null, charLimit: Math.min(option.char_limit, 350) }];
    }
    if (option.type !== "template" || !["REQUEST_VARIANTS", "REQUEST_BILLING_INFO"].includes(option.id)) return [];
    const template = Array.isArray(option.templates) ? option.templates.find((t: any) => typeof t?.id === "string" && (t.vars == null || (Array.isArray(t.vars) && t.vars.length === 0))) : null;
    return template ? [{ id: option.id, label: labels[option.id], templateId: template.id, charLimit: 0 }] : [];
  });
}

export function contactPayload(guide: unknown, id: string, text: string, delivery?: { start?: unknown; end?: unknown }) {
  const option = contactOptions(guide).find(item => item.id === id);
  const invalid = (message: string) => Object.assign(new Error(message), { statusCode: 422 });
  if (!option) throw invalid("Este motivo não está disponível. Consulte novamente as opções do Mercado Livre.");
  if (option.deliveryVariables) {
    const start = delivery?.start;
    const end = delivery?.end;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 23 || start >= end) {
      throw invalid("Informe horas inteiras entre 0 e 23, com horário final maior que o inicial.");
    }
    return { option_id: option.id, template_id: option.templateId, vars: [
      { id: option.deliveryVariables.start, value: start }, { id: option.deliveryVariables.end, value: end },
    ] };
  }
  if (option.templateId) return { option_id: option.id, template_id: option.templateId };
  if (!text.trim() || text.trim().length > option.charLimit) throw invalid(`Informe uma mensagem de até ${option.charLimit} caracteres.`);
  return { option_id: option.id, text: text.trim() };
}
