// Lucena/PB pelo Emissor Nacional via Focus: rota, bloqueio antes de
// 01/11/2026 e envio sem resposta. Rede e banco são falsos; nada sai daqui.
import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

import { BancoFalso } from "./__bancoFalso";
import { POST as emitirDeOs } from "@/app/api/nfse/de-os/[id]/route";
import { POST as reemitir } from "@/app/api/nfse/[id]/reemitir/route";
import { POST as consultar } from "@/app/api/nfse/consultar/[id]/route";
import { POST as cancelar } from "@/app/api/nfse/cancelar/[id]/route";
import { NFSeService } from "@/lib/services/fiscais/nfse-service";
import { MENSAGEM_LUCENA_AGUARDANDO_NACIONAL, resolverPoliticaNFSe } from "@/lib/services/fiscais/nfse-politica";
import { transportDaPolitica } from "@/lib/services/fiscais/nfse-transport";
import { CODIGO_RESULTADO_INCERTO } from "@/lib/services/fiscais/nfse-registro";

const LUCENA = {
  id: 1, codigomunicipio: "2508604", regimetributario: "1", ambiente: "HOMOLOGACAO", uf: "PB",
  cnpj: "11222333000181", inscricaomunicipal: "12345",
};

const CLIENTE = {
  id: 10, tipopessoa: "JURIDICA", cpfcnpj: "11444777000161", nomerazaosocial: "TOMADOR DE TESTE LTDA",
  endereco: "RUA DE TESTE", endereconumero: "100", bairro: "CENTRO", codigomunicipio: "2507507", estado: "PB", cep: "58000000",
};

const OS = {
  id: 700, status: "CONCLUIDO", clienteid: CLIENTE.id, observacoes_fiscais: null, garantia: null, cliente: CLIENTE,
  osservico: [
    { servicoid: 1, quantidade: 1, precounitario: 200, subtotal: 200, servico: { id: 1, descricao: "REVISAO", itemlistaservico: "14.01" } },
  ],
};

/** Simples em 2026: sem o grupo da Reforma, que só passa a valer em 2027. */
const PADRAO_NACIONAL = {
  codigoTributacaoNacionalIss: "140101",
  tributacaoIss: "1",
  tipoRetencaoIss: "1",
  regimeEspecialTributacao: "0",
};

const CODIGOS = { codigo_tributacao_nacional_iss: "140101", tributacao_iss: 1, tipo_retencao_iss: 1 };

function banco(semente: { empresa?: Record<string, unknown>[]; padrao?: Record<string, unknown>; nfse?: Record<string, unknown>[]; config?: Record<string, unknown>[] } = {}) {
  return new BancoFalso(
    {
      empresa: semente.empresa ?? [LUCENA],
      nfse_config: semente.config ?? [{
        empresa_id: 1,
        token: "token-lucena",
        padroes_emissao: { NACIONAL: semente.padrao ?? PADRAO_NACIONAL },
        incluir_garantia_os: false,
      }],
      ordemservico: [OS],
      config_geral: [],
      nfse: semente.nfse ?? [],
      nfse_os_servico_vinculo: [],
    },
    { vincular_nfse_os: () => ({}) },
  ).instalar();
}

type Chamada = { metodo: string; url: string; corpo: unknown; autorizacao: string };

/** Cada método responde com o que o teste mandar; função = comportamento livre. */
function focusFalsa(respostas: Record<string, { status?: number; corpo?: unknown } | (() => never)> = {}) {
  const chamadas: Chamada[] = [];
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const metodo = String(init?.method ?? "GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      metodo,
      url: String(url),
      corpo: init?.body ? JSON.parse(String(init.body)) : null,
      autorizacao: headers.Authorization ?? "",
    });
    const resposta = respostas[metodo];
    if (typeof resposta === "function") return resposta();
    return new Response(JSON.stringify(resposta?.corpo ?? {}), {
      status: resposta?.status ?? (metodo === "POST" ? 202 : 200),
    });
  });
  return chamadas;
}

