// Integração: layout ≠ autorizador.
//
// A nota 139 da Demir (OS 525, 02/10/2026) saiu em DPS nacional pela Focus
// `/v2/nfsen`, passou na pré-validação e no schema, e voltou da Sefin com
// E0039: João Pessoa não usa os emissores públicos nacionais. A cidade adotou
// a DPS nacional no emissor PRÓPRIO (DSF), que a Focus não integra. Padrão
// nacional (layout) não implica Emissor Público Nacional (autorizador).

import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

import { BancoFalso } from "./__bancoFalso";
import { POST as emitirDeOs } from "@/app/api/nfse/de-os/[id]/route";
import { POST as reemitir } from "@/app/api/nfse/[id]/reemitir/route";
import { POST as consultar } from "@/app/api/nfse/consultar/[id]/route";
import { NFSeService } from "@/lib/services/fiscais/nfse-service";
import {
  MENSAGEM_FORA_DO_EMISSOR_NACIONAL,
  detectarMunicipioForaDoEmissorNacional,
  motivoParaNaoReenviar,
  resolverPoliticaNFSe,
  resumirErrosNFSe,
} from "@/lib/services/fiscais/nfse-politica";
import {
  MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO,
  transportDaPolitica,
  transportDoRegistro,
} from "@/lib/services/fiscais/nfse-transport";
import { acrescentarInteracaoNFSe, interacaoNFSe } from "@/lib/services/fiscais/nfse-registro";

/** O retorno da Sefin gravado na nota 139, exatamente. */
const ERROS_139 = [
  {
    codigo: "E0039",
    correcao: null,
    mensagem:
      "O município emissor informado na DPS deve estar parametrizado para utilizar os emissores públicos nacionais, conforme parametrização do município no Sistema Nacional NFS-e.",
  },
];

/** Payload da nota 139 como foi gravado, com o tomador anonimizado. */
const PAYLOAD_139 = {
  codigo_nbs: "120013110",
  cep_tomador: "45065075",
  cnpj_tomador: "11444777000161",
  data_emissao: "2026-10-02T10:48:30-03:00",
  valor_servico: 3609.04,
  bairro_tomador: "CENTRO",
  cnpj_prestador: "12260723000109",
  numero_tomador: "100",
  tributacao_iss: 1,
  consumidor_final: 0,
  data_competencia: "2026-10-02",
  descricao_servico: "OS #525\n1. TESTE COMPUTADORIZADO - 1 un. - R$ 284,93\n2. MAO DE OBRA PARTE ELETRICA - 1 un. - R$ 3.324,11",
  tipo_retencao_iss: 1,
  finalidade_emissao: 0,
  logradouro_tomador: "RUA DE TESTE",
  razao_social_tomador: "TOMADOR DE TESTE LTDA",
  indicador_destinatario: 0,
  codigo_municipio_tomador: 2933307,
  codigo_indicador_operacao: "050101",
  codigo_municipio_emissora: 2507507,
  codigo_municipio_prestacao: "2507507",
  indicador_total_tributacao: "0",
  informacoes_complementares: "Placa: PKR9990 - Marca: VOLVO - Ano: 2017 | Garantia: 90 dias",
  regime_especial_tributacao: 0,
  ibs_cbs_situacao_tributaria: "000",
  codigo_opcao_simples_nacional: 1,
  inscricao_municipal_prestador: "1094653",
  codigo_tributacao_nacional_iss: "140101",
  ibs_cbs_classificacao_tributaria: "000001",
  percentual_aliquota_relativa_municipio: 5,
};

