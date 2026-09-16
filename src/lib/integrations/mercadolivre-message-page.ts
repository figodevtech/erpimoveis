export const MESSAGE_ORDER_PAGE_SIZE = 10;

export function parseMessagePage(params: URLSearchParams) {
  const positiveInteger = (name: string) => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
      throw Object.assign(new Error(`Parâmetro ${name} inválido.`), { statusCode: 400 });
    }
    return value;
  };
  return {
    orderDbId: positiveInteger("orderDbId"),
    beforeId: positiveInteger("beforeId"),
    limit: Math.min(positiveInteger("limit") ?? 20, 50),
  };
}

export function messageOrderPage<T extends { id: number }>(rows: T[]) {
  const data = rows.slice(0, MESSAGE_ORDER_PAGE_SIZE);
  return { data, nextCursor: rows.length > MESSAGE_ORDER_PAGE_SIZE ? data[data.length - 1].id : null };
}
