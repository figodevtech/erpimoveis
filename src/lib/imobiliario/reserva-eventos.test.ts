import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

type Row = Record<string, any>;

function ambiente(evento: Row, permissoes: string[] = [], bloqueada = false, caixaRestrito = false, tabelas?: Record<string, Row[]>) {
  const chamadas: Row[] = [];
  class ImobError extends Error { constructor(public status: number, message: string) { super(message); } }
  const dependencias: Row = {
    "server-only": {}, "node:crypto": {}, zod: { z },
    "@/lib/financeiro/eventos-autoria": { comCriadoPor: async (linhas: Row[]) => linhas },
    "@/lib/financeiro/eventos-financeiros/competencia": { mesesDeCompetenciaFechada: () => [] },
    "@/app/api/_authz/permission-constants": {
      PERMS: { FINANCEIRO_EDITAR: "financeiro:editar", FINANCEIRO_EXCLUIR: "financeiro:excluir", ESTOQUE_EDITAR: "estoque:editar", USOCONSUMO_SAIDA: "usoconsumo:saida" },
      permissionSetHas: (lista: string[], valor: string) => lista.includes(valor),
    },
    "@/app/api/transaction/_lib/edicao": {
      respostaSeEdicaoBloqueada: async () => bloqueada ? new Response(JSON.stringify({ error: "Edição desativada" }), { status: 403 }) : null,
    },
    "@/app/api/transaction/_lib/autoria": {
      exigirAcessoATransacao: async () => { if (caixaRestrito) throw Object.assign(new Error("Caixa administrativo"), { statusCode: 403 }); },
    },
    "./server": {
      db: { from: (tabela: string) => {
        const filtros: Array<(linha: Row) => boolean> = [];
        const consulta: Row = {
          select: () => consulta, order: () => consulta,
          eq: (campo: string, valor: unknown) => { filtros.push((linha) => linha[campo] === valor); return consulta; },
          neq: (campo: string, valor: unknown) => { filtros.push((linha) => linha[campo] !== valor); return consulta; },
          is: (campo: string, valor: unknown) => { filtros.push((linha) => (linha[campo] ?? null) === valor); return consulta; },
          contains: (campo: string, valor: Row) => { filtros.push((linha) => Object.entries(valor).every(([chave, item]) => linha[campo]?.[chave] === item)); return consulta; },
          in: (campo: string, valores: unknown[]) => { filtros.push((linha) => valores.includes(linha[campo])); return consulta; },
          then: (resolve: (resultado: Row) => unknown) => Promise.resolve({
            data: tabelas ? (tabelas[tabela] ?? []).filter((linha) => filtros.every((filtro) => filtro(linha))) : [{ id: 23 }], error: null,
          }).then(resolve),
        };
        return consulta;
      } },
      ImobError, one: async (tabela: string) => tabelas?.[tabela]?.[0] ?? evento,
      internal: async (permissao: string) => { if (!permissoes.includes(permissao)) throw new ImobError(403, "Sem permissão"); },
      rpc: async (nome: string, payload: Row) => { chamadas.push({ nome, ...payload }); return { competencia_em: "2026-11-08" }; },
    },
    "./schemas": { civilDate: z.iso.date() },
    "./finance": { financeAccess: async () => ({ id: "operador", permissoes }) },
    "./types": {},
  };
  const codigo = ts.transpileModule(readFileSync(path.join(process.cwd(), "src/lib/imobiliario/reserva-eventos.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: Row = {};
  runInNewContext(codigo, { exports, console, Date, process, require: (nome: string) => {
    assert.ok(nome in dependencias, `Dependência inesperada: ${nome}`); return dependencias[nome];
  } });
  return { modulo: exports, chamadas };
}

test("edição aceita taxa automática da própria reserva e encaminha a versão original", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "IMOVEL_TAXA", dados_snapshot: { reserva_id: 7 } });
  await modulo.alterarEventoDaReserva(7, 12, "EDITAR", { valor: 25, atualizado_em: "2026-11-08T12:00:00Z" });
  assert.equal(chamadas[0].p_payload.valor, 25);
  assert.equal(chamadas[0].p_payload.atualizado_em, "2026-11-08T12:00:00Z");
  assert.equal(chamadas[0].p_reserva_id, 7);
});

test("evento de outra reserva é recusado antes de gravar", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "IMOVEL_TAXA", dados_snapshot: { reserva_id: 8 } });
  await assert.rejects(() => modulo.alterarEventoDaReserva(7, 12, "EDITAR", { valor: 25 }), { status: 404 });
  assert.equal(chamadas.length, 0);
});

test("cliente não pode forjar a autorização para editar parcelas", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7 });
  await modulo.alterarEventoDaReserva(7, 12, "EDITAR", { valor: 25, pode_editar_financeiro: true });
  assert.equal(chamadas[0].p_payload.pode_editar_financeiro, false);
});

