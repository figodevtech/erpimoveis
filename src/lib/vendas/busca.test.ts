import assert from "node:assert/strict";
import test from "node:test";
import { buscaCliente, planoBuscaVendas, valorDaBusca } from "./busca";
import { dataDoFiltro, erroNosFiltros } from "./filtros";

function padroes(expressao: string, campo: string) {
  const regex = new RegExp(`${campo}\\.imatch\\.("(?:[^"\\\\]|\\\\.)*")`, "g");
  return [...expressao.matchAll(regex)].map((match) => new RegExp(JSON.parse(match[1]), "i"));
}

for (const [limpo, mascarado] of [["11337394000194", "11.337.394/0001-94"], ["01234567890", "012.345.678-90"]]) {
  for (const busca of [limpo, mascarado]) {
    test(`busca documento ${busca} com e sem máscara e preserva zeros`, () => {
      const filtros = buscaCliente(busca);
      for (const salvo of [limpo, mascarado]) assert.ok(padroes(filtros, "cpfcnpj").some((regex) => regex.test(salvo)));
      assert.ok(!padroes(filtros, "cpfcnpj").some((regex) => regex.test("99999999999999")));
      const plano = planoBuscaVendas(busca);
      assert.ok(!plano.filtros.find((f) => f.relacao === "busca_nota")!.expressao.includes("numero.eq."));
      assert.ok(!plano.or.some((f) => f.startsWith("id.eq.")));
    });
  }
}

test("texto ignora acentos e não interpreta pontuação como expressão regular", () => {
  assert.ok(padroes(buscaCliente("Joao"), "nomerazaosocial").some((regex) => regex.test("João da Silva")));
  const filtro = buscaCliente('Peças (A+B), "Matriz"');
  assert.ok(padroes(filtro, "nomerazaosocial").some((regex) => regex.test('Peças (A+B), "Matriz"')));
  assert.ok(!padroes(buscaCliente(".*"), "nomerazaosocial").some((regex) => regex.test("qualquer cliente")));
});

test("documento parcial não ignora outros dígitos no meio", () => {
  const filtros = padroes(buscaCliente("123456"), "cpfcnpj");
  assert.ok(filtros.some((regex) => regex.test("123.456.789-00")));
  assert.ok(!filtros.some((regex) => regex.test("1293.456.789-00")));
});

test("CNPJ alfanumérico também aceita máscara", () => {
  for (const termo of ["00.000.000/E08G-12", "00000000E08G12"]) {
    const filtros = padroes(buscaCliente(termo), "cpfcnpj");
    assert.ok(filtros.some((regex) => regex.test("00.000.000/E08G-12")));
    assert.ok(filtros.some((regex) => regex.test("00000000E08G12")));
  }
});

test("busca monetária explícita e #ID não percorrem relações desnecessárias", () => {
  assert.deepEqual(planoBuscaVendas("R$ 1.234,56").or, ["valortotal.eq.1234.56"]);
  assert.deepEqual(planoBuscaVendas("R$ 1.234,56").select, []);
  assert.deepEqual(planoBuscaVendas("#123").or, ["id.eq.123"]);
});

test("valores brasileiros e decimais não confundem nomes ou documentos", () => {
  for (const [termo, esperado] of [["R$ 1.234,56", 1234.56], ["1234.56", 1234.56], ["1.234", 1234], ["0", 0]] as const) assert.equal(valorDaBusca(termo), esperado);
  for (const termo of ["Maria", "", "11.337.394/0001-94", "012.345.678-90", "Filtro 123"]) assert.equal(valorDaBusca(termo), null);
});

test("filtros de cliente e nota são obrigatórios além da busca geral", () => {
  const plano = planoBuscaVendas("oleo", "Joao", "123");
  assert.deepEqual(plano.obrigatorias, ["filtro_cliente.not.is.null", "or(filtro_nota.not.is.null,filtro_nota_grupo.not.is.null)"]);
  assert.ok(plano.filtros.some((f) => f.relacao === "filtro_nota_grupo.nota" && f.expressao === "numero.eq.123"));
  assert.ok(!plano.or.includes("filtro_cliente.not.is.null"));
});

test("filtro de nota inválido não estoura integer", () => {
  const plano = planoBuscaVendas("", "", "11337394000194");
  assert.ok(plano.filtros.every((f) => f.expressao === "numero.eq.-1"));
});

test("intervalos de data e valor são validados", () => {
  const base = { cliente: "", notaNumero: "" };
  assert.ok(erroNosFiltros({ ...base, valorMin: 20, valorMax: 10 }));
  assert.ok(erroNosFiltros({ ...base, dataInicio: new Date(2026, 8, 21), dataFim: new Date(2026, 8, 20) }));
  assert.equal(erroNosFiltros({ ...base, valorMin: 0, valorMax: 0 }), null);
  assert.equal(dataDoFiltro(new Date(2026, 8, 21)), "2026-09-21");
});
