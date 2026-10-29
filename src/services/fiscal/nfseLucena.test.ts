// Lucena/PB pelo Ambiente Nacional via Focus: rota liberada antes e depois de
// 01/11/2026, recusa da Focus mostrada como veio, envio sem confirmação e
// reenvio na mesma referência. Rede e banco são falsos; nada sai daqui.
import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

import { BancoFalso } from "./__bancoFalso";
import { POST as reemitir } from "@/app/api/nfse/[id]/reemitir/route";
import { POST as consultar } from "@/app/api/nfse/consultar/[id]/route";
import { POST as cancelar } from "@/app/api/nfse/cancelar/[id]/route";
import { NFSeService } from "@/lib/services/fiscais/nfse-service";
import { resolverPoliticaNFSe } from "@/lib/services/fiscais/nfse-politica";
import { transportDaPolitica } from "@/lib/services/fiscais/nfse-transport";

const LUCENA = {
  id: 1, codigomunicipio: "2508604", regimetributario: "1", ambiente: "HOMOLOGACAO", uf: "PB",
  cnpj: "11222333000181", inscricaomunicipal: "12345",
};

/** Simples em 2026: sem o grupo da Reforma, que só passa a valer em 2027. */
const PADRAO_NACIONAL = {
  codigoTributacaoNacionalIss: "140101",
  tributacaoIss: "1",
  tipoRetencaoIss: "1",
  regimeEspecialTributacao: "0",
};

type Semente = {
  empresa?: Record<string, unknown>[];
  padrao?: Record<string, unknown>;
  nfse?: Record<string, unknown>[];
  config?: Record<string, unknown>[];
};

function banco(semente: Semente = {}) {
  return new BancoFalso(
    {
      empresa: semente.empresa ?? [LUCENA],
      nfse_config: semente.config ?? [{
        empresa_id: 1,
        token: "token-lucena",
        padroes_emissao: { NACIONAL: semente.padrao ?? PADRAO_NACIONAL },
        incluir_garantia_os: false,
      }],
      config_geral: [],
      nfse: semente.nfse ?? [],
    },
  ).instalar();
}

type Chamada = { metodo: string; url: string; corpo: unknown; autorizacao: string };
/** `corpo` vira JSON; `texto` vai cru (o 401 da Focus é text/html); `falha` lança. */
type Resposta = { status?: number; corpo?: unknown; texto?: string } | { falha: Error };

/**
 * Cada método responde com a próxima resposta da sua fila; a última se repete.
 * Assim um teste descreve "o POST caiu, o reenvio recebeu 422" em uma linha.
 */
function focusFalsa(respostas: Partial<Record<"POST" | "GET" | "DELETE", Resposta | Resposta[]>> = {}) {
  const chamadas: Chamada[] = [];
  const usadas: Record<string, number> = {};
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const metodo = String(init?.method ?? "GET") as "POST" | "GET" | "DELETE";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      metodo,
      url: String(url),
      corpo: init?.body ? JSON.parse(String(init.body)) : null,
      autorizacao: headers.Authorization ?? "",
    });
    const fila = ([] as Resposta[]).concat(respostas[metodo] ?? []);
    const indice = Math.min(usadas[metodo] ?? 0, Math.max(fila.length - 1, 0));
    usadas[metodo] = (usadas[metodo] ?? 0) + 1;
    const resposta = fila[indice];
    if (resposta && "falha" in resposta) throw resposta.falha;
    const corpo = resposta?.texto ?? JSON.stringify(resposta?.corpo ?? {});
    return new Response(corpo, { status: resposta?.status ?? (metodo === "POST" ? 202 : 200) });
  });
  return chamadas;
}

