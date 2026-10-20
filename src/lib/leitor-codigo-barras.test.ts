import assert from "node:assert/strict";
import test from "node:test";
import { classificarProdutosLidos, criarDetectorDeLeitura } from "./leitor-codigo-barras";
import { variantesGtin } from "./gtin";

function digitar(texto: string, intervalo: number, inicio = 1000) {
  const detector = criarDetectorDeLeitura();
  const teclas = [...texto, "Enter"];
  return teclas.map((tecla, i) => detector.registrar(tecla, inicio + i * intervalo));
}

test("rajada rapida terminada em Enter e leitura do aparelho", () => {
  const eventos = digitar("7891234567895", 8);
  assert.deepEqual(eventos.at(-1), { tipo: "leitura", codigo: "7891234567895" });
  assert.deepEqual(eventos[0], { tipo: "caractere", inicio: true });
  assert.deepEqual(eventos[1], { tipo: "caractere", inicio: false });
});

test("digitacao humana com Enter nao vira leitura", () => {
  assert.deepEqual(digitar("7891234567895", 140).at(-1), { tipo: "outra" });
});

test("rajada curta ou com letra nao e codigo de produto", () => {
  assert.deepEqual(digitar("1234567", 8).at(-1), { tipo: "outra" });
  assert.deepEqual(digitar("ABC12345", 8).at(-1), { tipo: "outra" });
  assert.deepEqual(digitar("123456789012345", 8).at(-1), { tipo: "outra" });
});

test("pausa no meio recomeca a rajada a partir do caractere atrasado", () => {
  const detector = criarDetectorDeLeitura();
  detector.registrar("9", 0);
  // O operador digitou "9", parou, e passou o leitor.
  const codigo = "7891234567895";
  const eventos = [...codigo].map((tecla, i) => detector.registrar(tecla, 2000 + i * 8));
  assert.deepEqual(eventos[0], { tipo: "caractere", inicio: true });
  assert.deepEqual(detector.registrar("Enter", 2000 + codigo.length * 8), { tipo: "leitura", codigo });
});

test("Tab como sufixo e Shift no meio sao aceitos", () => {
  const detector = criarDetectorDeLeitura();
  let t = 0;
  for (const tecla of ["Shift", ..."12345678"]) detector.registrar(tecla, (t += 5));
  assert.deepEqual(detector.registrar("Tab", t + 5), { tipo: "leitura", codigo: "12345678" });
});

test("sufixo que demora demais nao fecha a leitura", () => {
  const detector = criarDetectorDeLeitura();
  [..."78912345"].forEach((tecla, i) => detector.registrar(tecla, i * 5));
  assert.deepEqual(detector.registrar("Enter", 35 + 400), { tipo: "outra" });
});

const produto = (id: number, exibirPdv: boolean, grupoNoPdv: boolean | null) => ({
  id,
  titulo: `PRODUTO ${id}`,
  exibirPdv,
  grupo: grupoNoPdv === null ? null : { exibirPdv: grupoNoPdv },
});

test("classificacao segue a visibilidade do catalogo do PDV", () => {
  assert.deepEqual(classificarProdutosLidos([]), { resultado: "nao_encontrado" });
  assert.deepEqual(classificarProdutosLidos([produto(1, false, true)]), { resultado: "fora_do_pdv", titulo: "PRODUTO 1" });
  assert.deepEqual(classificarProdutosLidos([produto(1, true, false)]), { resultado: "fora_do_pdv", titulo: "PRODUTO 1" });
  assert.deepEqual(classificarProdutosLidos([produto(1, true, null)]), { resultado: "fora_do_pdv", titulo: "PRODUTO 1" });

  const unico = classificarProdutosLidos([produto(1, false, true), produto(2, true, true)]);
  assert.equal(unico.resultado, "encontrado");
  assert.equal(unico.resultado === "encontrado" && unico.produto.id, 2);

  assert.deepEqual(classificarProdutosLidos([produto(1, true, true), produto(2, true, true)]), {
    resultado: "ambiguo",
    produtos: [{ id: 1, titulo: "PRODUTO 1" }, { id: 2, titulo: "PRODUTO 2" }],
  });
});

test("variantes de GTIN casam o mesmo item com zeros a esquerda diferentes", () => {
  assert.ok(variantesGtin("7891234567895").includes("07891234567895"));
  assert.ok(variantesGtin("07891234567895").includes("7891234567895"));
  assert.ok(variantesGtin("012345678905").includes("0012345678905"));
  assert.deepEqual(variantesGtin(""), []);
});
