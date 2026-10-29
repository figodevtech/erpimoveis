import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";
import * as XLSX from "xlsx";
import * as regra from "./autoria-regra";
import * as constants from "@/app/api/_authz/permission-constants";

const FINANCEIRO = "11111111-1111-1111-1111-111111111111";
const ADMIN = "22222222-2222-2222-2222-222222222222";
const ESTOQUE = "33333333-3333-3333-3333-333333333333";
const PERMISSAO = constants.PERMS.FINANCEIRO_VER_TODAS_TRANSACOES;

type Row = Record<string, any>;
function usuario(id: string, administrativo = false, ativo = true): Row {
  return { id, ativo, perfil: { perfilpermissao: administrativo ? [{ permissao: { nome: PERMISSAO } }] : [] } };
}
function transacao(id: number, created_by: string | null, extra: Row = {}): Row {
  return {
    id, created_by, descricao: "Conta de estoque " + id, tipo: "DESPESA", valor: 100,
    valorLiquido: 100, valor_descontos: 0, valor_baixado: 0, valor_acrescimos: 0,
    pendente: true, is_deleted: false, data: "2026-10-07T15:00:00Z",
    ordemservicoid: null, vendaid: null, baixa_de_transacao_id: null,
    transferencia_id: null, lancamento_id: null, pagamento_multiplo_id: null,
    eh_adiantamento: false, adiantamento_id: null, parcelamento_id: null,
    evento_financeiro_id: null, banco_id: null, ...extra,
  };
}

function load(relative: string, dependencies: Record<string, unknown>): any {
  const filename = path.join(process.cwd(), relative);
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  const localRequire = createRequire(filename);
  runInNewContext(code, {
    exports, URL, Date, Set, Map, Response, console, Buffer,
    require: (name: string) => name in dependencies ? dependencies[name] : localRequire(name),
  });
  return exports;
}

// Transporte HTTP simulado; usa o builder real e interpreta filtros PostgREST.
function separar(texto: string): string[] {
  let nivel = 0, inicio = 0;
  const partes: string[] = [];
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    if (texto[i] === ")") nivel--;
    if (texto[i] === "," && nivel === 0) { partes.push(texto.slice(inicio, i)); inicio = i + 1; }
  }
  partes.push(texto.slice(inicio));
  return partes;
}
function corresponde(row: Row, expressao: string): boolean {
  for (const logica of ["and", "or"]) {
    if (expressao.startsWith(logica + "(")) {
      const valores = separar(expressao.slice(logica.length + 1, -1)).map((parte) => corresponde(row, parte));
      return logica === "and" ? valores.every(Boolean) : valores.some(Boolean);
    }
  }
  const ponto = expressao.indexOf(".");
  const campo = expressao.slice(0, ponto), filtro = expressao.slice(ponto + 1);
  const valor = row[campo] ?? null;
  if (filtro.startsWith("not.")) return !corresponde(row, campo + "." + filtro.slice(4));
  const opFim = filtro.indexOf("."), op = filtro.slice(0, opFim), alvo = filtro.slice(opFim + 1);
  if (op === "is") return alvo === "null" ? valor == null : String(valor) === alvo;
  if (op === "eq") return String(valor) === alvo;
  if (op === "in") return separar(alvo.slice(1, -1)).includes(String(valor));
  if (op === "gte") return valor >= alvo;
  if (op === "lt") return valor < alvo;
  if (op === "ilike") return String(valor).toLowerCase().includes(alvo.replaceAll("*", "").replaceAll("%", "").toLowerCase());
  throw new Error("Filtro não implementado no transporte de teste: " + expressao);
}

