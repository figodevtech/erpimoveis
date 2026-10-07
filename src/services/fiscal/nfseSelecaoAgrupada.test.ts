import "./__testEnv";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { BancoFalso } from "./__bancoFalso";
import { GET as listar } from "@/app/api/nfse/servicos-de-os/[id]/route";
import { POST as revisar } from "@/app/api/nfse/contexto-emissao/[id]/route";
import { POST as emitir } from "@/app/api/nfse/de-os/[id]/route";
import { normalizarSelecaoNFSe, resolverServicosNFSe } from "@/lib/services/fiscais/nfse-selecao";
import {
  ancoraDaSelecao, chaveDoServico, selecaoParaEmissao, selecaoParaRevisao, totalDosServicos,
} from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/selecao-servicos";
import type { ServicoOS } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types";

// Reproduz as linhas 390:37 e 393:37 com cadastro de cliente fictício.
const cliente = {
  id: 1405, tipopessoa: "JURIDICA", cpfcnpj: "11444777000161", nomerazaosocial: "TOMADOR DE TESTE",
  endereco: "RUA DE TESTE", endereconumero: "100", bairro: "CENTRO", codigomunicipio: "2507507", estado: "PB", cep: "58000000",
};
const empresa = {
  id: 1, cnpj: "12260723000109", codigomunicipio: "2507507", regimetributario: "3",
  inscricaomunicipal: "1094653", ambiente: "HOMOLOGACAO", timezone_iana: "America/Fortaleza",
};
const ordens = [
  { id: 390, descricao: "REPARO DE MODULO VOLVO", valor: 3500 },
  { id: 393, descricao: "REPARO DE PAINEL", valor: 1200 },
].map(({ id, descricao, valor }) => ({
  id, status: "CONCLUIDO", clienteid: cliente.id, cliente, subtotal: valor, orcamentototal: valor, osproduto: [],
  osservico: [{ ordemservicoid: id, servicoid: 37, quantidade: 1, precounitario: valor, subtotal: valor, descricao,
    servico: { id: 37, descricao: "REPARO", itemlistaservico: "14.01" } }],
}));
const codigosFiscais = {
  codigo_tributacao_nacional_iss: "140101", tributacao_iss: 1, tipo_retencao_iss: 1,
  finalidade_emissao: 0, consumidor_final: 0, indicador_destinatario: 0,
  codigo_indicador_operacao: "050101", ibs_cbs_situacao_tributaria: "000", ibs_cbs_classificacao_tributaria: "000001",
};
const selecao = [
  { ordemservicoId: 390, osservicoId: 37, valor: 3500 },
  { ordemservicoId: 393, osservicoId: 37, valor: 1200 },
];
const params = (id = 390) => ({ params: Promise.resolve({ id: String(id) }) });
const post = (id: number, corpo: unknown) => new NextRequest(`http://localhost/api/nfse/de-os/${id}`, {
  method: "POST", body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" },
});
const get = (query = "?osIdsAdicionais=393") => new NextRequest(`http://localhost/api/nfse/servicos-de-os/390${query}`);

function instalarBanco() {
  return new BancoFalso({
    empresa: [empresa], ordemservico: ordens, nfse: [], nfse_os_servico_vinculo: [], config_geral: [],
    nfse_config: [{ empresa_id: 1, token: "token-de-teste", padroes_emissao: {}, incluir_garantia_os: false }],
  }).instalar();
}

beforeEach(() => mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-07T15:00:00Z") }));
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

function focusFalsa(db: BancoFalso) {
  const payloads: Record<string, any>[] = [];
  mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    assert.match(String(url), /\/v2\/nfsen\?/);
    assert.equal(init?.method, "POST");
    // A reserva tem de acontecer antes de qualquer transmissão.
    assert.equal(db.chamadasRpc.at(-1)?.nome, "vincular_nfse_os");
    payloads.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ status: "processando_autorizacao" }), { status: 202 });
  });
  return payloads;
}