const post = (url: string, corpo: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" } });

const emitir = () => emitirDeOs(
  post("http://localhost/api/nfse/de-os/700", { servicos: [{ osservicoId: 1, valor: 200 }], codigosFiscais: CODIGOS }),
  { params: Promise.resolve({ id: "700" }) },
);

const consultarNota = (id: number) =>
  consultar(post(`http://localhost/api/nfse/consultar/${id}`, {}), { params: Promise.resolve({ id: String(id) }) });

function fixarHoje(iso: string) {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

describe("Lucena antes de 01/11/2026", () => {
  it("L1: emissão recusada com o motivo, sem gravar nota nem chamar a Focus", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    const chamadas = focusFalsa();

    const resposta = await emitir();
    const corpo = await resposta.json();
    assert.equal(resposta.status, 422);
    assert.equal(corpo.codigo, "TRANSPORTE_INDISPONIVEL");
    assert.equal(corpo.message, MENSAGEM_LUCENA_AGUARDANDO_NACIONAL);
    assert.equal(corpo.autorizador, "FOCUS_NACIONAL");
    assert.equal(chamadas.length, 0);
    assert.equal(db.tabela("nfse").length, 0);
  });

  it("transporte bloqueado nunca chama a rede, nem se alguém insistir", async () => {
    const chamadas = focusFalsa();
    const politica = resolverPoliticaNFSe({ codigoMunicipio: "2508604", regimeTributario: "1", dataCompetencia: "2026-10-31" })!;
    const transporte = transportDaPolitica(politica, new NFSeService());
    assert.equal(transporte.disponivel, false);
    assert.equal(transporte.motivoIndisponivel, MENSAGEM_LUCENA_AGUARDANDO_NACIONAL);
    await assert.rejects(() => transporte.emitir({}), /Lucena/);
    assert.equal(chamadas.length, 0);
  });
});

describe("Lucena a partir de 01/11/2026", () => {
  it("T1/T2/L2: DPS em /v2/nfsen, nota fica PROCESSANDO até a consulta autorizar", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    const db = banco();
    const chamadas = focusFalsa({
      POST: { corpo: { status: "processando_autorizacao" } },
      GET: { corpo: { status: "autorizado", numero: "15", codigo_verificacao: "ABC123" } },
    });

    const resposta = await emitir();
    assert.equal(resposta.status, 202, JSON.stringify(await resposta.clone().json()));
    assert.match(chamadas[0].url, /^https:\/\/homologacao\.focusnfe\.com\.br\/v2\/nfsen\?ref=OS_700_SRVS_1_/);
    const enviado = chamadas[0].corpo as Record<string, unknown>;
    assert.equal(enviado.codigo_municipio_emissora, 2508604);
    assert.equal(enviado.codigo_municipio_prestacao, "2508604");
    assert.equal(enviado.cnpj_prestador, "11222333000181");
    assert.equal(enviado.codigo_opcao_simples_nacional, 3);
    assert.equal(enviado.regime_tributario_simples_nacional, 1);
    assert.equal(enviado.data_competencia, "2026-11-02");
    // Simples em 2026: o grupo da Reforma não vai.
    assert.equal("codigo_indicador_operacao" in enviado, false);
    assert.equal("ibs_cbs_situacao_tributaria" in enviado, false);

    const nota = db.tabela("nfse")[0];
    assert.equal(nota.modelo_emissao, "NACIONAL");
    assert.equal(nota.status, "PROCESSANDO");

    await consultarNota(Number(nota.id));
    assert.equal(db.tabela("nfse")[0].status, "AUTORIZADA");
    assert.equal(db.tabela("nfse")[0].numero, "15");
    assert.ok(chamadas.every((c) => c.url.includes("/v2/nfsen")));
  });

  it("L3: CRT 2 sem regime de apuração no padrão — recusada antes de gravar ou enviar", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    const db = banco({ empresa: [{ ...LUCENA, regimetributario: "2" }] });
    const chamadas = focusFalsa();
    const resposta = await emitir();
    assert.equal(resposta.status, 400);
    assert.match((await resposta.json()).message, /regime de apura/);
    assert.equal(chamadas.length, 0);
    assert.equal(db.tabela("nfse").length, 0);
  });

  it("L4: CRT 2 com apuração cadastrada leva o valor do padrão, sem presumir", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    banco({ empresa: [{ ...LUCENA, regimetributario: "2" }], padrao: { ...PADRAO_NACIONAL, regimeApuracaoSimplesNacional: "3" } });
    const chamadas = focusFalsa({ POST: { corpo: { status: "processando_autorizacao" } } });
    const resposta = await emitir();
    assert.equal(resposta.status, 202);
    const enviado = chamadas[0].corpo as Record<string, unknown>;
    assert.equal(enviado.codigo_opcao_simples_nacional, 3);
    assert.equal(enviado.regime_tributario_simples_nacional, 3);
  });

  it("T3: recusa da Focus fica gravada inteira, sem caminho alternativo", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    const db = banco();
    const erros = [{ codigo: "E0039", mensagem: "O município emissor informado na DPS deve estar parametrizado para utilizar os emissores públicos nacionais" }];
    const chamadas = focusFalsa({ POST: { status: 422, corpo: { codigo: "E0039", erros } } });
    const resposta = await emitir();
    assert.equal(resposta.status, 400);
    assert.match((await resposta.json()).message, /Para Lucena, o Emissor Nacional ainda não aceitou este CNPJ/);
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0].url, /\/v2\/nfsen\?ref=/);
    const nota = db.tabela("nfse")[0];
    assert.equal(nota.status, "REJEITADA");
    assert.deepEqual(nota.erros, erros);
    assert.equal((nota.retorno_bruto as { http_status: number }).http_status, 422);
  });
});