function montar(options: { administrativo?: boolean; podeEditar?: boolean; acessoVendas?: boolean } = {}) {
  const state = {
    usuarios: [usuario(FINANCEIRO), usuario(ESTOQUE), usuario(ADMIN, true, false)],
    transacoes: [
      transacao(10, ESTOQUE, { entrada_id: 99 }), transacao(20, ADMIN), transacao(30, null),
      transacao(11, ESTOQUE, { pendente: false, banco_id: 1, tipo: "RECEITA", valor: 75, valorLiquido: 75 }),
      transacao(21, ADMIN, { pendente: false, banco_id: 1, tipo: "RECEITA", valor: 250, valorLiquido: 250 }),
      transacao(31, null, { pendente: false, banco_id: 1, tipo: "RECEITA", valor: 5, valorLiquido: 5 }),
    ],
    rateios: [] as Row[], falharUsuarios: false,
  };
  const requests: URL[] = [], mutations: Array<{ nome: string; body: Row }> = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    const tabela = url.pathname.split("/").at(-1)!;
    if (url.pathname.includes("/rpc/")) {
      const body = JSON.parse(String(init?.body));
      mutations.push({ nome: tabela, body });
      if (tabela === "baixar_transacao_pendente") {
        const tx = state.transacoes.find((item) => String(item.id) === String(body.p_transacao_id))!;
        tx.pendente = false; tx.banco_id = body.p_banco_id; tx.baixado_por = body.p_baixado_por;
        return Response.json(tx);
      }
      if (tabela === "dre_linha_da_transacao") return Response.json([]);
      if (tabela === "conciliar_movimentos_ofx") return Response.json({ transacao_id: body.p_transacao_id });
      throw new Error("RPC inesperada: " + tabela);
    }
    if (tabela === "usuario" && state.falharUsuarios) return Response.json({ message: "Falha ao ler criadores" }, { status: 500 });
    const tables: Record<string, Row[]> = {
      usuario: state.usuarios, transacao: state.transacoes, pagamento_multiplo_rateio: state.rateios,
      transacao_baixa_historico: [], transacao_valor_historico: [], transacao_contraparte_historico: [],
      transacao_transferencia: [{ id: 77, valor: 100 }],
      bancoconta: [{ id: 1, titulo: "Banco comum", valorinicial: 1000, ativo: true }],
    };
    assert.ok(tabela in tables, "Tabela inesperada: " + tabela);
    let rows = [...tables[tabela]];
    for (const [campo, filtro] of url.searchParams) {
      if (["select", "order", "offset", "limit"].includes(campo)) continue;
      rows = rows.filter((row) => campo === "or"
        ? separar(filtro.slice(1, -1)).some((clausula) => corresponde(row, clausula))
        : corresponde(row, campo + "." + filtro));
    }
    const total = rows.length;
    const ordem = url.searchParams.get("order");
    if (ordem) rows.sort((a, b) => {
      for (const termo of ordem.split(",")) {
        const [campo, direcao] = termo.split(".");
        if (a[campo] === b[campo]) continue;
        return (a[campo] > b[campo] ? 1 : -1) * (direcao === "desc" ? -1 : 1);
      }
      return 0;
    });
    const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 1000);
    rows = rows.slice(offset, offset + limit);
    const headers = { "content-range": offset + "-" + (offset + rows.length - 1) + "/" + total };
    if (init?.method === "HEAD") return new Response(null, { headers });
    const objeto = new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object");
    return Response.json(objeto ? rows[0] : rows, { headers });
  };
  const supabaseAdmin = createClient("https://caixa.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
  });
  const perms = {
    getCurrentUserAccess: async () => ({ id: FINANCEIRO, ativo: true, permissoes: options.administrativo ? [PERMISSAO] : [] }),
    hasVendasAccess: async () => options.acessoVendas ?? false,
    requireFinanceirosAccess: async () => {},
    requireFinanceiroEdit: async () => { if (options.podeEditar === false) throw Object.assign(new Error("Sem permissão para editar"), { statusCode: 403 }); },
  };
  const dependencies: Record<string, unknown> = {
    "@/lib/movement-authors": { carregarAutores: async () => new Map() },
    "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/app/api/_authz/perms": perms, "@/app/api/_authz/permission-constants": constants,
    "@/lib/auth": { auth: async () => ({ user: { id: FINANCEIRO } }) },
    "./autoria-regra": regra,
    "@/app/api/transaction/_lib/edicao": { respostaSeEdicaoBloqueada: async () => null },
    "@/lib/payment-methods-server": { getPaymentMethodValues: async () => ["PIX"] },
    "@/lib/monitoring/erp-diagnostic": { reportErpDiagnostic: () => {} },
    "./_lib/documento": {}, "./_lib/bandeira": {},
  };
  dependencies["@/lib/supabase-pagination"] = load("src/lib/supabase-pagination.ts", dependencies);
  const autoria = load("src/app/api/transaction/_lib/autoria.ts", dependencies);
  for (const alias of ["./autoria", "../_lib/autoria", "../../_lib/autoria", "./_lib/autoria", "@/app/api/transaction/_lib/autoria"]) dependencies[alias] = autoria;
  const afetadas = load("src/app/api/transaction/_lib/autoria-afetadas.ts", dependencies);
  return { state, requests, mutations, autoria, afetadas, load: (file: string) => load(file, dependencies) };
}

