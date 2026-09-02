import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

// Antes de `nfse-registro`: ele importa o `supabaseAdmin`, que aborta na carga
// sem as variáveis de ambiente. Aqui só se exercita função pura.
import "./__testEnv";

import {
  NFSeService,
  criarReferenciaPorServicos,
  prepararReenvioNFSe,
} from "@/lib/services/fiscais/nfse-service";
import { arquivarTentativaNFSe } from "@/lib/services/fiscais/nfse-registro";

/**
 * O reenvio de NFS-e rejeitada repete o `payload_enviado` gravado. São três
 * modelos de emissão em produção e dois caminhos diferentes dentro do serviço:
 * João Pessoa e Cabedelo saem por `emitir`, o Nacional por `emitirNacional`.
 *
 * Os payloads abaixo são cópias de emissões reais — João Pessoa da Demir,
 * Cabedelo da Garage Premium — para o teste exercitar o formato que a Focus
 * recebe de verdade, com os campos extras que cada município usa.
 */

const PAYLOAD_JOAO_PESSOA = {
  servico: {
    aliquota: 5,
    iss_retido: false,
    codigo_cnae: "452000100",
    discriminacao: "OS #178\n1. MAO DE OBRA + SERVIÇO — 1 un. — R$ 1.800,00",
    valor_servicos: 1800,
    item_lista_servico: "14.01",
  },
  tomador: {
    cnpj: "34578049000148",
    email: "tomador@example.com",
    endereco: {
      uf: "PB",
      cep: "58105052",
      bairro: "RECANTO DO POCO",
      numero: "53",
      logradouro: "PROFESSOR SALATIEL FERNANDES DE MEDEIROS",
      codigo_municipio: "2503209",
    },
    razao_social: "SDR FABRICACAO E SOLUCOES EM CONCRETO LTDA",
  },
  prestador: {
    cnpj: "12260723000109",
    codigo_municipio: "2507507",
    inscricao_municipal: "1094653",
  },
  data_emissao: "2026-08-20T09:48:58",
  natureza_operacao: 1,
  optante_simples_nacional: false,
};

const PAYLOAD_CABEDELO = {
  servico: {
    aliquota: 5,
    iss_retido: false,
    codigo_cnae: "4520001",
    discriminacao: "OS #31\n1. MÃO DE OBRA — 1 un. — R$ 650,00",
    valor_servicos: 650,
    item_lista_servico: "14.01",
  },
  tomador: {
    cpf: "01849679452",
    endereco: {
      uf: "PB",
      cep: "58033080",
      bairro: "BRISAMAR",
      numero: "100",
      logradouro: "RUA RITA DE ALENCAR CARVALHO LUNA",
      codigo_municipio: "2507507",
    },
    telefone: "83988847199",
    razao_social: "LUIZ ANTONIO TRIGUEIRO",
  },
  prestador: {
    cnpj: "50114987000143",
    codigo_municipio: "2503209",
    inscricao_municipal: "0096717",
  },
  data_emissao: "2026-08-19T16:00:18",
  natureza_operacao: 1,
  optante_simples_nacional: true,
  regime_especial_tributacao: 6,
  regime_tributario_simples_nacional: 1,
};

const PAYLOAD_NACIONAL = {
  data_competencia: "2026-08-19",
  codigo_municipio_emissora: 2507507,
  cnpj_prestador: "50114987000143",
  inscricao_municipal_prestador: "0096717",
  codigo_opcao_simples_nacional: 2,
  regime_especial_tributacao: 0,
  cpf_tomador: "01849679452",
  razao_social_tomador: "LUIZ ANTONIO TRIGUEIRO",
  codigo_municipio_prestacao: "2507507",
  codigo_tributacao_nacional_iss: "140101",
  descricao_servico: "OS #31\n1. MÃO DE OBRA — 1 un. — R$ 650,00",
  valor_servico: 650,
  tributacao_iss: 1,
  tipo_retencao_iss: 1,
  indicador_total_tributacao: "0",
  finalidade_emissao: 0,
  consumidor_final: 1,
  indicador_destinatario: 0,
  ibs_cbs_situacao_tributaria: "000",
  ibs_cbs_classificacao_tributaria: "000001",
  data_emissao: "2026-08-19T16:00:18-03:00",
};