describe("T4 — envio sem resposta", () => {
  const semResposta = () => { throw new TypeError("fetch failed"); };

  it("nota fica PROCESSANDO com a mesma referência e não pode ser reenviada", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: semResposta });

    const resposta = await emitir();
    const corpo = await resposta.json();
    assert.equal(resposta.status, 502);
    assert.equal(corpo.codigo, CODIGO_RESULTADO_INCERTO);
    const nota = db.tabela("nfse")[0];
    assert.equal(nota.status, "PROCESSANDO");
    assert.equal(nota.referencia, corpo.referencia);
    assert.equal((nota.erros as Array<{ codigo: string }>)[0].codigo, CODIGO_RESULTADO_INCERTO);

    const reenvio = await reemitir(post(`http://localhost/api/nfse/${nota.id}/reemitir`, {}), { params: Promise.resolve({ id: String(nota.id) }) });
    assert.equal(reenvio.status, 400);
  });

  it("consulta acha a referência na Focus: segue o status dela, sem reenviar", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: semResposta });
    await emitir();
    const nota = db.tabela("nfse")[0];

    const chamadas = focusFalsa({ GET: { corpo: { status: "autorizado", numero: "16" } } });
    await consultarNota(Number(nota.id));
    assert.equal(db.tabela("nfse")[0].status, "AUTORIZADA");
    assert.equal(db.tabela("nfse")[0].erros, null);
    assert.deepEqual(chamadas.map((c) => c.metodo), ["GET"]);
    assert.match(chamadas[0].url, new RegExp(`/v2/nfsen/${nota.referencia}$`));
  });

  it("consulta recebe 404: nada chegou, a nota volta a ser reenviável", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: semResposta });
    await emitir();
    const nota = db.tabela("nfse")[0];

    focusFalsa({ GET: { status: 404, corpo: { codigo: "nao_encontrado", mensagem: "Nota fiscal não encontrada" } } });
    await consultarNota(Number(nota.id));
    assert.equal(db.tabela("nfse")[0].status, "REJEITADA");
    assert.equal((db.tabela("nfse")[0].erros as Array<{ codigo: string }>)[0].codigo, "NAO_RECEBIDA");
  });

  it("404 em nota que não estava incerta não muda o status", async () => {
    const db = banco({ nfse: [{ id: 5, empresaid: 1, referencia: "OS_700_SRVS_1_1", status: "PROCESSANDO", modelo_emissao: "NACIONAL", erros: null, tentativas: [] }] });
    focusFalsa({ GET: { status: 404, corpo: { codigo: "nao_encontrado", mensagem: "Nota fiscal não encontrada" } } });
    await consultarNota(5);
    assert.equal(db.tabela("nfse")[0].status, "PROCESSANDO");
  });
});

describe("ciclo de vida pelo registro", () => {
  it("T5/T9: cancelamento em /v2/nfsen com o token da empresa que emitiu", async () => {
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
    assert.equal(chamadas[0].metodo, "DELETE");
    assert.match(chamadas[0].url, /\/v2\/nfsen\/OS_700_SRVS_1_9$/);
    assert.equal(chamadas[0].autorizacao, `Basic ${Buffer.from("token-empresa-b:").toString("base64")}`);
    assert.equal(db.tabela("nfse")[0].status, "CANCELADA");
  });

  it("T6: nota municipal antiga continua em /v2/nfse mesmo com a empresa em Lucena", async () => {
    banco({ nfse: [{ id: 3, empresaid: 1, referencia: "OS_1_SRVS_1_3", status: "AUTORIZADA", modelo_emissao: "MUNICIPAL_CABEDELO", tentativas: [] }] });
    const chamadas = focusFalsa({ GET: { corpo: { status: "autorizado" } } });
    await consultarNota(3);
    assert.match(chamadas[0].url, /\/v2\/nfse\/OS_1_SRVS_1_3$/);
  });
});
