import assert from "node:assert/strict";
import test from "node:test";
import { normalizarServico } from "@/lib/relatorios/servicos-realizados";
import { EM_CORPO, capacidadeDaFolha, endpointServicosValido, fragmentosServico, larguraTexto, observacaoDaTaxa, paginarServicos, quebrarTexto } from "./report-model";

const cabe = (paginas: ReturnType<typeof paginarServicos>) => paginas.every((p, i) => p.altura <= capacidadeDaFolha(i));

function linha(id: number) {
  return normalizarServico({ ordemservicoid: id, servicoid: 1, usuarioid: "ana", usuario: { nome: "Ana", comissao_percent: 10 }, valor_base: 50, valor_comissao: 5,
    item: { descricao: "Complemento", quantidade: 1, subtotal: 100, servico: { descricao: "Troca de óleo" }, ordem: { setorid: 1, setor: { nome: "Mecânica" }, status: "ORCAMENTO" } } }, "entrada");
}
test("folhas respeitam a altura útil e a lista continua sem repetir as faixas de grupo", () => {
  const linhas = Array.from({ length: 35 }, (_, i) => linha(i + 1));
  const paginas = paginarServicos(linhas, "setor", [["Empresa", "Oficina"]]);
  assert.ok(paginas.length > 1);
  assert.ok(cabe(paginas));
  const servicos = paginas.flatMap(p => p.blocos).filter(b => b.tipo === "servico");
  assert.equal(servicos.length, 35);
  assert.deepEqual(servicos.map(s => s.linha.ordemId), linhas.map(l => l.ordemId));
  // Um setor e um realizador: duas faixas no relatório inteiro, na primeira
  // folha, e nenhuma reimpressa quando a lista quebra.
  const grupos = paginas.flatMap(p => p.blocos).filter(b => b.tipo === "grupo");
  assert.equal(grupos.length, 2);
  assert.equal(paginas[0].blocos.filter(b => b.tipo === "grupo").length, 2);
  for (const p of paginas.slice(1)) assert.equal(p.blocos.findIndex(b => b.tipo === "servico"), 0);
  for (const p of paginas) assert.notEqual(p.blocos.at(-1)?.tipo, "grupo");
});
test("cada faixa de grupo leva os próprios totais para o papel", () => {
  const linhas = [linha(1), { ...linha(2), realizadorId: "bia", realizador: "Bia", percentualAtual: null }];
  const blocos = paginarServicos(linhas, "setor", [["Empresa", "Oficina"]]).flatMap(p => p.blocos);
  const setor = blocos.find(b => b.tipo === "grupo" && b.nivel === 0);
  assert.equal(setor?.tipo === "grupo" && setor.rotulo, "Setor da OS");
  // O setor soma os dois serviços; cada realizador responde apenas pelo seu.
  assert.deepEqual(setor?.tipo === "grupo" && setor.totais, { servicos: 2, valor: 200, base: 100, comissao: 10 });
  const realizadores = blocos.filter(b => b.tipo === "grupo" && b.nivel === 1);
  assert.equal(realizadores.length, 2);
  assert.ok(realizadores.every(g => g.tipo === "grupo" && g.totais.servicos === 1 && g.totais.comissao === 5));
  assert.equal(realizadores[0].tipo === "grupo" && realizadores[0].percentualAtual, 10);
  const painel = blocos.find(b => b.tipo === "painel");
  assert.equal(painel?.tipo === "painel" && painel.participacoes, 2);
  assert.equal(painel?.tipo === "painel" && painel.realizadores, 2);
  assert.equal(painel?.tipo === "painel" && painel.agrupamento, "Setor da OS");
});
test("filtros aplicados viram chips que cabem na largura da folha", () => {
  const paginas = paginarServicos([linha(1)], "realizador", [["Empresa", "Oficina"], ["Realizador", "Ana"], ["Status da OS", "Todos"], ["Cliente", "Transportadora Nordeste Ltda"]]);
  const filtros = paginas[0].blocos.find(b => b.tipo === "filtros");
  assert.ok(filtros?.tipo === "filtros");
  // "Todos" não é filtro, e Empresa pertence ao rodapé: nenhum dos dois vira chip.
  assert.deepEqual(filtros.chips.flat(), ["Realizador: Ana", "Cliente: Transportadora Nordeste Ltda"]);
  const vazio = paginarServicos([linha(1)], "realizador", [["Empresa", "Oficina"]]).flatMap(p => p.blocos).find(b => b.tipo === "filtros");
  assert.ok(vazio?.tipo === "filtros" && vazio.chips.flat()[0].startsWith("Sem filtros adicionais"));
});
test("descrições e complementos longos atravessam folhas sem cortes ou valores duplicados", () => {
  const l = { ...linha(1), descricao: "Diagnóstico completo ".repeat(1200), complemento: "X".repeat(4000) };
  const fragmentos = fragmentosServico(l);
  assert.ok(fragmentos.length > 2);
  assert.equal(fragmentos.filter(f => f.valores).length, 1);
  assert.ok(fragmentos.slice(1).every(f => f.continuacao));
  // A medida é a largura em `em` da Arial, não a contagem de caracteres.
  assert.ok(fragmentos.flatMap(f => f.linhas).every(t => larguraTexto(t) <= EM_CORPO));
  const paginas = paginarServicos([l], "setor", []);
  assert.ok(cabe(paginas));
  assert.equal(paginas.flatMap(p => p.blocos).filter(b => b.tipo === "servico").length, fragmentos.length);
  assert.equal(quebrarTexto("X".repeat(4000)).join("").length, 4000);
  assert.equal(quebrarTexto("Bomba injetora Bosch VE 4/9F 2300 L 038").join(" "), "Bomba injetora Bosch VE 4/9F 2300 L 038");
});
test("mudança de realizador mantém o setor e inicia um novo cabeçalho", () => {
  const paginas = paginarServicos([linha(1), { ...linha(2), realizadorId: "bia", realizador: "Bia" }], "setor", []);
  const grupos = paginas.flatMap(p => p.blocos).filter(b => b.tipo === "grupo");
  assert.ok(grupos.some(g => g.chave.endsWith("realizador:ana")));
  assert.ok(grupos.some(g => g.chave.endsWith("realizador:bia")));
});
test("resultado vazio gera folha identificada e URLs externas não são aceitas", () => {
  const paginas = paginarServicos([], "realizador", [["Empresa", "Oficina"], ["Período", "01/09/2026 a 08/09/2026"]]);
  assert.equal(paginas.length, 1);
  assert.equal(paginas[0].periodo, "01/09/2026 a 08/09/2026");
  const nota = paginas[0].blocos.find(b => b.tipo === "nota");
  assert.ok(nota?.tipo === "nota" && nota.vazio && nota.linhas.some(l => l.includes("Nenhum serviço")));
  assert.ok(endpointServicosValido("/api/reports/servicos-realizados/export?status=ORCAMENTO"));
  for (const endpoint of ["https://example.com", "//example.com", "/api/reports/servicos-realizados/export/outro", "/api/reports/ordens/export"]) assert.equal(endpointServicosValido(endpoint), false);
});
test("a taxa se explica pelo serviço como era no cálculo, antes do cadastro do realizador", () => {
  const base = { geraComissaoNoCalculo: true, geraComissaoHoje: true, percentualAtual: 10, percentualAplicado: 10 };
  assert.equal(observacaoDaTaxa(base), "");
  assert.equal(observacaoDaTaxa({ ...base, percentualAtual: 5, percentualAplicado: 0 }), "cadastro atual 5%");
  // O serviço fora da comissão explica o 0%; o cadastro de 10% não entra.
  assert.equal(observacaoDaTaxa({ ...base, geraComissaoNoCalculo: false, geraComissaoHoje: false, percentualAplicado: 0 }), "serviço não gera comissão");
  assert.equal(observacaoDaTaxa({ ...base, geraComissaoNoCalculo: false, percentualAplicado: 0 }), "serviço não gerava comissão no cálculo; hoje gera");
  // OS #434 do Demir: gerava quando foi apurada, o cadastro mudou depois.
  assert.equal(observacaoDaTaxa({ ...base, geraComissaoHoje: false }), "hoje o serviço não gera comissão");
});