test("consulta todos os criadores em páginas e inclui administrador desativado", async () => {
  const h = montar();
  h.state.usuarios = Array.from({ length: 1001 }, (_, i) => usuario("comum-" + i));
  h.state.usuarios.push(usuario(ADMIN, true, false));
  const contexto = await h.autoria.contextoDeAutoria();
  assert.equal(contexto.autoresAdministrativos.has(ADMIN), true);
  const urls = h.requests.filter((url) => url.pathname.endsWith("/usuario"));
  assert.deepEqual(urls.map((url) => url.searchParams.get("offset")), ["0", "1000"]);
  assert.ok(urls.every((url) => !url.searchParams.has("ativo")));
});

test("reutiliza contexto e a próxima requisição acompanha a mudança do perfil do criador", async () => {
  const h = montar();
  const contexto = await h.autoria.contextoDeAutoria();
  await h.autoria.recorteDeAutoria(false, contexto);
  const podeAlterar = await h.autoria.criterioDeAlteracao(contexto);
  await h.autoria.exigirAcessoATransacao(10, contexto);
  assert.equal(podeAlterar(ESTOQUE), true);
  assert.equal(h.requests.filter((url) => url.pathname.endsWith("/usuario")).length, 1);
  h.state.usuarios.find((user) => user.id === ESTOQUE)!.perfil.perfilpermissao = [{ permissao: { nome: PERMISSAO } }];
  await assert.rejects(h.autoria.exigirAcessoATransacao(10), (err: any) => err.statusCode === 403);
  h.state.usuarios.find((user) => user.id === ESTOQUE)!.perfil.perfilpermissao = [];
  await h.autoria.exigirAcessoATransacao(10);
});

test("conta criada na entrada de estoque aparece em A Pagar e financeiro comum dá baixa sem transferir autoria", async () => {
  const h = montar();
  const list = h.load("src/app/api/transaction/route.ts");
  const response = await list.GET(new Request("https://app.test/api/transaction?pendente=true&tipos=DESPESA&limit=1&ordenarPor=id&ordem=asc"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.pagination.total, 2);
  assert.equal(data.data[0].id, 10);
  assert.equal(data.data[0].pode_alterar, true);
  assert.equal(data.filters.apenasMinhas, false);
  const route = h.load("src/app/api/transaction/[id]/baixar/route.ts");
  const baixa = await route.POST(new Request("https://app.test/api/transaction/10/baixar", {
    method: "POST", body: JSON.stringify({ dataPagamento: "2026-10-07", bancoId: 1, metodoPagamento: "PIX" }),
  }), { params: Promise.resolve({ id: "10" }) });
  assert.equal(baixa.status, 200);
  assert.equal(h.mutations.length, 1);
  assert.equal(h.state.transacoes[0].created_by, ESTOQUE);
  assert.equal(h.state.transacoes[0].baixado_por, FINANCEIRO);
});

test("baixa administrativa e usuário sem permissão de edição são recusados antes da RPC", async () => {
  for (const [h, id] of [[montar(), "20"], [montar({ podeEditar: false }), "10"]] as const) {
    const route = h.load("src/app/api/transaction/[id]/baixar/route.ts");
    const response = await route.POST(new Request("https://app.test/api/transaction/" + id + "/baixar", { method: "POST", body: "{}" }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 403);
    assert.equal(h.mutations.length, 0);
  }
});

test("falha ao consultar criadores não libera nenhuma operação", async () => {
  const h = montar(); h.state.falharUsuarios = true;
  await assert.rejects(h.autoria.recorteDeAutoria(false));
  const route = h.load("src/app/api/transaction/[id]/baixar/route.ts");
  const response = await route.POST(new Request("https://app.test/api/transaction/10/baixar", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "10" }) });
  assert.equal(response.status, 500);
  assert.equal(h.mutations.length, 0);
});

test("pagamentos administrativos preservam exceção de leitura só em venda, sem escrita", async () => {
  const h = montar({ acessoVendas: true });
  h.state.transacoes.push(transacao(22, ADMIN, { ordemservicoid: 9 }), transacao(23, ADMIN, { vendaid: 8 }), transacao(24, ADMIN), transacao(25, ADMIN));
  h.state.rateios.push({ id: 1, transacao_id: 24, tipo_documento: "OS" }, { id: 2, transacao_id: 25, tipo_documento: "VENDA" });
  await h.autoria.exigirLeituraDeTransacao([23, 25]);
  await assert.rejects(h.autoria.exigirAcessoATransacao([23, 25]), (err: any) => err.statusCode === 403);
  // OS antiga, direta ou rateada, não tem mais quem a leia pelo documento.
  await assert.rejects(h.autoria.exigirLeituraDeTransacao(22), (err: any) => err.statusCode === 403);
  await assert.rejects(h.autoria.exigirLeituraDeTransacao(24), (err: any) => err.statusCode === 403);
  await assert.rejects(montar().autoria.exigirLeituraDeTransacao(20), (err: any) => err.statusCode === 403);
});

