// Transição CGSN 191/2026 no fluxo imobiliário: banco, sessão e Focus são simulados.
import "../../services/fiscal/__testEnv";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it, mock } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as politica from "@/lib/services/fiscais/nfse-politica";
import * as recusa from "@/lib/services/fiscais/nfse-recusa";
import * as registro from "@/lib/services/fiscais/nfse-registro";
import * as service from "@/lib/services/fiscais/nfse-service";
import * as transport from "@/lib/services/fiscais/nfse-transport";
import * as schemas from "./schemas";
import * as source from "./nfse-source";

type Row = Record<string, any>;
class ImobError extends Error { constructor(public status: number, message: string, public extra?: Row) { super(message); } }

const EMPRESA = { id: 1, cnpj: "11222333000181", inscricaomunicipal: "12345", razaosocial: "IMOBILIARIA SINTETICA LTDA", regimetributario: "1", ambiente: "HOMOLOGACAO", uf: "PB", timezone_iana: "America/Fortaleza", codigomunicipio: "2507507" };
const PROPRIETARIO = { id: 4, tipopessoa: "JURIDICA", cpfcnpj: "11444777000161", nomerazaosocial: "PROPRIETARIO SINTETICO LTDA", endereco: "RUA DE TESTE", endereconumero: "100", bairro: "CENTRO", codigomunicipio: "2507507", estado: "PB", cep: "58000000" };
const PADRAO_NACIONAL = { codigoTributacaoNacionalIss: "140101", tributacaoIss: "1", tipoRetencaoIss: "1", regimeEspecialTributacao: "0" };
const BODY = { movimento_ids: [9], discriminacao: "Taxa de administracao do imovel", tomador: { codigomunicipio: "2507507", endereco: "RUA DE TESTE", endereconumero: "100", bairro: "CENTRO", estado: "PB", cep: "58000000" } };

function bancoFalso(tabelas: Record<string, Row[]>) {
  const rpcs: Array<{ nome: string; args: Row }> = [];
  const from = (tabela: string) => {
    const filtros: Array<(row: Row) => boolean> = []; let limite = Infinity; let talvez = false;
    const query: any = {
      select: () => query, order: () => query, range: () => query,
      eq: (coluna: string, valor: unknown) => { filtros.push(row => String(row[coluna]) === String(valor)); return query; },
      in: (coluna: string, valores: unknown[]) => { filtros.push(row => valores.map(String).includes(String(row[coluna]))); return query; },
      gt: (coluna: string, valor: number) => { filtros.push(row => Number(row[coluna]) > valor); return query; },
      limit: (n: number) => { limite = n; return query; },
      maybeSingle: () => { talvez = true; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const linhas = (tabelas[tabela] ?? []).filter(row => filtros.every(filtro => filtro(row))).slice(0, limite);
        return Promise.resolve(resolve({ data: talvez ? linhas[0] ?? null : linhas, error: null }));
      },
    };
    return query;
  };
  const db = { from };
  const server = {
    db, ImobError,
    internal: async () => ({ id: "operador-sintetico", ativo: true }),
    one: async (tabela: string, id: number) => { const { data } = await from(tabela).select().eq("id", id).maybeSingle(); if (!data) throw new ImobError(404, "Registro não encontrado."); return data; },
    rpc: async (nome: string, args: Row) => { rpcs.push({ nome, args }); return { id: 77, referencia: args.p_referencia, already_exists: false, status: "PROCESSANDO" }; },
  };
  return { server, rpcs };
}