type EnvioCapturado = { url: string; metodo: string; corpo: Record<string, unknown> };

const fetchOriginal = globalThis.fetch;
let envios: EnvioCapturado[] = [];

function servicoComFetchFalso(resposta: unknown = { status: "processando_autorizacao" }) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    envios.push({
      url: String(url),
      metodo: String(init?.method ?? "GET"),
      corpo: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify(resposta), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const servico = new NFSeService();
  servico.configurarAmbiente("PRODUCAO", "token-de-teste");
  return servico;
}

describe("reenvio de NFS-e rejeitada", () => {
  beforeEach(() => {
    envios = [];
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("troca só a referência e tira a data de emissão antiga", () => {
    for (const payload of [PAYLOAD_JOAO_PESSOA, PAYLOAD_CABEDELO, PAYLOAD_NACIONAL]) {
      const preparado = prepararReenvioNFSe(payload, "OS_1_SRVS_2_999");

      assert.equal(preparado.referencia, "OS_1_SRVS_2_999");
      assert.equal("data_emissao" in preparado, false);

      // Todo o resto vai igual: é o mesmo envio, não uma nota nova.
      const esperado = { ...(payload as Record<string, unknown>) };
      delete esperado.data_emissao;
      const enviado: Record<string, unknown> = { ...preparado };
      delete enviado.referencia;
      assert.deepEqual(enviado, esperado);
    }
  });

  it("não altera o payload gravado", () => {
    const copia = structuredClone(PAYLOAD_JOAO_PESSOA);
    prepararReenvioNFSe(PAYLOAD_JOAO_PESSOA, "OS_1_SRVS_2_999");
    assert.deepEqual(PAYLOAD_JOAO_PESSOA, copia);
  });

  it("João Pessoa: reenvia pelo endpoint municipal com data de emissão nova", async () => {
    const servico = servicoComFetchFalso();
    const referencia = criarReferenciaPorServicos(178, [11]);

    await servico.emitir(prepararReenvioNFSe(PAYLOAD_JOAO_PESSOA, referencia) as never);

    const envio = envios[0];
    assert.equal(envio.metodo, "POST");
    assert.equal(envio.url, `https://api.focusnfe.com.br/v2/nfse?ref=${referencia}`);
    assert.notEqual(envio.corpo.data_emissao, PAYLOAD_JOAO_PESSOA.data_emissao);
    assert.match(String(envio.corpo.data_emissao), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    assert.deepEqual(envio.corpo.servico, PAYLOAD_JOAO_PESSOA.servico);
    assert.deepEqual(envio.corpo.tomador, PAYLOAD_JOAO_PESSOA.tomador);
    assert.deepEqual(envio.corpo.prestador, PAYLOAD_JOAO_PESSOA.prestador);
    assert.equal("referencia" in envio.corpo, false);
  });

  it("Cabedelo: reenvia pelo mesmo endpoint municipal e preserva os campos do Simples", async () => {
    const servico = servicoComFetchFalso();
    const referencia = criarReferenciaPorServicos(31, [23]);

    await servico.emitir(prepararReenvioNFSe(PAYLOAD_CABEDELO, referencia) as never);

    const envio = envios[0];
    assert.equal(envio.url, `https://api.focusnfe.com.br/v2/nfse?ref=${referencia}`);
    assert.notEqual(envio.corpo.data_emissao, PAYLOAD_CABEDELO.data_emissao);
    assert.equal(envio.corpo.optante_simples_nacional, true);
    assert.equal(envio.corpo.regime_especial_tributacao, 6);
    assert.equal(envio.corpo.regime_tributario_simples_nacional, 1);
    assert.deepEqual(envio.corpo.tomador, PAYLOAD_CABEDELO.tomador);
  });

  it("Nacional: reenvia pelo endpoint nfsen sem herdar a data de emissão anterior", async () => {
    const servico = servicoComFetchFalso();
    const referencia = criarReferenciaPorServicos(31, [23]);

    await servico.emitirNacional(prepararReenvioNFSe(PAYLOAD_NACIONAL, referencia) as never);

    const envio = envios[0];
    assert.equal(envio.metodo, "POST");
    assert.equal(
      envio.url,
      `https://api.focusnfe.com.br/v2/nfsen?ref=${encodeURIComponent(referencia)}`,
    );
    // O caso que justifica remover a data no preparo: aqui os dados são
    // espalhados depois dela, então a antiga venceria se tivesse ficado.
    assert.notEqual(envio.corpo.data_emissao, PAYLOAD_NACIONAL.data_emissao);
    assert.match(String(envio.corpo.data_emissao), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
    // A competência é do serviço prestado, não do envio: essa continua a mesma.
    assert.equal(envio.corpo.data_competencia, PAYLOAD_NACIONAL.data_competencia);
    assert.equal(envio.corpo.valor_servico, 650);
    assert.equal("referencia" in envio.corpo, false);
  });
});

/**
 * O reenvio acontece na própria linha rejeitada, e não numa cópia: o que ia
 * para o registro novo — envio, retorno bruto e erros da tentativa recusada —
 * seria sobrescrito. `arquivarTentativaNFSe` é o que guarda isso antes.
 */
describe("histórico de tentativas da NFS-e reenviada", () => {
  const rejeitada = {
    referencia: "OS_31_SRVS_23_111",
    status: "REJEITADA",
    erros: [{ codigo: "L999", mensagem: "Problema(s) encontrado(s) no processamento dos dados" }],
    payload_enviado: PAYLOAD_CABEDELO,
    retorno_bruto: { http_status: 422, corpo: { codigo: "L999" } },
    updatedat: "2026-08-19T16:00:20.000Z",
    tentativas: [],
  };

  it("arquiva a tentativa recusada inteira", () => {
    const historico = arquivarTentativaNFSe(rejeitada);

    assert.equal(historico.length, 1);
    assert.deepEqual(historico[0], {
      referencia: "OS_31_SRVS_23_111",
      status: "REJEITADA",
      erros: rejeitada.erros,
      payload_enviado: PAYLOAD_CABEDELO,
      retorno_bruto: rejeitada.retorno_bruto,
      registrada_em: "2026-08-19T16:00:20.000Z",
    });
  });

  it("preserva o histórico anterior e mantém a ordem", () => {
    const anterior = { referencia: "OS_31_SRVS_23_000", registrada_em: "2026-08-19T15:00:00.000Z" };
    const historico = arquivarTentativaNFSe({ ...rejeitada, tentativas: [anterior] });

    assert.equal(historico.length, 2);
    assert.deepEqual(historico[0], anterior);
    assert.equal(historico[1].referencia, "OS_31_SRVS_23_111");
  });

  it("tolera a linha gravada antes da coluna existir", () => {
    for (const tentativas of [null, undefined, "{}", 7]) {
      const historico = arquivarTentativaNFSe({ ...rejeitada, tentativas });
      assert.equal(historico.length, 1);
      assert.equal(historico[0].referencia, "OS_31_SRVS_23_111");
    }
  });

  it("sem data de atualização, registra a hora do arquivamento", () => {
    const semData = { ...rejeitada, updatedat: undefined };
    const antes = Date.now();

    const [tentativa] = arquivarTentativaNFSe(semData);

    assert.ok(new Date(tentativa.registrada_em).getTime() >= antes);
  });

  it("corta pelas últimas, descartando as mais antigas", () => {
    // Cada retorno bruto vai até 20 mil caracteres: uma nota reenviada dezenas
    // de vezes numa instabilidade não pode inchar a linha sem limite.
    const antigas = Array.from({ length: 10 }, (_, i) => ({ referencia: `OS_31_SRVS_23_${i}` }));

    const historico = arquivarTentativaNFSe({ ...rejeitada, tentativas: antigas }, 3);

    assert.equal(historico.length, 3);
    assert.equal(historico[0].referencia, "OS_31_SRVS_23_8");
    assert.equal(historico[1].referencia, "OS_31_SRVS_23_9");
    assert.equal(historico[2].referencia, "OS_31_SRVS_23_111");
  });
});