test("bancos, saldos acumulados e indicadores excluem caixa administrativo", async () => {
  const h = montar();
  const bancos = h.load("src/app/api/bancos/resumo/route.ts");
  const response = await bancos.GET(new Request("https://app.test/api/bancos/resumo?bancoId=1"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.totals.entradas, 80);
  assert.equal(body.totals.saldoAtual, 1080);
  assert.deepEqual(body.transacoes.items.map((item: Row) => item.id), [31, 11]);
  assert.equal(body.transacoes.items.find((item: Row) => item.id === 31).saldoApos, 1080);
  const kpis = h.load("src/app/api/transaction/kpis/route.ts");
  for (const mode of ["FLUXO", "LIQUIDADAS", "A_PAGAR", "A_RECEBER"]) {
    const result = await kpis.GET(new Request("https://app.test/api/transaction/kpis?viewMode=" + mode + "&dateFrom=2026-10-01&dateTo=2026-10-31"));
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.ok(!JSON.stringify(data).includes("250"));
  }
});

test("saldo do período parte do saldo anterior, fecha no centavo e bate com a coluna Saldo", async () => {
  const h = montar();
  const liquidada = { pendente: false, banco_id: 1 };
  h.state.transacoes.push(
    transacao(41, ESTOQUE, { ...liquidada, tipo: "DESPESA", valor: 30, valorLiquido: 30, data: "2026-10-20T15:00:00Z" }),
    transacao(42, ESTOQUE, { ...liquidada, tipo: "RECEITA", valor: 0.1, valorLiquido: 0.1, data: "2026-10-21T15:00:00Z" }),
    transacao(43, null, { ...liquidada, tipo: "RECEITA", valor: 0.2, valorLiquido: 0.2, data: "2026-10-22T15:00:00Z" }),
  );
  const bancos = h.load("src/app/api/bancos/resumo/route.ts");
  const response = await bancos.GET(
    new Request("https://app.test/api/bancos/resumo?bancoId=1&dateFrom=2026-10-10&dateTo=2026-10-31"),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  // 1000 do cadastro + 75 + 5 liquidados antes de 10/10; os 250 administrativos ficam fora.
  assert.equal(body.totals.saldoAnterior, 1080);
  assert.equal(body.totals.entradas, 0.3);
  assert.equal(body.totals.saidas, 30);
  assert.equal(body.totals.saldoAtual, 1050.3);
  assert.equal(body.items[0].saldoAnterior, 1080);
  assert.deepEqual(body.transacoes.items.map((item: Row) => item.id), [43, 42, 41]);
  assert.equal(body.transacoes.items[0].saldoApos, body.totals.saldoAtual);
});

test("exportação contém os lançamentos compartilhados e exclui os administrativos", async () => {
  const h = montar();
  const route = h.load("src/app/api/transaction/export/route.ts");
  const response = await route.GET(new Request("https://app.test/api/transaction/export?pendente=true"));
  assert.equal(response.status, 200);
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
  assert.deepEqual(rows.slice(1).map((row) => row[0]), [10, 30]);
});

test("administrador mantém consulta completa e filtro opcional de próprias", async () => {
  const h = montar({ administrativo: true });
  assert.equal((await h.autoria.recorteDeAutoria(false)).modo, "TODAS");
  assert.equal((await h.autoria.recorteDeAutoria(true)).modo, "MINHAS");
  await h.autoria.exigirAcessoATransacao([10, 20]);
  assert.equal(h.requests.length, 0);
});

test("lote misto e exclusão de grupo com parcela administrativa são recusados", async () => {
  const h = montar();
  await assert.rejects(h.afetadas.exigirAcessoAOperacao([10, 20], "EXCLUIR"), (err: any) => err.statusCode === 403);
  h.state.transacoes[0].transferencia_id = 7;
  h.state.transacoes[1].transferencia_id = 7;
  await assert.rejects(h.afetadas.exigirAcessoAOperacao([10], "EXCLUIR"), (err: any) => err.statusCode === 403);
  h.state.transacoes[0].pagamento_multiplo_id = 6;
  h.state.transacoes[1].pagamento_multiplo_id = 6;
  await assert.rejects(h.afetadas.exigirAcessoAPagamentoMultiplo(6), (err: any) => err.statusCode === 403);
  assert.equal(h.mutations.length, 0);
});

test("reparcelamento, estorno e alteração de baixa parcial verificam todas as transações afetadas", async () => {
  const h = montar();
  h.state.transacoes[0].parcelamento_id = 5;
  h.state.transacoes[1].parcelamento_id = 5;
  await assert.rejects(h.afetadas.exigirAcessoAOperacao([10], "REPARCELAR"), (err: any) => err.statusCode === 403);
  h.state.transacoes.push(transacao(40, ADMIN, { baixa_de_transacao_id: 10 }));
  await assert.rejects(h.afetadas.exigirAcessoAOperacao([10], "ESTORNAR"), (err: any) => err.statusCode === 403);
  h.state.transacoes.push(transacao(41, ESTOQUE, { baixa_de_transacao_id: 20 }));
  await assert.rejects(h.autoria.exigirAcessoATransacao(41), (err: any) => err.statusCode === 403);
});

test("conciliação sugere somente transações compartilhadas e rejeita confirmação administrativa", async () => {
  const h = montar();
  const analise = h.load("src/app/api/financeiro/conciliacao/ofx/_lib/analise.ts");
  const candidatos = await analise.carregarCandidatos(1);
  assert.deepEqual(Array.from(candidatos, (item: Row) => item.id), [10, 11, 30, 31]);
  const conciliar = h.load("src/app/api/financeiro/conciliacao/ofx/_lib/conciliar.ts");
  await conciliar.aplicarDecisao([1], { acao: "VINCULAR", transacaoId: 11 }, FINANCEIRO);
  assert.equal(h.mutations.length, 1);
  await assert.rejects(conciliar.validarAcessoDasDecisoes([
    { acao: "VINCULAR", transacaoId: 11 }, { acao: "LIQUIDAR", transacaoId: 20 },
  ]), (err: any) => err.statusCode === 403);
  await assert.rejects(conciliar.aplicarDecisao([2], { acao: "VINCULAR", transacaoId: 21 }, FINANCEIRO), (err: any) => err.statusCode === 403);
  assert.equal(h.mutations.length, 1);
});


test("vínculos auxiliares ocultam autores administrativos e preservam a exceção de venda", async () => {
  const h = montar();
  const contexto = await h.autoria.contextoDeAutoria();
  const itens = await h.autoria.filtrarTransacoesLegiveis(h.state.transacoes, contexto);
  assert.deepEqual(itens.map((item: Row) => item.id), [10, 30, 11, 31]);
  const comVendas = montar({ acessoVendas: true });
  comVendas.state.transacoes.find((item) => item.id === 20)!.vendaid = 99;
  const legiveis = await comVendas.autoria.filtrarTransacoesLegiveis(comVendas.state.transacoes, await comVendas.autoria.contextoDeAutoria());
  assert.ok(legiveis.some((item: Row) => item.id === 20));
  assert.ok(!legiveis.some((item: Row) => item.id === 21));
  // A mesma transação ligada a uma OS antiga continua oculta.
  const comOS = montar({ acessoVendas: true });
  comOS.state.transacoes.find((item) => item.id === 20)!.ordemservicoid = 99;
  const ocultas = await comOS.autoria.filtrarTransacoesLegiveis(comOS.state.transacoes, await comOS.autoria.contextoDeAutoria());
  assert.ok(!ocultas.some((item: Row) => item.id === 20));
});

test("contexto da baixa comum não divulga título pai administrativo", async () => {
  const h = montar();
  h.state.transacoes.find((item) => item.id === 10)!.baixa_de_transacao_id = 20;
  const route = h.load("src/app/api/transaction/[id]/contexto/route.ts");
  const response = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ id: "10" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).baixaDe, null);
});

test("consulta de transferência recusa contraparte administrativa", async () => {
  const h = montar();
  for (const id of [10, 20]) h.state.transacoes.find((item) => item.id === id)!.transferencia_id = 77;
  const route = h.load("src/app/api/transaction/transferencia/route.ts");
  const response = await route.GET(new Request("http://localhost/api/transaction/transferencia?transacaoId=10"));
  assert.equal(response.status, 403);
  assert.equal(h.mutations.length, 0);
});
