import { listingSummary, staysConfig, staysId } from "./stays-contract";

export class StaysError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export class StaysClient {
  readonly config: Extract<ReturnType<typeof staysConfig>, { configured: true }>;
  constructor(env: Record<string, string | undefined> = process.env, private fetcher: typeof fetch = fetch) {
    let config;
    try { config = staysConfig(env); }
    catch { throw new StaysError("O endereço da conta Stays está configurado incorretamente.", 503); }
    if (!config.configured) throw new StaysError("Configure o endereço e as credenciais da API Stays no servidor.", 503);
    this.config = config;
  }
  async get(path: string, query = new URLSearchParams()) {
    if (!this.config.configured) throw new StaysError("Conexão Stays não configurada.", 503);
    const url = new URL(`/external/v1/${path}`, this.config.origin);
    url.search = query.toString();
    let response: Response;
    try { response = await this.fetcher(url, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}` } }); }
    catch { throw new StaysError("Não foi possível acessar a Stays. Tente novamente."); }
    if (!response.ok) throw new StaysError(response.status === 401 || response.status === 403 ? "A Stays recusou o acesso. Confira as credenciais e a ativação da API Externa." : response.status === 429 ? "Limite de consultas da Stays atingido. Tente novamente em alguns minutos." : "A Stays não conseguiu concluir a consulta.");
    if (!response.body) throw new StaysError("A Stays retornou uma resposta vazia.");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let size = 0, body = "";
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) throw new StaysError("Resposta da Stays maior que o permitido.");
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
      return JSON.parse(body) as unknown;
    } catch (error) { if (error instanceof StaysError) throw error; throw new StaysError("A Stays retornou uma resposta incompleta ou inválida."); }
    finally { await reader.cancel().catch(() => undefined); }
  }
  async pages(path: string, params = new URLSearchParams()) {
    const rows: unknown[] = [], ids = new Set<string>(), deadline = Date.now() + 40000;
    for (let skip = 0; skip < 10000; skip += 20) {
      if (Date.now() > deadline) throw new StaysError("A consulta à Stays demorou demais. Nenhum bloqueio foi liberado.");
      const query = new URLSearchParams(params); query.set("skip", String(skip)); query.set("limit", "20");
      const page = await this.get(path, query);
      if (!Array.isArray(page) || page.length > 20) throw new StaysError("Formato de paginação inesperado na Stays.");
      for (const row of page) {
        const id = typeof row === "object" && row !== null && "_id" in row ? String(row._id) : "";
        if (!id || ids.has(id)) throw new StaysError("Paginação inconsistente na Stays. Tente novamente.");
        ids.add(id); rows.push(row);
      }
      if (page.length < 20) return rows;
    }
    throw new StaysError("A consulta excedeu o limite de paginação. Nenhum bloqueio foi liberado.");
  }
  async listings() { return (await this.pages("content/listings")).map(listingSummary); }
  async listing(id: string) { return listingSummary(await this.get(`content/listings/${staysId.parse(id)}`)); }
  async reservations(listingId: string, from: string, to: string) {
    const query = new URLSearchParams({ listingId: staysId.parse(listingId), from, to, dateType: "included" });
    for (const type of ["reserved", "booked", "contract", "blocked", "maintenance"]) query.append("type", type);
    return this.pages("booking/reservations", query);
  }
}
