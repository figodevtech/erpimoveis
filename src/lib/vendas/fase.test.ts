import assert from "node:assert/strict";
import test from "node:test";
import {
  faseDaVenda,
  faturadaNaResposta,
  pendenciasParaFinalizar,
  planoFaseVendas,
  type SituacaoVenda,
} from "./fase";

const venda = (parcial: Partial<SituacaoVenda>): SituacaoVenda => ({
  status: "FINALIZADA",
  canal: "PDV",
  statusEntrega: null,
  faturada: false,
  ...parcial,
});

test("balcão pago finaliza no pagamento, sem olhar nota nem entrega", () => {
  assert.equal(faseDaVenda(venda({})), "FINALIZADAS");
  assert.equal(faseDaVenda(venda({ status: "PAGAMENTO" })), "ABERTAS");
  assert.equal(faseDaVenda(venda({ status: "ORCAMENTO" })), "ABERTAS");
  assert.deepEqual(pendenciasParaFinalizar(venda({})), []);
});

for (const canal of ["MERCADO_LIVRE", "SHOPEE"]) {
  test(`${canal} pago só finaliza faturado e entregue`, () => {
    const pedido = (parcial: Partial<SituacaoVenda>) => venda({ canal, ...parcial });
    assert.deepEqual(pendenciasParaFinalizar(pedido({ statusEntrega: "SEPARACAO" })), ["NOTA", "ENTREGA"]);
    assert.deepEqual(pendenciasParaFinalizar(pedido({ statusEntrega: "ENVIO", faturada: true })), ["ENTREGA"]);
    assert.deepEqual(pendenciasParaFinalizar(pedido({ statusEntrega: "ENTREGUE" })), ["NOTA"]);
    assert.equal(faseDaVenda(pedido({ statusEntrega: "ENTREGUE" })), "ABERTAS");
    assert.equal(faseDaVenda(pedido({ statusEntrega: "ENTREGUE", faturada: true })), "FINALIZADAS");
    // Antes de pagar, a pendência é o pagamento, não a nota.
    assert.deepEqual(pendenciasParaFinalizar(pedido({ status: "PAGAMENTO" })), []);
  });
}

test("site pago finaliza na entrega, sem exigir NF-e", () => {
  const site = (parcial: Partial<SituacaoVenda>) => venda({ canal: "ONLINE", ...parcial });
  assert.deepEqual(pendenciasParaFinalizar(site({ statusEntrega: "SEPARACAO" })), ["ENTREGA"]);
  assert.deepEqual(pendenciasParaFinalizar(site({ statusEntrega: null })), ["ENTREGA"]);
  assert.equal(faseDaVenda(site({ statusEntrega: "ENVIO" })), "ABERTAS");
  assert.equal(faseDaVenda(site({ statusEntrega: "ENTREGUE" })), "FINALIZADAS");
});

test("cancelada fica em finalizadas, como nas abas de OS", () => {
  assert.equal(faseDaVenda(venda({ status: "CANCELADA", canal: "MERCADO_LIVRE" })), "FINALIZADAS");
  assert.equal(faseDaVenda(venda({ status: "CANCELADO" })), "FINALIZADAS");
});

test("faturada lê a chave manual e as notas autorizadas diretas ou agrupadas", () => {
  assert.equal(faturadaNaResposta({ nfe_chave_acesso: null, filtro_fase_nota: [], filtro_fase_grupo: [] }), false);
  assert.equal(faturadaNaResposta({ nfe_chave_acesso: "2526...", filtro_fase_nota: [] }), true);
  assert.equal(faturadaNaResposta({ filtro_fase_nota: [{ id: 1 }] }), true);
  assert.equal(faturadaNaResposta({ filtro_fase_grupo: [{ nota: { id: 2 } }] }), true);
});

/* Avaliador mínimo da gramática PostgREST que o plano usa, com a lógica de três
 * valores do SQL: comparar com NULL dá NULL, e o WHERE descarta NULL. */
type Tri = boolean | null;

