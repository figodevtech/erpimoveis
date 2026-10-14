// Lucena/PB pelo Ambiente Nacional via Focus: rota liberada antes e depois de
// 01/11/2026, recusa da Focus mostrada como veio, envio sem confirmação e
// reenvio na mesma referência. Rede e banco são falsos; nada sai daqui.
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
import { resolverPoliticaNFSe } from "@/lib/services/fiscais/nfse-politica";
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
      ordemservico: [OS],
      config_geral: [],
      nfse: semente.nfse ?? [],
      nfse_os_servico_vinculo: [],
    },
    { vincular_nfse_os: () => ({}) },
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

const SEM_REDE: Resposta = { falha: new TypeError("fetch failed") };
const REFERENCIA_REPETIDA: Resposta = {
  status: 422,
  corpo: { codigo: "erro_validacao", mensagem: "Já existe um DPS com esta referência." },
};

const post = (url: string, corpo: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" } });

const emitir = () => emitirDeOs(
  post("http://localhost/api/nfse/de-os/700", { servicos: [{ osservicoId: 1, valor: 200 }], codigosFiscais: CODIGOS }),
  { params: Promise.resolve({ id: "700" }) },
);

const consultarNota = (id: number) =>
  consultar(post(`http://localhost/api/nfse/consultar/${id}`, {}), { params: Promise.resolve({ id: String(id) }) });

const reenviarNota = (id: number) =>
  reemitir(new Request(`http://localhost/api/nfse/${id}/reemitir`, { method: "POST" }), { params: Promise.resolve({ id: String(id) }) });

function fixarHoje(iso: string) {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
}

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

  it("CRT 1 em 13/10/2026: POST /v2/nfsen no ambiente configurado, nota PROCESSANDO", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    const chamadas = focusFalsa({ POST: { corpo: { status: "processando_autorizacao" } } });

    const resposta = await emitir();
    assert.equal(resposta.status, 202, JSON.stringify(await resposta.clone().json()));
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0].url, /^https:\/\/homologacao\.focusnfe\.com\.br\/v2\/nfsen\?ref=OS_700_SRVS_1_/);
    assert.equal(chamadas[0].autorizacao, `Basic ${Buffer.from("token-lucena:").toString("base64")}`);
    const enviado = chamadas[0].corpo as Record<string, unknown>;
    assert.equal(enviado.codigo_municipio_emissora, 2508604);
    assert.equal(enviado.codigo_municipio_prestacao, "2508604");
    assert.equal(enviado.cnpj_prestador, "11222333000181");
    assert.equal(enviado.codigo_opcao_simples_nacional, 3);
    assert.equal(enviado.regime_tributario_simples_nacional, 1);
    assert.equal(enviado.data_competencia, "2026-10-13");
    // Simples em 2026: o grupo da Reforma não vai.
    assert.equal("codigo_indicador_operacao" in enviado, false);
    const nota = db.tabela("nfse")[0];
    assert.equal(nota.modelo_emissao, "NACIONAL");
    assert.equal(nota.status, "PROCESSANDO");
  });

  it("produção usa a URL e o token de produção", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    banco({ empresa: [{ ...LUCENA, ambiente: "PRODUCAO" }] });
    const chamadas = focusFalsa({ POST: { corpo: { status: "processando_autorizacao" } } });
    assert.equal((await emitir()).status, 202);
    assert.match(chamadas[0].url, /^https:\/\/api\.focusnfe\.com\.br\/v2\/nfsen\?ref=/);
  });

  it("CRT 2 em 13/10/2026 com apuração cadastrada: envia o valor do padrão", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    banco({ empresa: [{ ...LUCENA, regimetributario: "2" }], padrao: { ...PADRAO_NACIONAL, regimeApuracaoSimplesNacional: "3" } });
    const chamadas = focusFalsa({ POST: { corpo: { status: "processando_autorizacao" } } });
    assert.equal((await emitir()).status, 202);
    const enviado = chamadas[0].corpo as Record<string, unknown>;
    assert.equal(enviado.codigo_opcao_simples_nacional, 3);
    assert.equal(enviado.regime_tributario_simples_nacional, 3);
  });

  it("Focus responde autorizada na hora: a nota fica AUTORIZADA", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: { status: 200, corpo: { status: "autorizado", numero: "1" } } });
    assert.equal((await emitir()).status, 202);
    assert.equal(db.tabela("nfse")[0].status, "AUTORIZADA");
  });
});

