/**
 * Serviço para gerenciamento de Gatilhos (Webhooks) na Focus NFe.
 */
import { assertValidCnpj } from "@/lib/fiscal-identifiers";

export class FocusWebhookService {
  private apiUrl: string;
  private token: string;

  constructor() {
    this.token = "";
    this.apiUrl = "";
  }

  /**
   * Configura o ambiente baseado na tabela empresa.
   */
  configurarAmbiente(ambiente: "PRODUCAO" | "HOMOLOGACAO" | string) {
    if (ambiente === "PRODUCAO") {
      this.token = process.env.FOCUS_NFE_API_TOKEN || "";
      this.apiUrl = "https://api.focusnfe.com.br";
    } else {
      this.token = process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO || "";
      this.apiUrl = "https://homologacao.focusnfe.com.br";
    }
  }

  private getAuthHeader() {
    return `Basic ${Buffer.from(this.token + ":").toString("base64")}`;
  }

  /**
   * Lista todos os webhooks cadastrados.
   */
  async listarHooks() {
    if (!this.token) throw new Error("Token Focus NFe não configurado.");

    const res = await fetch(`${this.apiUrl}/v2/hooks`, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    return await res.json().catch(() => []);
  }

  /**
   * Cria um novo webhook.
   * Eventos comuns: 'nfe', 'nfse', 'nfsen', 'inutilizacao', 'cte', 'mdfe', 'nfcom'
   */
  async criarHook(event: string, url: string, cnpj?: string) {
    if (!this.token) throw new Error("Token Focus NFe não configurado.");

    const payload: any = {
      event,
      url,
    };

    if (cnpj) {
      payload.cnpj = assertValidCnpj(cnpj);
    }

    const res = await fetch(`${this.apiUrl}/v2/hooks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        message: json?.mensagem || "Erro ao criar webhook na Focus NFe",
        erros: json?.erros || [json],
      };
    }

    return {
      ok: true,
      dados: json,
    };
  }

  /**
   * Remove um webhook pelo ID.
   */
  async deletarHook(hookId: string) {
    if (!this.token) throw new Error("Token Focus NFe não configurado.");

    const res = await fetch(`${this.apiUrl}/v2/hooks/${hookId}`, {
      method: "DELETE",
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        message: json?.mensagem || "Erro ao deletar webhook na Focus NFe",
      };
    }

    return {
      ok: true,
      deleted: json?.deleted,
    };
  }
}
