/** Reject HTML/error pages without leaking their contents into a toast. */
export async function readJsonResponse(response: Response, service = "Servidor") {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid response");
    return parsed;
  } catch {
    throw new Error(`${service} respondeu HTTP ${response.status} sem JSON válido. Verifique o endereço, a disponibilidade e se a rota foi publicada.`);
  }
}
