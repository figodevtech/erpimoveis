import assert from "node:assert/strict";
import test from "node:test";

import { CLASSIFICACOES } from "./catalogo";
import {
  grupoEhMisto,
  normalizar,
  sugerirClassificacaoConta,
  sugerirClassificacaoGrupo,
} from "./sugestao";

const codigos = new Set(CLASSIFICACOES.map((c) => c.codigo));

function conta(contaNome: string, grupoNome: string) {
  return sugerirClassificacaoConta({ contaNome, grupoNome });
}

test("normalizar tira acento e caixa sem tirar palavra", () => {
  assert.equal(normalizar("  Pró-labore  "), "pro-labore");
  assert.equal(normalizar("Manutenção   Predial"), "manutencao predial");
  assert.equal(normalizar("CSLL"), "csll");
});

test("toda sugestão devolve chave existente no catálogo", () => {
  const casos = [
    ["Mão de obra mecânica", "Receitas"],
    ["Venda de peças", "Receitas"],
    ["Salários", "Pessoal"],
    ["Tarifas bancárias", "Despesas financeiras"],
    ["Aporte de sócios", "Movimentações não operacionais"],
    ["Conta que ninguém conhece", "Custos diretos"],
  ] as const;
  for (const [c, g] of casos) {
    const sugestao = conta(c, g);
    if (sugestao.classificacao) assert.ok(codigos.has(sugestao.classificacao), `${c}: ${sugestao.classificacao}`);
    assert.ok(sugestao.justificativa.length > 0, `${c} sem justificativa`);
  }
});

test("nome inequívoco vence a herança do grupo", () => {
  // A conta está num grupo que hoje leva tudo para dedução da receita.
  const irpj = conta("IRPJ", "Impostos e taxas");
  assert.equal(irpj.classificacao, "IRPJ_RESULTADO");
  assert.equal(irpj.certeza, "ALTA");
  assert.equal(irpj.exigeRevisao, false);

  const csll = conta("CSLL", "Impostos e taxas");
  assert.equal(csll.classificacao, "CSLL_RESULTADO");
});

test("tributo sobre receita continua em dedução", () => {
  for (const nome of ["Simples Nacional", "ICMS", "ISS", "PIS", "COFINS"]) {
    assert.equal(conta(nome, "Impostos e taxas").classificacao, "TRIBUTO_RECEITA", nome);
  }
});

test("mesma conta em grupos diferentes recebe significados diferentes", () => {
  assert.equal(conta("Descontos concedidos", "Deduções de receita").classificacao, "DESCONTO_INCONDICIONAL");
  assert.equal(conta("Descontos concedidos", "Despesas financeiras").classificacao, "DESPESA_FINANCEIRA");
  assert.equal(conta("Mão de obra terceirizada", "Custos diretos").classificacao, "CUSTO_TERCEIRO_DIRETO");
  assert.equal(conta("Mão de obra terceirizada", "Pessoal").classificacao, "DESPESA_PESSOAL");
});

test("despesa não identificada permanece sem classificação", () => {
  const sugestao = conta("Despesas não identificadas", "Movimentações não operacionais");
  assert.equal(sugestao.classificacao, null);
  assert.equal(sugestao.certeza, "NENHUMA");
  assert.equal(sugestao.exigeRevisao, true);
});

test("estorno não ganha classificação própria", () => {
  for (const nome of [
    "Estornos e ajustes financeiros",
    "Estorno de entrada",
    "Estorno de saída",
    "Conciliação bancária",
  ]) {
    assert.equal(conta(nome, "Transferências e ajustes").classificacao, null, nome);
  }
});

test("venda de imobilizado fica pendente de apuração do ganho", () => {
  const sugestao = conta("Venda de ativo imobilizado", "Receitas financeiras e outras receitas");
  assert.equal(sugestao.classificacao, null);
  assert.equal(sugestao.certeza, "BAIXA");
  assert.match(sugestao.justificativa, /valor contábil/i);
});

/*
 * Herdar um grupo misto é o mecanismo que produziu o problema original. Uma
 * conta desconhecida ali precisa virar pendência, não herdar "tributo sobre
 * receita" só porque os vizinhos são tributos.
 */
test("conta desconhecida em grupo misto vira pendência", () => {
  assert.equal(grupoEhMisto("Impostos e taxas"), true);
  const sugestao = conta("Taxa desconhecida do município", "Impostos e taxas");
  assert.equal(sugestao.classificacao, null);
  assert.equal(sugestao.exigeRevisao, true);
});

test("conta desconhecida em grupo homogêneo herda com certeza média", () => {
  const sugestao = conta("Serviço novo da casa", "Receitas");
  assert.equal(sugestao.classificacao, "RECEITA_SERVICOS");
  assert.equal(sugestao.certeza, "MEDIA");
  assert.equal(sugestao.exigeRevisao, true);
});

test("grupo misto não recebe classificação padrão", () => {
  for (const nome of ["Impostos e taxas", "Tributos e taxas", "Movimentações não operacionais"]) {
    const sugestao = sugerirClassificacaoGrupo(nome);
    assert.equal(sugestao.classificacao, null, nome);
    assert.equal(sugestao.exigeRevisao, true, nome);
  }
});

test("grupo homogêneo recebe padrão, sempre para conferência", () => {
  const sugestao = sugerirClassificacaoGrupo("Despesas financeiras");
  assert.equal(sugestao.classificacao, "DESPESA_FINANCEIRA");
  assert.equal(sugestao.certeza, "MEDIA");
  assert.equal(sugestao.exigeRevisao, true);
});

test("grupo desconhecido não vira despesa por aproximação", () => {
  const sugestao = sugerirClassificacaoGrupo("EQUIPAMENTOS DE SEGURANÇA");
  assert.equal(sugestao.classificacao, null);
  assert.equal(sugestao.certeza, "NENHUMA");
});

test("nada é sugerido sem certeza declarada", () => {
  const sugestao = conta("Qualquer coisa", "Qualquer grupo");
  assert.equal(sugestao.classificacao, null);
  assert.equal(sugestao.certeza, "NENHUMA");
  assert.equal(sugestao.exigeRevisao, true);
});
