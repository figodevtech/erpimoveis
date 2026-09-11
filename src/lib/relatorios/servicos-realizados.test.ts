import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { agruparServicos, autoresDasAtribuicoes, duracaoSegundos, duracaoTexto, lerFiltrosServicos, limitesPeriodo, linhasOrdenadas, normalizarServico, somarServicos, type EventoAtribuicao, type LinhaServico } from "./servicos-realizados";
import { aplicarFiltrosServicos } from "./servicos-realizados-consulta";
import { criarWorkbookServicos, lerWorkbookServicos } from "./servicos-realizados-workbook";

const uid = "00000000-0000-4000-8000-000000000001";
function linha(override: Partial<LinhaServico> = {}): LinhaServico {
  return { ordemId: 1, servicoId: 10, realizadorId: uid, realizador: "Ana", percentualAtual: 15,
    setorRealizadorId: "9", setorRealizador: "Elétrica",
    setorId: "1", setor: "Mecânica", criadorId: "criador-1", criador: "Carlos", atribuidoPor: "Bruno",
    statusOS: "PAGAMENTO", cliente: "Cliente", descricao: "Troca de óleo", complemento: "Motor quente", quantidade: 2,
    valorServico: 1000, baseComissao: 450, percentualAplicado: 10, comissao: 45,
    situacao: "FINALIZADO", inicio: "2026-09-10T12:00:00.900Z", fim: "2026-09-10T14:10:02.100Z", dataReferencia: "2026-09-01T12:00:00.000Z", ...override };
}
test("filtros permitem todos os status, orçamento e período livre", () => {
  const f = lerFiltrosServicos(new URLSearchParams());
  assert.equal(f.campoData, "entrada"); assert.equal(f.agruparPor, "realizador"); assert.deepEqual(f.status, []);
  assert.deepEqual(limitesPeriodo(f), { inicio: null, fim: null });
  assert.deepEqual(lerFiltrosServicos(new URLSearchParams("status=ORCAMENTO,EM_ANDAMENTO,ORCAMENTO")).status, ["ORCAMENTO", "EM_ANDAMENTO"]);
});
test("validação recusa datas inexistentes, inversão, IDs e enumerações inválidas", () => {
  for (const value of ["dateFrom=2026-02-30", "dateFrom=2026-13-01", "dateFrom=2026-09-12&dateTo=2026-09-10", "setorId=0", "ordemId=1.5", "criadorId=x", "status=INEXISTENTE", "campoData=__proto__", "agruparPor=constructor", "situacao=TODAS"]) {
    assert.throws(() => lerFiltrosServicos(new URLSearchParams(value)), { statusCode: 400 }, value);
  }
});
test("período inclui o último dia inteiro no fuso da oficina", () => {
  assert.deepEqual(limitesPeriodo({ dateFrom: "2026-09-10", dateTo: "2026-09-10" }), { inicio: "2026-09-10T03:00:00.000Z", fim: "2026-09-11T03:00:00.000Z" });
});
test("query aplica filtros combinados no banco sem restringir status implicitamente", () => {
  const chamadas: unknown[][] = [];
  const q = Object.fromEntries(["eq", "is", "in", "gte", "lt", "order"].map(m => [m, (...args: unknown[]) => { chamadas.push([m, ...args]); return q; }])) as any;
  aplicarFiltrosServicos(q, lerFiltrosServicos(new URLSearchParams(`dateFrom=2026-09-10&dateTo=2026-09-10&criadorId=${uid}&realizadorId=${uid}&status=ORCAMENTO,EM_ANDAMENTO&setorId=2&clienteId=3&ordemId=7&situacao=PENDENTE`)));
  assert.ok(chamadas.some(c => c[1] === "item.ordem.is_deleted" && c[2] === false));
  for (const [col, valor] of [["item.ordem.usuariocriadorid", uid], ["usuarioid", uid], ["item.ordem.setorid", 2], ["item.ordem.clienteid", 3], ["ordemservicoid", 7], ["status_execucao", "PENDENTE"]]) assert.ok(chamadas.some(c => c[1] === col && c[2] === valor));
  assert.ok(chamadas.some(c => c[0] === "gte" && c[1] === "item.ordem.dataentrada"));
  assert.ok(chamadas.some(c => c[0] === "lt" && c[2] === "2026-09-11T03:00:00.000Z"));
  chamadas.length = 0;
  aplicarFiltrosServicos(q, lerFiltrosServicos(new URLSearchParams("campoData=conclusao&setorId=SEM_SETOR")));
  assert.ok(chamadas.some(c => c[0] === "is" && c[1] === "item.ordem.setorid"));
  assert.equal(chamadas.some(c => ["gte", "lt", "in"].includes(String(c[0]))), false);
  chamadas.length = 0;
  aplicarFiltrosServicos(q, lerFiltrosServicos(new URLSearchParams("campoData=servico&dateFrom=2026-09-01")));
  assert.ok(chamadas.some(c => c[0] === "gte" && c[1] === "finalizado_em"));
});
test("normalização usa comissão histórica, setor e criador da OS e cliente migrado", () => {
  const l = normalizarServico({ ordemservicoid: 1, servicoid: 5, usuarioid: uid,
    valor_comissao: 12, valor_base: 120, comissao_percent_aplicada: 5, comissao_percent_efetiva: 10,
    usuario: { nome: "Ana", comissao_percent: 25, setor: { nome: "Setor do usuário" } },
    item: [{ descricao: "Complemento", subtotal: 240, quantidade: 1, servico: { descricao: "Serviço", gera_comissao: false },
      ordem: { status: "ORCAMENTO", setorid: 8, setor: { nome: "Setor da OS" }, usuariocriadorid: "original", criador: { nome: "Criador" }, cliente_snapshot: { nome: "Cliente migrado" }, dataentrada: "2026-09-10T12:00:00Z" } }] }, "entrada");
  assert.equal(l.comissao, 12); assert.equal(l.percentualAplicado, 10); assert.equal(l.percentualAtual, 25);
  assert.equal(l.setor, "Setor da OS"); assert.equal(l.criadorId, "original"); assert.equal(l.cliente, "Cliente migrado");
  assert.equal(l.setorRealizador, "Setor do usuário"); assert.equal(l.setorRealizadorId, "");
  assert.equal(l.complemento, "Complemento"); assert.equal(l.atribuidoPor, "Não identificado");
  assert.equal(normalizarServico({ comissao_percent_aplicada: 8 }, "entrada").percentualAplicado, 8);
  assert.equal(normalizarServico({ comissao_percent_efetiva: 0, comissao_percent_aplicada: 8 }, "entrada").percentualAplicado, 0);
});
test("serviço compartilhado conta uma vez no setor e geral, comissão somente dos vínculos incluídos", () => {
  const a = linha(), b = linha({ realizadorId: "b", realizador: "Bia", percentualAtual: 5 });
  const linhas = [a, b, linha({ ordemId: 2, valorServico: 10.01, baseComissao: 10.01, comissao: 0 })];
  assert.deepEqual(somarServicos(linhas), { servicos: 2, valor: 1010.01, base: 910.01, comissao: 90 });
  const setor = agruparServicos(linhas, "setor")[0];
  assert.equal(setor.totais.valor, 1010.01); assert.equal(setor.filhos.length, 2);
  assert.equal(setor.filhos[0].percentualAtual, 15); assert.equal(setor.filhos[1].percentualAtual, 5);
  assert.deepEqual(somarServicos([b]), { servicos: 1, valor: 1000, base: 450, comissao: 45 });
});
test("agrupa por identidade e ordena realizadores, datas e OS de forma estável", () => {
  const linhas = [linha({ ordemId: 3, dataReferencia: "" }), linha({ ordemId: 2 }), linha(), linha({ realizadorId: "b", realizador: "Ana", setorId: "", setor: "Sem setor" })];
  assert.equal(agruparServicos(linhas, "realizador").length, 2);
  assert.deepEqual(agruparServicos(linhas, "realizador")[0].linhas.map(l => l.ordemId), [1, 2, 3]);
  assert.equal(agruparServicos(linhas, "criador")[0].filhos.length, 2);
  assert.equal(agruparServicos(linhas, "setor").length, 2);
});
test("setor do realizador agrupa pela lotação de quem executou, não pelo setor da OS", () => {
  // Mesma OS de mecânica, dois realizadores de setores diferentes no cadastro.
  const eletricista = linha({ realizadorId: "b", realizador: "Bia", setorRealizadorId: "9", setorRealizador: "Elétrica" });
  const mecanico = linha({ realizadorId: "c", realizador: "Caio", setorRealizadorId: "3", setorRealizador: "Mecânica pesada" });
  const porSetorDaOs = agruparServicos([eletricista, mecanico], "setor");
  const porSetorDoRealizador = agruparServicos([eletricista, mecanico], "setorRealizador");
  assert.equal(porSetorDaOs.length, 1);
  assert.deepEqual(porSetorDoRealizador.map(g => g.nome), ["Elétrica", "Mecânica pesada"]);
  assert.deepEqual(porSetorDoRealizador.map(g => g.tipo), ["setorRealizador", "setorRealizador"]);
  // Cada grupo abre em realizadores, como setor da OS e criador.
  assert.deepEqual(porSetorDoRealizador.map(g => g.filhos.map(f => f.nome)), [["Bia"], ["Caio"]]);
  assert.equal(porSetorDoRealizador[0].percentualAtual, null);
  // O inverso também vale: OSs de setores distintos caem no mesmo grupo quando
  // quem executou é da mesma lotação.
  const outraOs = linha({ ordemId: 2, realizadorId: "b", realizador: "Bia", setorId: "7", setor: "Funilaria", setorRealizadorId: "9", setorRealizador: "Elétrica" });
  assert.equal(agruparServicos([eletricista, outraOs], "setorRealizador").length, 1);
  assert.equal(agruparServicos([eletricista, outraOs], "setor").length, 2);
  // Sem lotação cadastrada o grupo existe e se identifica.
  const semSetor = linha({ realizadorId: "d", realizador: "Duda", setorRealizadorId: "", setorRealizador: "Sem setor" });
  assert.equal(agruparServicos([semSetor], "setorRealizador")[0].nome, "Sem setor");
  assert.equal(lerFiltrosServicos(new URLSearchParams("agruparPor=setorRealizador")).agruparPor, "setorRealizador");
});
function evento(id: number, operacao: string, nome: string | null = "Autor"): EventoAtribuicao {
  const r = { ordemservicoid: 1, servicoid: 10, usuarioid: uid, createdat: "2026-09-01T12:00:00Z" };
  return { id, ocorrido_em: `2026-09-01T12:${String(id).padStart(2, "0")}:00Z`, operacao,
    usuario_id: nome ? uid : null, ator_nome: null, usuario: nome ? { nome } : null, dados_novos: r, dados_anteriores: r };
}
test("autoria vem do INSERT, não de atualizações de execução ou comissão", () => {
  const mapa = autoresDasAtribuicoes([evento(2, "UPDATE", "Executor"), evento(1, "INSERT", "Responsável")]);
  assert.equal(mapa.get(`1:10:${uid}`)?.nome, "Responsável");
});
test("remoção e reinserção substituem a autoria; desconhecido não herda autor anterior", () => {
  const chave = `1:10:${uid}`;
  assert.equal(autoresDasAtribuicoes([evento(1, "INSERT"), evento(2, "DELETE")]).has(chave), false);
  assert.equal(autoresDasAtribuicoes([evento(1, "INSERT"), evento(2, "DELETE"), evento(3, "INSERT", "Novo autor")]).get(chave)?.nome, "Novo autor");
  assert.equal(autoresDasAtribuicoes([evento(1, "INSERT"), evento(2, "DELETE"), evento(3, "INSERT", null)]).get(chave)?.nome, "Não identificado");
  assert.equal(autoresDasAtribuicoes([evento(1, "INSERT", "Ana")]).get(chave)?.nome, "Ana");
});
test("tempo usa somente apontamentos individuais válidos, inclusive acima de 24h", () => {
  assert.equal(duracaoSegundos("", "2026-09-10T12:00:00Z"), null);
  assert.equal(duracaoSegundos("2026-09-10T12:00:00Z", ""), null);
  assert.equal(duracaoSegundos("inválido", "inválido"), null);
  assert.equal(duracaoSegundos("2026-09-11T12:00:00Z", "2026-09-10T12:00:00Z"), null);
  assert.equal(duracaoTexto(null), "Sem apontamento");
  assert.equal(duracaoTexto(duracaoSegundos("2026-09-10T12:00:00Z", "2026-09-11T14:05:06Z")), "26h 05min 06s");
});
test("PDF relê Excel sem perder comissões, zeros, identidades, ordenação ou milissegundos", () => {
  const linhas = [linha(), linha({ realizadorId: "b", realizador: "Bia", percentualAtual: null, comissao: 0, inicio: "", fim: "", dataReferencia: "" })];
  for (const por of ["setor", "setorRealizador", "realizador", "criador"] as const) {
    const wb = criarWorkbookServicos(linhas, por, [["Empresa", "Oficina"], ["Status da OS", "Todos"]]);
    const leitura = lerWorkbookServicos(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    assert.equal(leitura.por, por); assert.deepEqual(leitura.linhas, linhasOrdenadas(agruparServicos(linhas, por)));
    assert.deepEqual(somarServicos(leitura.linhas), somarServicos(linhas));
    assert.equal(duracaoSegundos(leitura.linhas[0].inicio, leitura.linhas[0].fim), duracaoSegundos(linhas[0].inicio, linhas[0].fim));
    const resumo = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Resumo dos grupos"]);
    assert.equal(resumo.at(-1)?.["Comissão sugerida (R$)"], 45);
  }
});
test("exportação vazia mantém contrato; exportação extensa preserva todos os vínculos", () => {
  const vazio = criarWorkbookServicos([], "realizador", []);
  assert.deepEqual(lerWorkbookServicos(XLSX.write(vazio, { type: "array", bookType: "xlsx" })).linhas, []);
  const muitas = Array.from({ length: 1203 }, (_, i) => linha({ ordemId: i + 1 }));
  const wb = criarWorkbookServicos(muitas, "realizador", []);
  const lidas = lerWorkbookServicos(XLSX.write(wb, { type: "array", bookType: "xlsx" })).linhas;
  assert.equal(lidas.length, 1203); assert.equal(somarServicos(lidas).servicos, 1203);
});