function carregarModulo(tabelas: Record<string, Row[]>) {
  const { server, rpcs } = bancoFalso(tabelas);
  const dependencias: Record<string, unknown> = {
    "server-only": {}, "node:crypto": crypto, zod,
    "@/lib/services/fiscais/nfse-service": service, "@/lib/services/fiscais/nfse-politica": politica,
    "@/lib/services/fiscais/nfse-transport": transport, "@/lib/services/fiscais/nfse-recusa": recusa,
    "@/lib/services/fiscais/nfse-registro": { ...registro, atualizarRegistroNFSe: async () => null },
    "@/lib/services/fiscais/nfse-sync": { syncNfseWithFocus: async () => ({ ok: true }) },
    "./server": server, "./finance": { financeAccess: async () => ({}), scopeFromUrl: () => ({}) },
    "./schemas": schemas, "./nfse-source": source,
  };
  const codigo = ts.transpileModule(readFileSync(path.join(process.cwd(), "src/lib/imobiliario/nfse.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: Row = {};
  runInNewContext(codigo, { exports, console, Date, process, require: (nome: string) => {
    assert.ok(nome in dependencias, `Dependência inesperada: ${nome}`); return dependencias[nome];
  } });
  return { modulo: exports as { emitServiceInvoice: (body: unknown) => Promise<Row> }, rpcs };
}

function tabelas(empresa: Row = EMPRESA, extras: Record<string, Row[]> = {}) {
  return {
    empresa: [empresa],
    nfse_config: [{ empresa_id: 1, token: "token-sintetico-imob", padroes_emissao: { NACIONAL: PADRAO_NACIONAL } }],
    imovel_movimento: [{ id: 9, tipo: "TAXA_ADMIN", proprietario_id: 4, imovel_id: 2, valor: 150, nfse_id: extras.nfse?.[0]?.id ?? null, descricao: "Taxa" }],
    proprietario: [PROPRIETARIO],
    ...extras,
  };
}

function focusFalsa(habilitaNacional: boolean) {
  const chamadas: Array<{ metodo: string; url: string }> = [];
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    chamadas.push({ metodo: String(init?.method ?? "GET"), url: String(url) });
    if (String(url).includes("/v2/empresas?cnpj=")) {
      return new Response(JSON.stringify([{ cnpj: EMPRESA.cnpj, habilita_nfse: true, habilita_nfsen_producao: habilitaNacional, habilita_nfsen_homologacao: habilitaNacional }]));
    }
    return new Response(JSON.stringify({ status: "processando_autorizacao" }), { status: 202 });
  });
  return chamadas;
}

afterEach(() => mock.restoreAll());

describe("NFS-e imobiliária na transição de novembro de 2026", () => {
  it("Simples em 02/11 sem Ambiente Nacional habilitado na Focus bloqueia antes de reservar a nota", async () => {
    const chamadas = focusFalsa(false); const { modulo, rpcs } = carregarModulo(tabelas());
    await assert.rejects(modulo.emitServiceInvoice({ ...BODY, acao: "EMITIR", data_competencia: "2026-11-02" }), (error: ImobError) => error.status === 422);
    assert.equal(rpcs.length, 0);
    assert.deepEqual(chamadas.map(chamada => chamada.metodo), ["GET"]);
  });

  it("Simples em 02/11 confere a Focus, grava autorizador e competência na reserva e envia ao Emissor Nacional", async () => {
    const chamadas = focusFalsa(true); const { modulo, rpcs } = carregarModulo(tabelas());
    const resposta = await modulo.emitServiceInvoice({ ...BODY, acao: "EMITIR", data_competencia: "2026-11-02" });
    assert.equal(resposta.item.id, 77);
    assert.equal(rpcs.length, 1);
    assert.equal(rpcs[0].args.p_autorizador, "FOCUS_NACIONAL");
    assert.equal(rpcs[0].args.p_data_competencia, "2026-11-02");
    assert.equal(rpcs[0].args.p_modelo, "NACIONAL");
    assert.deepEqual(chamadas.map(chamada => chamada.metodo), ["GET", "POST"]);
    assert.match(chamadas[1].url, /\/v2\/nfsen\?ref=IMOB_/);
  });

  it("Cabedelo: correção em novembro de nota rejeitada de 30/10 mantém a competência e o emissor municipal", async () => {
    focusFalsa(true);
    const empresa = { ...EMPRESA, codigomunicipio: "2503209" };
    const rejeitada = { id: 55, empresaid: 1, status: "REJEITADA", modelo_emissao: "MUNICIPAL_CABEDELO", data_competencia: "2026-10-30", payload_enviado: { data_emissao: "2026-10-30T10:00:00" } };
    const { modulo } = carregarModulo(tabelas(empresa, { nfse: [rejeitada], imovel_nfse_origem: [{ nfse_id: 55, imovel_id: 2 }] }));
    const correcao = await modulo.emitServiceInvoice({ ...BODY, acao: "PREPARAR", nfse_id: 55, data_competencia: "2026-11-02" });
    assert.equal(correcao.preview.data_competencia, "2026-10-30");
    assert.equal(correcao.preview.modelo, "MUNICIPAL_CABEDELO");
    const nova = await modulo.emitServiceInvoice({ ...BODY, acao: "PREPARAR", data_competencia: "2026-11-02" });
    assert.equal(nova.preview.modelo, "NACIONAL");
  });

  it("nota legada sem coluna de competência usa a data do envio original", async () => {
    focusFalsa(true);
    const empresa = { ...EMPRESA, codigomunicipio: "2503209" };
    const rejeitada = { id: 56, empresaid: 1, status: "REJEITADA", modelo_emissao: "MUNICIPAL_CABEDELO", data_competencia: null, payload_enviado: { data_emissao: "2026-10-29T23:30:00" } };
    const { modulo } = carregarModulo(tabelas(empresa, { nfse: [rejeitada], imovel_nfse_origem: [{ nfse_id: 56, imovel_id: 2 }] }));
    const correcao = await modulo.emitServiceInvoice({ ...BODY, acao: "PREPARAR", nfse_id: 56 });
    assert.equal(correcao.preview.data_competencia, "2026-10-29");
    assert.equal(correcao.preview.modelo, "MUNICIPAL_CABEDELO");
  });
});