function dividir(texto: string) {
  const partes: string[] = [];
  let profundidade = 0;
  let atual = "";
  for (const letra of texto) {
    if (letra === "(") profundidade++;
    if (letra === ")") profundidade--;
    if (letra === "," && profundidade === 0) {
      partes.push(atual);
      atual = "";
    } else atual += letra;
  }
  return [...partes, atual];
}

function avaliar(item: string, linha: Record<string, unknown>): Tri {
  const logico = item.match(/^(or|and)\((.*)\)$/);
  if (logico) return combinar(logico[1] as "or" | "and", dividir(logico[2]).map((parte) => avaliar(parte, linha)));
  const condicao = item.match(/^([a-z_]+)\.(not\.)?(in|eq|neq|is)\.(.+)$/);
  assert.ok(condicao, `Condição fora da gramática: ${item}`);
  const [, coluna, negacao, operador, alvo] = condicao;
  const valor = linha[coluna] ?? null;
  let resultado: Tri;
  if (operador === "is") resultado = alvo === "null" ? valor === null : valor === (alvo === "true");
  else if (valor === null) resultado = null;
  else if (operador === "in") resultado = alvo.replace(/^\(|\)$/g, "").split(",").includes(String(valor));
  else resultado = operador === "eq" ? valor === alvo : valor !== alvo;
  return negacao && resultado !== null ? !resultado : resultado;
}

function combinar(operador: "or" | "and", valores: Tri[]): Tri {
  if (operador === "or") return valores.includes(true) ? true : valores.includes(null) ? null : false;
  return valores.includes(false) ? false : valores.includes(null) ? null : true;
}

test("as duas abas do PostgREST são complementares e seguem faseDaVenda", () => {
  const status = ["ORCAMENTO", "APROVACAO_ORCAMENTO", "ORCAMENTO_APROVADO", "ORCAMENTO_RECUSADO", "ABERTA",
    "PAGAMENTO", "PENDENTE", "PAGO", "AUTORIZADO", "FINALIZADA", "CANCELADA", "CANCELADO"];
  const canais = ["PDV", "ONLINE", "MERCADO_LIVRE", "SHOPEE"];
  const entregas = [null, "SEPARACAO", "ENVIO", "ENTREGUE"];
  const abertas = planoFaseVendas("ABERTAS").expressao;
  const finalizadas = planoFaseVendas("FINALIZADAS").expressao;
  let combinacoes = 0;

  for (const s of status) for (const canal of canais) for (const entrega of entregas)
    for (const chave of [null, "2526"]) for (const nota of [false, true]) for (const grupo of [false, true]) {
      // Relação embutida sem linha vale NULL para `is.null`.
      const linha = {
        status: s, canal, status_entrega: entrega, nfe_chave_acesso: chave,
        filtro_fase_nota: nota ? "linha" : null, filtro_fase_grupo: grupo ? "linha" : null,
      };
      const naAberta = combinar("or", dividir(abertas).map((parte) => avaliar(parte, linha))) === true;
      const naFinalizada = combinar("or", dividir(finalizadas).map((parte) => avaliar(parte, linha))) === true;
      const esperada = faseDaVenda({ status: s, canal, statusEntrega: entrega, faturada: Boolean(chave) || nota || grupo });
      const rotulo = JSON.stringify(linha);
      assert.notEqual(naAberta, naFinalizada, `Venda em nenhuma ou nas duas abas: ${rotulo}`);
      assert.equal(naFinalizada ? "FINALIZADAS" : "ABERTAS", esperada, rotulo);
      combinacoes++;
    }

  assert.equal(combinacoes, 12 * 4 * 4 * 2 * 2 * 2);
});

test("o plano filtra só nota autorizada e vínculo de agrupamento ativo", () => {
  const plano = planoFaseVendas("FINALIZADAS");
  assert.deepEqual(plano.filtros, [
    { relacao: "filtro_fase_nota", expressao: "status.eq.AUTORIZADA" },
    { relacao: "filtro_fase_grupo", expressao: "ativo.is.true" },
    { relacao: "filtro_fase_grupo.nota", expressao: "status.eq.AUTORIZADA" },
  ]);
  assert.ok(plano.select.every((relacao) => relacao.startsWith("filtro_")));
});
