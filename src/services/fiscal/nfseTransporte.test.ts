// Integração: formato nacional via Focus em ambiente municipal próprio.
// A nota 139 e seu E0039 são históricos; novas emissões seguem a reimplementação.
import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

import { BancoFalso } from "./__bancoFalso";
import { POST as reemitir } from "@/app/api/nfse/[id]/reemitir/route";
import { POST as consultar } from "@/app/api/nfse/consultar/[id]/route";
import { POST as cancelar } from "@/app/api/nfse/cancelar/[id]/route";
import { NFSeService } from "@/lib/services/fiscais/nfse-service";
import {
  MENSAGEM_FORA_DO_EMISSOR_NACIONAL,
  detectarMunicipioForaDoEmissorNacional,
  motivoParaNaoReenviar,
  resolverPoliticaNFSe,
  resumirErrosNFSe,
} from "@/lib/services/fiscais/nfse-politica";
import {
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
      config_geral: [],
      nfse: semente.nfse ?? [],
    },
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
    assert.equal(politica?.autorizador, "FOCUS_FORMATO_NACIONAL_MUNICIPAL");
    assert.equal(politica?.exigeRtc, true);
    assert.equal(politica?.regra, "JOAO_PESSOA_FORMATO_NACIONAL_2026");
  });

  it("transporte disponível: formato nacional via Focus no ambiente municipal", () => {
    const transporte = transportDaPolitica({ modelo: "NACIONAL", autorizador: "FOCUS_FORMATO_NACIONAL_MUNICIPAL" }, new NFSeService());
    assert.equal(transporte.disponivel, true);
    assert.equal(transporte.motivoIndisponivel, null);
    assert.equal(transporte.autorizador, "FOCUS_FORMATO_NACIONAL_MUNICIPAL");
    assert.equal(transporte.modeloEmissao, "NACIONAL");
  });

  it("reenvio de tentativa sem E0039 aceita o autorizador municipal com formato nacional", () => {
    assert.equal(motivoParaNaoReenviar(
      { modelo_emissao: "NACIONAL", erros: [{ codigo: "L999", mensagem: "Indisponibilidade temporária" }] },
      { modelo: "NACIONAL", autorizador: "FOCUS_FORMATO_NACIONAL_MUNICIPAL" },
    ), null);
  });

  it("nova nota NACIONAL consulta/cancela em /v2/nfsen e registra CANCELAMENTO", async () => {
    fixarHoje();
    const nota = { ...structuredClone(NOTA_139), id: 140, status: "AUTORIZADA", erros: null, tentativas: [] };
    const db = banco({ nfse: [nota] });
    const chamadas = focusFalsa({ GET: { status: "autorizado" }, DELETE: { status: "cancelado" } });
    const params = { params: Promise.resolve({ id: "140" }) };
    assert.equal((await consultar(post("http://localhost/api/nfse/consultar/140", {}), params)).status, 200);
    assert.equal((await cancelar(post("http://localhost/api/nfse/cancelar/140", { justificativa: "Cancelamento de teste automatizado" }), params)).status, 200);
    assert.equal(db.tabela("nfse")[0].status, "CANCELADA");
    assert.deepEqual(chamadas.map((c) => c.metodo), ["GET", "DELETE"]);
    assert.ok(chamadas.every((c) => c.url.includes("/v2/nfsen/")));
    assert.deepEqual(db.tabela("nfse")[0].tentativas.map((t: { tipo: string }) => t.tipo), ["CONSULTA", "CANCELAMENTO"]);
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

  it("a rejeição histórica bloqueia somente o reenvio exato, sem presumir falta de integração", () => {
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
