// Gera um UUID com fallback para ambientes sem Web Crypto (ex.: alguns WebViews/Safari antigos).
export function safeUUID(): string {
  const g: any = globalThis as any;

  // 1) Browser moderno
  if (typeof g?.crypto?.randomUUID === "function") {
    return g.crypto.randomUUID();
  }

  // 2) Web Crypto sem randomUUID
  if (typeof g?.crypto?.getRandomValues === "function") {
    const arr = new Uint8Array(16);
    g.crypto.getRandomValues(arr);
    // RFC 4122 v4
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    const hex = Array.from(arr, toHex).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // 3) Fallback simples (não criptográfico) — bom para chaves temporárias de UI e nomes de arquivos
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