describe("Lucena depois de novembro", () => {
  it("CRT 1: mesma rota e mesmo endpoint; consulta autoriza", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    const db = banco();
    const chamadas = focusFalsa({
      POST: { corpo: { status: "processando_autorizacao" } },
      GET: { corpo: { status: "autorizado", numero: "15", codigo_verificacao: "ABC123" } },
    });
    assert.equal((await emitir()).status, 202);
    assert.match(chamadas[0].url, /\/v2\/nfsen\?ref=/);
    await consultarNota(Number(db.tabela("nfse")[0].id));
    assert.equal(db.tabela("nfse")[0].status, "AUTORIZADA");
    assert.equal(db.tabela("nfse")[0].numero, "15");
    assert.ok(chamadas.every((c) => c.url.includes("/v2/nfsen")));
  });

  it("CRT 2 sem regime de apuração: recusada antes de gravar ou enviar", async () => {
    fixarHoje("2026-11-02T15:00:00Z");
    const db = banco({ empresa: [{ ...LUCENA, regimetributario: "2" }] });
    const chamadas = focusFalsa();
    const resposta = await emitir();
    assert.equal(resposta.status, 400);
    assert.match((await resposta.json()).message, /regime de apura/);
    assert.equal(chamadas.length, 0);
    assert.equal(db.tabela("nfse").length, 0);
  });
});

describe("recusa da Focus: aparece como veio, sem caminho alternativo", () => {
  const casos: Array<{ http: number; resposta: Resposta; espera: RegExp[] }> = [
    { http: 400, resposta: { status: 400, corpo: { codigo: "requisicao_invalida", mensagem: "O campo dfe.prestador.cpf_cnpj é obrigatório." } }, espera: [/Código: requisicao_invalida/, /Mensagem: O campo dfe\.prestador\.cpf_cnpj é obrigatório\./] },
    { http: 401, resposta: { status: 401, texto: "HTTP Basic: Access denied." }, espera: [/Resposta: HTTP Basic: Access denied\./, /confira o token da Focus do ambiente Homologação/] },
    { http: 403, resposta: { status: 403, corpo: { codigo: "permissao_negada", mensagem: "CNPJ do emitente não autorizado." } }, espera: [/Código: permissao_negada/, /CNPJ do emitente não autorizado/, /confira o token/] },
    { http: 404, resposta: { status: 404, corpo: { codigo: "nao_encontrado", mensagem: "Empresa não encontrada" } }, espera: [/Código: nao_encontrado/, /Empresa não encontrada/] },
    { http: 422, resposta: { status: 422, corpo: { codigo: "erro_validacao", erros: [{ codigo: "E0039", mensagem: "O município emissor informado na DPS deve estar parametrizado para utilizar os emissores públicos nacionais" }] } }, espera: [/Código: E0039/, /Mensagem: O município emissor/, /Observação: .*Lucena\/PB/] },
  ];

  for (const caso of casos) {
    it(`HTTP ${caso.http}: REJEITADA, retorno bruto gravado, uma chamada só`, async () => {
      fixarHoje("2026-10-13T15:00:00Z");
      const db = banco();
      const chamadas = focusFalsa({ POST: caso.resposta });
      const resposta = await emitir();
      const corpo = await resposta.json();
      assert.equal(resposta.status, 400);
      assert.equal(corpo.rejeicao.httpStatus, caso.http);
      assert.equal(corpo.rejeicao.ambiente, "Homologação");
      assert.equal(corpo.rejeicao.municipio, "Lucena/PB");
      assert.equal(corpo.rejeicao.provedor, "Focus NFe");
      assert.match(corpo.message, /^Não foi possível autorizar a NFS-e\.\nProvedor: Focus NFe\nMunicípio: Lucena\/PB\nAmbiente: Homologação\n/);
      assert.match(corpo.message, new RegExp(`HTTP: ${caso.http}`));
      assert.match(corpo.message, new RegExp(`Referência: ${corpo.referencia}`));
      for (const padrao of caso.espera) assert.match(corpo.message, padrao);
      assert.doesNotMatch(corpo.message, /token-lucena/);
      assert.equal(chamadas.length, 1, "sem fallback para outro endpoint");
      assert.match(chamadas[0].url, /\/v2\/nfsen\?ref=/);
      const nota = db.tabela("nfse")[0];
      assert.equal(nota.status, "REJEITADA");
      assert.equal((nota.retorno_bruto as { http_status: number }).http_status, caso.http);
    });
  }

  it("várias rejeições: todas na mensagem e em erros", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    const erros = [
      { codigo: "E0312", mensagem: "Código de tributação nacional inexistente", correcao: "Informe um cTribNac válido" },
      { codigo: "E0118", mensagem: "Inscrição municipal do prestador não cadastrada" },
    ];
    focusFalsa({ POST: { status: 422, corpo: { codigo: "erro_validacao", erros } } });
    const corpo = await (await emitir()).json();
    assert.match(corpo.message, /Rejeição 1 de 2\nCódigo: E0312\nMensagem: Código de tributação nacional inexistente\nCorreção: Informe um cTribNac válido/);
    assert.match(corpo.message, /Rejeição 2 de 2\nCódigo: E0118/);
    assert.deepEqual(db.tabela("nfse")[0].erros, erros);
  });
});