test("custo lançado exige permissão para editar o financeiro", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7, lancamento_id: 4 });
  await assert.rejects(() => modulo.alterarEventoDaReserva(7, 12, "EDITAR", { valor: 25 }), { status: 403 });
  assert.equal(chamadas.length, 0);
});

test("custo lançado respeita configuração que desativa edição de transações", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7, lancamento_id: 4 }, ["financeiro:editar"], true);
  await assert.rejects(() => modulo.alterarEventoDaReserva(7, 12, "EDITAR", { valor: 25 }), { status: 403 });
  assert.equal(chamadas.length, 0);
});

test("custo lançado pode ser editado com a permissão e configuração corretas", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7, lancamento_id: 4 }, ["financeiro:editar"]);
  await modulo.alterarEventoDaReserva(7, 12, "EDITAR", { valor: 25 });
  assert.equal(chamadas[0].p_payload.pode_editar_financeiro, true);
});

test("edição de evento não permite alterar transação de caixa administrativo restrito", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7, lancamento_id: 4 }, ["financeiro:editar"], false, true);
  await assert.rejects(() => modulo.alterarEventoDaReserva(7, 12, "EDITAR", { valor: 25 }), { status: 403 });
  assert.equal(chamadas.length, 0);
});

test("exclusão de taxa automática usa a rotina de exclusão e encaminha a versão", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "IMOVEL_TAXA", dados_snapshot: { reserva_id: 7 } });
  await modulo.excluirEventoDaReserva(7, 12, { atualizado_em: "2026-11-08T12:00:00Z" });
  assert.equal(chamadas[0].nome, "imob_excluir_evento_reserva");
  assert.equal(chamadas[0].p_payload.atualizado_em, "2026-11-08T12:00:00Z");
});

test("exclusão recusa eventos de outra reserva", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 8 });
  await assert.rejects(() => modulo.excluirEventoDaReserva(7, 12), { status: 404 });
  assert.equal(chamadas.length, 0);
});

test("exclusão de custo vinculado exige permissão de excluir, independente da edição", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7, lancamento_id: 4 }, ["financeiro:editar"]);
  await assert.rejects(() => modulo.excluirEventoDaReserva(7, 12, { pode_excluir_financeiro: true }), { status: 403 });
  assert.equal(chamadas.length, 0);
});

test("exclusão de custo vinculado respeita restrição de caixa administrativo", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7, lancamento_id: 4 }, ["financeiro:excluir"], false, true);
  await assert.rejects(() => modulo.excluirEventoDaReserva(7, 12), { status: 403 });
  assert.equal(chamadas.length, 0);
});

test("exclusão de custo lançado usa a permissão de excluir sem depender de editar", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7, lancamento_id: 4 }, ["financeiro:excluir"], true);
  await modulo.excluirEventoDaReserva(7, 12);
  assert.equal(chamadas[0].p_payload.pode_excluir_financeiro, true);
});

test("exclusão de consumo exige acesso ao estoque correspondente", async () => {
  const { modulo, chamadas } = ambiente({ source_type: "RESERVA", source_id: 7, origem: "CONSUMO", consumo_saida_id: 4 });
  await assert.rejects(() => modulo.excluirEventoDaReserva(7, 12), { status: 403 });
  assert.equal(chamadas.length, 0);
});

test("resultado da reserva lista valor informativo e custos, sem a taxa de administração, sem duplicar receita ou custos", async () => {
  const { modulo } = ambiente({}, [], false, false, {
    reserva_imovel: [{ id: 7, valor_total: 1000, percentual_admin: 10 }],
    eventos_financeiros: [
      { id: 1, source_type: "RESERVA", source_id: 7, origem: "RECEITA_RESERVA", natureza: "RECEITA", valor: 1000, status: "ATIVO", dre_linha_id: null },
      { id: 2, source_type: "RESERVA", source_id: 7, origem: "DESPESA_RESERVA", natureza: "DESPESA", valor: 100, status: "ATIVO", dre_linha_id: null },
      { id: 3, source_type: "IMOVEL_TAXA", origem: "ADMINISTRACAO_IMOBILIARIA", natureza: "RECEITA", valor: 25, status: "ATIVO", dados_snapshot: { reserva_id: 7 } },
    ],
  });
  const resultado = await modulo.listarEventosDaReserva(7);
  // A taxa de administração não é linha do painel (ela é o resultado), mas segue nos totais.
  assert.equal(resultado.eventos.length, 2);
  assert.equal(resultado.eventos.some((linha: Row) => linha.source_type === "IMOVEL_TAXA"), false);
  assert.equal(resultado.eventos.find((linha: Row) => linha.id === 1).informativo, true);
  assert.equal(resultado.eventos.find((linha: Row) => linha.id === 1).automatico, true);
  assert.equal(resultado.totais.receita, 25);
  assert.equal(resultado.totais.custos, 100);
  assert.equal(resultado.totais.resultado, -75);
  assert.equal(resultado.totais.resultado_previsto, 900);
});