const NOTA_139 = {
  id: 139,
  ordemservicoid: 525,
  clienteid: 1517,
  empresaid: 1,
  status: "REJEITADA",
  modelo_emissao: "NACIONAL",
  referencia: "OS_525_SRVS_12-15_1790948910014",
  servico_ids: [12, 15],
  valor_total: 3609.04,
  payload_enviado: PAYLOAD_139,
  erros: ERROS_139,
  retorno_bruto: {
    corpo: { ref: "OS_525_SRVS_12-15_1790948910014", erros: ERROS_139, status: "erro_autorizacao" },
    requisicao: { url: "https://api.focusnfe.com.br/v2/nfsen/OS_525_SRVS_12-15_1790948910014", metodo: "GET" },
    http_status: 200,
    recebido_em: "2026-10-02T13:48:56.982Z",
  },
  tentativas: [],
  updatedat: "2026-10-02T13:48:30.717Z",
};

/** Padrão Nacional como está gravado na Demir hoje. */
const PADRAO_NACIONAL_DEMIR = {
  codigoNbs: "120013110",
  aliquotaIss: "5",
  tributacaoIss: "1",
  consumidorFinal: "0",
  tipoRetencaoIss: "1",
  finalidadeEmissao: "0",
  indicadorDestinatario: "0",
  codigoIndicadorOperacao: "050101",
  ibsCbsSituacaoTributaria: "000",
  regimeEspecialTributacao: "0",
  codigoTributacaoNacionalIss: "140101",
  ibsCbsClassificacaoTributaria: "000001",
};
const PADRAO_JOAO_PESSOA = {
  issRetido: "false", codigoCnae: "452000100", aliquotaIss: "5", itemListaServico: "14.01", naturezaOperacao: "1",
};

const DEMIR = {
  id: 1, codigomunicipio: "2507507", regimetributario: "3", ambiente: "PRODUCAO", uf: "PB",
  cnpj: "12260723000109", inscricaomunicipal: "1094653",
};

const CLIENTE = {
  id: 1517, tipopessoa: "JURIDICA", cpfcnpj: "11444777000161", nomerazaosocial: "TOMADOR DE TESTE LTDA",
  endereco: "RUA DE TESTE", endereconumero: "100", bairro: "CENTRO", codigomunicipio: "2933307", estado: "BA", cep: "45065075",
};

const OS_525 = {
  id: 525, status: "CONCLUIDO", clienteid: CLIENTE.id, observacoes_fiscais: null, garantia: null, cliente: CLIENTE,
  osservico: [
    { servicoid: 12, quantidade: 1, precounitario: 300, subtotal: 300, servico: { id: 12, descricao: "TESTE COMPUTADORIZADO", itemlistaservico: "14.01" } },
    { servicoid: 15, quantidade: 1, precounitario: 3500, subtotal: 3500, servico: { id: 15, descricao: "MAO DE OBRA PARTE ELETRICA", itemlistaservico: "14.01" } },
  ],
};

const CODIGOS_DPS = {
  codigo_tributacao_nacional_iss: "140101",
  codigo_nbs: "120013110",
  tributacao_iss: 1,
  tipo_retencao_iss: 1,
  finalidade_emissao: 0,
  consumidor_final: 0,
  indicador_destinatario: 0,
  codigo_indicador_operacao: "050101",
  ibs_cbs_situacao_tributaria: "000",
  ibs_cbs_classificacao_tributaria: "000001",
};

function banco(semente: { empresa?: Record<string, unknown>; nfse?: Record<string, unknown>[] } = {}) {
  return new BancoFalso(
    {
      empresa: [{ ...DEMIR, ...semente.empresa }],
      nfse_config: [{
        empresa_id: 1,
        token: "token-de-teste",
        padroes_emissao: { NACIONAL: PADRAO_NACIONAL_DEMIR, MUNICIPAL_JOAO_PESSOA: PADRAO_JOAO_PESSOA },
        incluir_garantia_os: false,
      }],
      ordemservico: [OS_525],
      config_geral: [],
      nfse: semente.nfse ?? [],
      nfse_os_servico_vinculo: [],
    },
    { vincular_nfse_os: () => ({}) },
  ).instalar();
}