describe("envio sem confirmação: nunca vira rejeição, nunca ganha referência nova", () => {
  it("falha de rede: PROCESSANDO com RESULTADO_INCERTO e a mesma referência", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: SEM_REDE });
    const resposta = await emitir();
    const corpo = await resposta.json();
    assert.equal(resposta.status, 502);
    assert.equal(corpo.codigo, CODIGO_RESULTADO_INCERTO);
    const nota = db.tabela("nfse")[0];
    assert.equal(nota.status, "PROCESSANDO");
    assert.equal(nota.referencia, corpo.referencia);
    assert.equal((nota.erros as Array<{ codigo: string }>)[0].codigo, CODIGO_RESULTADO_INCERTO);
  });

  it("HTTP 500 também fica incerto, não rejeitado", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: { status: 500, texto: "Internal Server Error" } });
    const resposta = await emitir();
    assert.equal(resposta.status, 502);
    assert.equal((await resposta.json()).codigo, CODIGO_RESULTADO_INCERTO);
    assert.equal(db.tabela("nfse")[0].status, "PROCESSANDO");
    assert.equal((db.tabela("nfse")[0].erros as Array<{ codigo: string }>)[0].codigo, CODIGO_RESULTADO_INCERTO);
  });

  it("consulta com 404 não libera nada: nota segue incerta, marca intacta", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: SEM_REDE });
    await emitir();
    const antes = structuredClone(db.tabela("nfse")[0]);

    focusFalsa({ GET: { status: 404, corpo: { codigo: "nao_encontrado", mensagem: "Nota fiscal não encontrada" } } });
    const resposta = await consultarNota(Number(antes.id));
    assert.equal(resposta.status, 400);
    assert.match((await resposta.json()).message, /não prova que o envio não chegou/);
    const depois = db.tabela("nfse")[0];
    assert.equal(depois.status, "PROCESSANDO");
    assert.equal(depois.referencia, antes.referencia);
    assert.deepEqual(depois.erros, antes.erros);
  });

  it("consulta acha a referência: segue o status da Focus e a marca sai", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: SEM_REDE });
    await emitir();
    focusFalsa({ GET: { corpo: { status: "autorizado", numero: "16" } } });
    await consultarNota(Number(db.tabela("nfse")[0].id));
    assert.equal(db.tabela("nfse")[0].status, "AUTORIZADA");
    assert.equal(db.tabela("nfse")[0].erros, null);
  });

  it("reenvio com a mesma referência: a Focus diz que já tinha — segue PROCESSANDO", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: SEM_REDE });
    await emitir();
    const referencia = db.tabela("nfse")[0].referencia;

    const chamadas = focusFalsa({ POST: REFERENCIA_REPETIDA });
    const resposta = await reenviarNota(Number(db.tabela("nfse")[0].id));
    assert.equal(resposta.status, 202, JSON.stringify(await resposta.clone().json()));
    assert.match((await resposta.json()).message, /já tinha recebido/);
    assert.match(chamadas[0].url, new RegExp(`/v2/nfsen\\?ref=${referencia}$`));
    const nota = db.tabela("nfse")[0];
    assert.equal(nota.referencia, referencia);
    assert.equal(nota.status, "PROCESSANDO");
    assert.equal(nota.erros, null);
    assert.equal(db.tabela("nfse").length, 1);
  });

  it("reenvio com a mesma referência que não tinha chegado: processa normalmente", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: SEM_REDE });
    await emitir();
    const referencia = db.tabela("nfse")[0].referencia;

    focusFalsa({ POST: { corpo: { status: "processando_autorizacao" } } });
    assert.equal((await reenviarNota(Number(db.tabela("nfse")[0].id))).status, 202);
    assert.equal(db.tabela("nfse")[0].referencia, referencia);
    assert.equal(db.tabela("nfse")[0].erros, null);
  });

  it("reenvio que cai de novo continua incerto, com a mesma referência", async () => {
    fixarHoje("2026-10-13T15:00:00Z");
    const db = banco();
    focusFalsa({ POST: SEM_REDE });
    await emitir();
    const referencia = db.tabela("nfse")[0].referencia;
    focusFalsa({ POST: { status: 503, texto: "Service Unavailable" } });
    assert.equal((await reenviarNota(Number(db.tabela("nfse")[0].id))).status, 502);
    assert.equal(db.tabela("nfse")[0].status, "PROCESSANDO");
    assert.equal(db.tabela("nfse")[0].referencia, referencia);
    assert.equal((db.tabela("nfse")[0].erros as Array<{ codigo: string }>)[0].codigo, CODIGO_RESULTADO_INCERTO);
  });

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