describe("NFS-e das OS 390 e 393", () => {
  it("lista as duas linhas de catálogo 37 com valores e descrições separados", async () => {
    instalarBanco();
    const response = await listar(get(), params());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.osIds, [390, 393]);
    assert.deepEqual(body.servicos.map((s: ServicoOS) => [chaveDoServico(s), s.descricao, s.precounitario]), [
      ["390:37", "REPARO DE MODULO VOLVO", 3500], ["393:37", "REPARO DE PAINEL", 1200],
    ]);
    assert.ok(body.servicos.every((s: ServicoOS) => !s.pendenciasCadastro?.length));
  });

  it("o total revisado e o payload emitido são 4700, com vínculos distintos", async () => {
    const db = instalarBanco();
    const payloads = focusFalsa(db);
    const listagem = await (await listar(get(), params())).json();
    const servicos: ServicoOS[] = listagem.servicos;
    const valores = { "390:37": "3500,00", "393:37": "1200,00" };
    assert.equal(totalDosServicos(servicos, valores), 4700);
    assert.equal(ancoraDaSelecao([390, 393], servicos), 390);
    const revisao = await revisar(post(390, { servicos: selecaoParaRevisao(servicos) }), params());
    assert.equal(revisao.status, 200, JSON.stringify(await revisao.clone().json()));
    const response = await emitir(post(390, { servicos: selecaoParaEmissao(servicos, valores), codigosFiscais }), params());
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].valor_servico, 4700);
    assert.match(payloads[0].descricao_servico, /OS #390[\s\S]*REPARO DE MODULO VOLVO[\s\S]*OS #393[\s\S]*REPARO DE PAINEL/);
    const nota = db.tabela("nfse")[0];
    assert.equal(nota.valor_total, 4700);
    assert.deepEqual(nota.itens.map((i: any) => [i.ordemservicoid, i.servicoid, i.valor]), [[390, 37, 3500], [393, 37, 1200]]);
    assert.deepEqual(db.chamadasRpc[0].args.p_itens, [
      { ordemservico_id: 390, servico_id: 37 }, { ordemservico_id: 393, servico_id: 37 },
    ]);
  });

  it("selecionar apenas a 393 muda a âncora e não inclui a 390", async () => {
    const db = instalarBanco();
    const payloads = focusFalsa(db);
    const listagem = await (await listar(get(), params())).json();
    const servicos = (listagem.servicos as ServicoOS[]).filter((s) => s.ordemservicoid === 393);
    const ancora = ancoraDaSelecao([390, 393], servicos)!;
    assert.equal(ancora, 393);
    const response = await emitir(post(ancora, { servicos: selecaoParaEmissao(servicos, { "393:37": "1200,00" }), codigosFiscais }), params(ancora));
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    assert.equal(payloads[0].valor_servico, 1200);
    assert.doesNotMatch(payloads[0].descricao_servico, /390|MODULO VOLVO/);
    assert.equal(db.tabela("nfse")[0].ordemservicoid, 393);
    assert.equal(db.tabela("nfse")[0].itens.length, 1);
  });

  it("editar o valor da 393 mantém o valor da 390", () => {
    const servicos = ordens.flatMap((os) => os.osservico);
    const valores = { "390:37": "3500,00", "393:37": "950,50" };
    assert.equal(totalDosServicos(servicos, valores), 4450.5);
    assert.deepEqual(selecaoParaEmissao(servicos, valores).map((s) => s.valor), [3500, 950.5]);
  });

  it("continua aceitando uma OS e o agrupamento legado", async () => {
    const db = instalarBanco();
    const payloads = focusFalsa(db);
    const response = await emitir(post(390, { servicos: [{ osservicoId: 37, valor: 3400 }], osIdsAdicionais: [393], codigosFiscais }), params());
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    assert.equal(payloads[0].valor_servico, 4600);
    assert.deepEqual(normalizarSelecaoNFSe(390, { servicos: [37] }).osIds, [390]);
    assert.equal((await listar(get(""), params())).status, 200);
  });

  it("não retorna um grupo parcial quando uma OS não existe", async () => {
    const db = instalarBanco();
    db.substituir("ordemservico", [ordens[0]]);
    assert.equal((await listar(get(), params())).status, 404);
    assert.equal((await revisar(post(390, { servicos: selecao }), params())).status, 404);
    assert.equal(db.escritas.length, 0);
  });

  it("recusa clientes diferentes na listagem, revisão e emissão", async () => {
    const db = instalarBanco();
    db.tabela("ordemservico")[1].cliente = { ...cliente, id: 999 };
    assert.equal((await listar(get(), params())).status, 400);
    assert.equal((await revisar(post(390, { servicos: selecao }), params())).status, 400);
    assert.equal((await emitir(post(390, { servicos: selecao, codigosFiscais }), params())).status, 400);
    assert.equal(db.escritas.length, 0);
  });

  it("recusa serviço fora da OS, pares duplicados e mistura de formatos", () => {
    assert.throws(() => resolverServicosNFSe(normalizarSelecaoNFSe(390, { servicos: [{ ordemservicoId: 390, osservicoId: 999 }] }), ordens), /não pertence/);
    assert.throws(() => normalizarSelecaoNFSe(390, { servicos: [selecao[0], selecao[0]] }), /duplicado/);
    assert.throws(() => normalizarSelecaoNFSe(390, { servicos: [selecao[0], 37] }), /inválido/);
    assert.throws(() => normalizarSelecaoNFSe(390, { servicos: selecao, osIdsAdicionais: [393] }), /inclusão automática/);
  });

  it("cada OS mantém seu próprio rateio de desconto", async () => {
    const db = instalarBanco();
    db.tabela("ordemservico")[0].orcamentototal = 3150;
    db.tabela("ordemservico")[1].orcamentototal = 1140;
    const body = await (await listar(get(), params())).json();
    assert.deepEqual(body.servicos.map((s: ServicoOS) => [s.descontoRateado, s.valorLiquidoSugerido]), [[350, 3150], [60, 1140]]);
    assert.equal(body.descontoOrigem.servicos, 410);
  });

  it("mostra e bloqueia serviço ocupado por uma nota ancorada fora do grupo", async () => {
    const db = instalarBanco();
    db.substituir("nfse", [{ id: 7, ordemservicoid: 100, status: "AUTORIZADA", servico_ids: [37], itens: [{ ordemservicoid: 393, servicoid: 37, valor: 1200 }] }]);
    db.substituir("nfse_os_servico_vinculo", [{ nfse_id: 7, ordemservico_id: 393, servico_id: 37, ativo: true }]);
    const body = await (await listar(get(), params())).json();
    assert.equal(body.servicos[0].notaFiscalId, null);
    assert.equal(body.servicos[1].notaFiscalId, 7);
    assert.equal(body.servicos[1].notaFiscalValor, 1200);
    const response = await emitir(post(390, { servicos: selecao, codigosFiscais }), params());
    assert.equal(response.status, 409);
    assert.equal(db.escritas.length, 0);
  });

  it("o catálogo da OS agregada não ocupa um serviço ausente no snapshot da âncora", async () => {
    const db = instalarBanco();
    db.substituir("nfse", [{ id: 8, ordemservicoid: 390, status: "AUTORIZADA", servico_ids: [99, 37],
      itens: [{ ordemservicoid: 390, servicoid: 99, valor: 100 }, { ordemservicoid: 393, servicoid: 37, valor: 1200 }] }]);
    const payloads = focusFalsa(db);
    const body = await (await listar(get(), params())).json();
    assert.equal(body.servicos[0].notaFiscalId, null);
    const response = await emitir(post(390, { servicos: [selecao[0]], codigosFiscais }), params());
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    assert.equal(payloads[0].valor_servico, 3500);
  });

  it("uma corrida na reserva impede qualquer chamada à Focus", async () => {
    const db = instalarBanco();
    const payloads = focusFalsa(db);
    // Simula o índice único que protege a reserva em produção.
    const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
    mock.method(supabaseAdmin, "rpc", async () => ({ error: { message: "duplicate key" }, data: null }));
    const response = await emitir(post(390, { servicos: selecao, codigosFiscais }), params());
    assert.equal(response.status, 409);
    assert.equal(payloads.length, 0);
    assert.equal(db.tabela("nfse").length, 0);
  });
});