/** Toda chamada de rede vai para cá; a resposta depende do método. */
function focusFalsa(respostas: { POST?: unknown; GET?: unknown; DELETE?: unknown } = {}) {
  const chamadas: Array<{ metodo: string; url: string }> = [];
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const metodo = String(init?.method ?? "GET");
    chamadas.push({ metodo, url: String(url) });
    const corpo = (respostas as Record<string, unknown>)[metodo] ?? {};
    return new Response(JSON.stringify(corpo), { status: metodo === "POST" ? 202 : 200 });
  });
  return chamadas;
}

const post = (url: string, corpo: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" } });

function fixarHoje() {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-02T15:00:00Z") });
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

describe("Caso 1 — João Pessoa CRT 3 não vai para o Emissor Público Nacional", () => {
  it("política: layout DPS nacional, autorizador emissor próprio da prefeitura", () => {
    const politica = resolverPoliticaNFSe({
      codigoMunicipio: "2507507", regimeTributario: "3", dataCompetencia: "2026-10-02", itensListaServico: ["14.01"],
    });
    assert.equal(politica?.layout, "DPS_NACIONAL");
    assert.equal(politica?.autorizador, "JOAO_PESSOA_DSF_DPS");
    assert.equal(politica?.exigeRtc, true);
  });

  it("o transporte de João Pessoa está indisponível e não toca na rede", async () => {
    const chamadas = focusFalsa();
    const transporte = transportDaPolitica(
      { modelo: "NACIONAL", autorizador: "JOAO_PESSOA_DSF_DPS" },
      new NFSeService(),
    );
    assert.equal(transporte.disponivel, false);
    assert.equal(transporte.motivoIndisponivel, MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO);
    await assert.rejects(transporte.emitir({}), /não está integrada/);
    await assert.rejects(transporte.consultar("x"), /não está integrada/);
    await assert.rejects(transporte.cancelar("x"), /não está integrada/);
    assert.deepEqual(chamadas, []);
  });

  it("emissão da OS 525 com o padrão completo da Demir: 422, nada gravado, nenhuma chamada", async () => {
    fixarHoje();
    const db = banco();
    const chamadas = focusFalsa({ POST: { status: "processando_autorizacao" } });

    const resposta = await emitirDeOs(
      post("http://localhost/api/nfse/de-os/525", {
        servicos: [{ osservicoId: 12, valor: 284.93 }, { osservicoId: 15, valor: 3324.11 }],
        codigosFiscais: CODIGOS_DPS,
      }),
      { params: Promise.resolve({ id: "525" }) },
    );
    const corpo = await resposta.json();

    assert.equal(resposta.status, 422);
    assert.equal(corpo.codigo, "TRANSPORTE_INDISPONIVEL");
    assert.equal(corpo.autorizador, "JOAO_PESSOA_DSF_DPS");
    assert.deepEqual(chamadas, [], "nenhuma chamada à Focus — nem /v2/nfsen, nem /v2/nfse");
    assert.equal(db.tabela("nfse").length, 0);
    assert.equal(db.chamadasRpc.length, 0, "nenhum serviço vinculado");
  });
});

describe("Caso 2 — município realmente habilitado no Emissor Público Nacional", () => {
  it("MEI: DPS nacional pela Focus /v2/nfsen", async () => {
    const politica = resolverPoliticaNFSe({
      codigoMunicipio: "2503209", regimeTributario: "4", dataCompetencia: "2026-10-02", itensListaServico: ["14.01"],
    })!;
    assert.equal(politica.layout, "DPS_NACIONAL");
    assert.equal(politica.autorizador, "FOCUS_NACIONAL");

    const chamadas = focusFalsa({ POST: { status: "processando_autorizacao" } });
    const service = new NFSeService();
    service.configurarAmbiente("HOMOLOGACAO", "token-de-teste");
    const transporte = transportDaPolitica(politica, service);
    assert.equal(transporte.disponivel, true);
    assert.equal(transporte.modeloEmissao, "NACIONAL");
    await transporte.emitir({ referencia: "OS_1_SRVS_1_1", descricao_servico: "x" });
    assert.match(chamadas[0].url, /\/v2\/nfsen\?ref=OS_1_SRVS_1_1$/);
  });
});

describe("Caso 3 — João Pessoa legado segue no transporte municipal antigo", () => {
  it("consulta e cancelamento de MUNICIPAL_JOAO_PESSOA em /v2/nfse", async () => {
    const chamadas = focusFalsa();
    const service = new NFSeService();
    service.configurarAmbiente("HOMOLOGACAO", "token-de-teste");
    const transporte = transportDoRegistro("MUNICIPAL_JOAO_PESSOA", service);
    assert.equal(transporte.autorizador, "FOCUS_MUNICIPAL");
    await transporte.consultar("OS_489_SRVS_16_1790794612861");
    await transporte.cancelar("OS_489_SRVS_16_1790794612861", "Cancelamento de teste automatizado");
    assert.deepEqual(chamadas.map((c) => c.metodo), ["GET", "DELETE"]);
    for (const chamada of chamadas) assert.match(chamada.url, /\/v2\/nfse\/OS_489_SRVS_16_1790794612861$/);
  });

  it("modelo gravado decide o transporte, não a política de hoje", () => {
    const service = new NFSeService();
    assert.equal(transportDoRegistro("NACIONAL", service).autorizador, "FOCUS_NACIONAL");
    assert.equal(transportDoRegistro("MUNICIPAL", service).autorizador, "FOCUS_MUNICIPAL");
    assert.equal(transportDoRegistro(null, service).autorizador, "FOCUS_MUNICIPAL");
    assert.equal(transportDoRegistro("DPS_JOAO_PESSOA", service).autorizador, "JOAO_PESSOA_DSF_DPS");
  });
});

describe("Caso 4 — E0039", () => {
  it("é reconhecido pelo código e pela mensagem", () => {
    assert.equal(detectarMunicipioForaDoEmissorNacional(ERROS_139), true);
    assert.equal(detectarMunicipioForaDoEmissorNacional([{ mensagem: ERROS_139[0].mensagem }]), true);
    assert.equal(detectarMunicipioForaDoEmissorNacional([{ codigo: "E0039" }]), true);
    assert.equal(detectarMunicipioForaDoEmissorNacional([{ codigo: "E0176", mensagem: "outro" }]), false);
  });

  it("mensagem amigável na frente, retorno original preservado", () => {
    const resumo = resumirErrosNFSe(ERROS_139);
    assert.equal(resumo?.codigo, "E0039");
    assert.ok(resumo?.mensagem.startsWith(MENSAGEM_FORA_DO_EMISSOR_NACIONAL));
    assert.ok(resumo?.mensagem.includes(ERROS_139[0].mensagem));
  });

  it("não é tratado como erro dos códigos: o reenvio recusa pelo autorizador", () => {
    assert.equal(motivoParaNaoReenviar(NOTA_139, null), MENSAGEM_FORA_DO_EMISSOR_NACIONAL);
    // MEI legítimo no Nacional, sem E0039, reenvia normalmente.
    assert.equal(
      motivoParaNaoReenviar({ modelo_emissao: "NACIONAL", erros: [{ codigo: "E0001" }] }, { modelo: "NACIONAL", autorizador: "FOCUS_NACIONAL" }),
      null,
    );
  });

  it("reenviar a nota 139: 409, nenhuma chamada a /v2/nfsen, registro intacto", async () => {
    fixarHoje();
    const db = banco({ nfse: [structuredClone(NOTA_139)] });
    const chamadas = focusFalsa();

    const resposta = await reemitir(new Request("http://localhost/api/nfse/139/reemitir", { method: "POST" }), {
      params: Promise.resolve({ id: "139" }),
    });
    const corpo = await resposta.json();

    assert.equal(resposta.status, 409);
    assert.equal(corpo.message, MENSAGEM_FORA_DO_EMISSOR_NACIONAL);
    assert.deepEqual(corpo.erros, ERROS_139, "erro original devolvido");
    assert.deepEqual(chamadas, []);
    assert.deepEqual(db.tabela("nfse")[0], NOTA_139, "a nota 139 não muda");
  });

  it("consulta que traz E0039 deixa a nota REJEITADA com o erro original", async () => {
    fixarHoje();
    const pendente = { ...structuredClone(NOTA_139), status: "PROCESSANDO", erros: null, tentativas: [] };
    const db = banco({ nfse: [pendente] });
    focusFalsa({ GET: { ref: NOTA_139.referencia, status: "erro_autorizacao", erros: ERROS_139 } });

    await consultar(post("http://localhost/api/nfse/consultar/139", {}), { params: Promise.resolve({ id: "139" }) });

    const linha = db.tabela("nfse")[0];
    assert.equal(linha.status, "REJEITADA");
    assert.deepEqual(linha.erros, ERROS_139);
  });
});

describe("Caso 5 — observabilidade: cada chamada externa entra em tentativas", () => {
  it("POST, GET, GET → 3 interações em ordem, sem token", async () => {
    fixarHoje();
    // MEI de Cabedelo: o caminho que de fato chega à Focus.
    const db = banco({ empresa: { codigomunicipio: "2503209", regimetributario: "4" } });
    const chamadas = focusFalsa({
      POST: { status: "processando_autorizacao" },
      GET: { status: "processando_autorizacao" },
    });

    const emissao = await emitirDeOs(
      post("http://localhost/api/nfse/de-os/525", {
        servicos: [{ osservicoId: 12, valor: 300 }],
        codigosFiscais: CODIGOS_DPS,
      }),
      { params: Promise.resolve({ id: "525" }) },
    );
    assert.equal(emissao.status, 202, JSON.stringify(await emissao.clone().json()));
    const id = Number(db.tabela("nfse")[0].id);

    for (let i = 0; i < 2; i += 1) {
      mock.timers.tick(60_000);
      await consultar(post(`http://localhost/api/nfse/consultar/${id}`, {}), { params: Promise.resolve({ id: String(id) }) });
    }

    const tentativas = db.tabela("nfse")[0].tentativas as Array<Record<string, unknown>>;
    assert.equal(chamadas.length, 3);
    assert.equal(tentativas.length, 3);
    assert.deepEqual(tentativas.map((t) => t.tipo), ["EMISSAO", "CONSULTA", "CONSULTA"]);
    assert.deepEqual(tentativas.map((t) => t.metodo), ["POST", "GET", "GET"]);
    assert.ok(tentativas[0].payload, "o POST guarda o payload enviado");
    assert.equal(tentativas[0].http_status, 202);
    const instantes = tentativas.map((t) => Date.parse(String(t.timestamp)));
    assert.deepEqual([...instantes].sort((a, b) => a - b), instantes, "ordem cronológica");
    assert.doesNotMatch(JSON.stringify(tentativas), /token-de-teste/);
  });

  it("acrescentar nunca apaga o histórico, inclusive o arquivo antigo dos reenvios", () => {
    const antigo = [{ referencia: "OS_1_SRVS_1_1", status: "REJEITADA" }];
    const interacao = interacaoNFSe("CONSULTA", "OS_1_SRVS_1_2", {
      requisicao: { metodo: "GET", url: "https://api.focusnfe.com.br/v2/nfsen/OS_1_SRVS_1_2" },
      http_status: 200,
      recebido_em: "2026-10-02T13:48:56.982Z",
      corpo: { status: "erro_autorizacao" },
    });
    const historico = acrescentarInteracaoNFSe(antigo, interacao);
    assert.equal(historico.length, 2);
    assert.deepEqual(historico[0], antigo[0]);
    assert.equal((historico[1] as Record<string, unknown>).tipo, "CONSULTA");
    assert.deepEqual(acrescentarInteracaoNFSe(null, interacao).length, 1);
  });
});