const post = (url: string, corpo: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" } });

const consultarNota = (id: number) =>
  consultar(post(`http://localhost/api/nfse/consultar/${id}`, {}), { params: Promise.resolve({ id: String(id) }) });

const reenviarNota = (id: number) =>
  reemitir(new Request(`http://localhost/api/nfse/${id}/reemitir`, { method: "POST" }), { params: Promise.resolve({ id: String(id) }) });

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

describe("Lucena antes de novembro: a tentativa vai para a Focus", () => {
  it("transporte da política está disponível em 13/10/2026", () => {
    const politica = resolverPoliticaNFSe({ codigoMunicipio: "2508604", regimeTributario: "1", dataCompetencia: "2026-10-13" })!;
    const transporte = transportDaPolitica(politica, new NFSeService());
    assert.equal(transporte.disponivel, true);
    assert.equal(transporte.motivoIndisponivel, null);
    assert.equal(transporte.autorizador, "FOCUS_NACIONAL");
  });
});

describe("envio sem confirmação: nunca vira rejeição, nunca ganha referência nova", () => {

  it("nota em processamento sem a marca de incerto não pode ser reenviada", async () => {
    banco({ nfse: [{ id: 5, empresaid: 1, referencia: "OS_700_SRVS_1_1", status: "PROCESSANDO", modelo_emissao: "NACIONAL", erros: null, servico_ids: [1], payload_enviado: { referencia: "x" }, tentativas: [] }] });
    const chamadas = focusFalsa();
    assert.equal((await reenviarNota(5)).status, 400);
    assert.equal(chamadas.length, 0);
  });
});

describe("empresa e token pela nota", () => {
  it("cancelamento em /v2/nfsen com o token da empresa que emitiu", async () => {
    const db = banco({
      empresa: [{ ...LUCENA, id: 1 }, { ...LUCENA, id: 2, cnpj: "99888777000166" }],
      config: [
        { empresa_id: 1, token: "token-empresa-a", padroes_emissao: {} },
        { empresa_id: 2, token: "token-empresa-b", padroes_emissao: {} },
      ],
      nfse: [{ id: 9, empresaid: 2, referencia: "OS_700_SRVS_1_9", status: "AUTORIZADA", modelo_emissao: "NACIONAL", tentativas: [] }],
    });
    const chamadas = focusFalsa({ DELETE: { corpo: { status: "cancelado" } } });
    const resposta = await cancelar(
      post("http://localhost/api/nfse/cancelar/9", { justificativa: "Cancelamento de teste automatizado" }),
      { params: Promise.resolve({ id: "9" }) },
    );
    assert.equal(resposta.status, 200);
    assert.match(chamadas[0].url, /\/v2\/nfsen\/OS_700_SRVS_1_9$/);
    assert.equal(chamadas[0].autorizacao, `Basic ${Buffer.from("token-empresa-b:").toString("base64")}`);
    assert.equal(db.tabela("nfse")[0].status, "CANCELADA");
  });

  it("consulta usa o token e o ambiente da empresa da nota", async () => {
    banco({
      empresa: [{ ...LUCENA, id: 1 }, { ...LUCENA, id: 2, ambiente: "PRODUCAO" }],
      config: [
        { empresa_id: 1, token: "token-empresa-a", padroes_emissao: {} },
        { empresa_id: 2, token: "token-empresa-b", padroes_emissao: {} },
      ],
      nfse: [{ id: 9, empresaid: 2, referencia: "OS_700_SRVS_1_9", status: "PROCESSANDO", modelo_emissao: "NACIONAL", tentativas: [] }],
    });
    const chamadas = focusFalsa({ GET: { corpo: { status: "autorizado" } } });
    await consultarNota(9);
    assert.match(chamadas[0].url, /^https:\/\/api\.focusnfe\.com\.br\/v2\/nfsen\//);
    assert.equal(chamadas[0].autorizacao, `Basic ${Buffer.from("token-empresa-b:").toString("base64")}`);
  });

  it("nota sem empresaid com duas empresas no banco: recusa, sem adivinhar o token", async () => {
    banco({
      empresa: [{ ...LUCENA, id: 1 }, { ...LUCENA, id: 2 }],
      config: [{ empresa_id: 1, token: "token-empresa-a", padroes_emissao: {} }],
      nfse: [{ id: 9, empresaid: null, referencia: "OS_700_SRVS_1_9", status: "AUTORIZADA", modelo_emissao: "NACIONAL", tentativas: [] }],
    });
    const chamadas = focusFalsa();
    const resposta = await cancelar(
      post("http://localhost/api/nfse/cancelar/9", { justificativa: "Cancelamento de teste automatizado" }),
      { params: Promise.resolve({ id: "9" }) },
    );
    assert.equal(resposta.status, 409);
    assert.match((await resposta.json()).message, /mais de uma empresa/);
    assert.equal(chamadas.length, 0);
  });

  it("nota sem empresaid com uma empresa só: usa ela, como antes", async () => {
    banco({ nfse: [{ id: 9, empresaid: null, referencia: "OS_700_SRVS_1_9", status: "PROCESSANDO", modelo_emissao: "NACIONAL", tentativas: [] }] });
    const chamadas = focusFalsa({ GET: { corpo: { status: "autorizado" } } });
    await consultarNota(9);
    assert.equal(chamadas[0].autorizacao, `Basic ${Buffer.from("token-lucena:").toString("base64")}`);
  });

  it("nota municipal antiga continua em /v2/nfse mesmo com a empresa em Lucena", async () => {
    banco({ nfse: [{ id: 3, empresaid: 1, referencia: "OS_1_SRVS_1_3", status: "AUTORIZADA", modelo_emissao: "MUNICIPAL_CABEDELO", tentativas: [] }] });
    const chamadas = focusFalsa({ GET: { corpo: { status: "autorizado" } } });
    await consultarNota(3);
    assert.match(chamadas[0].url, /\/v2\/nfse\/OS_1_SRVS_1_3$/);
  });
});
