import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOGO_VERSAO,
  CLASSIFICACOES,
  CONTAS_PADRAO,
  GRUPOS_PADRAO,
  LINHAS_DETALHE_PADRAO,
  classificacaoEfetiva,
  classificacaoPorCodigo,
  naturezaCompativel,
} from "./catalogo";

const codigos = new Set(CLASSIFICACOES.map((c) => c.codigo));
const detalhe = new Set<string>(LINHAS_DETALHE_PADRAO);

test("chaves de classificação são únicas", () => {
  assert.equal(codigos.size, CLASSIFICACOES.length);
});

test("versão do catálogo é um inteiro positivo", () => {
  assert.ok(Number.isInteger(CATALOGO_VERSAO) && CATALOGO_VERSAO > 0);
});

/*
 * Somar numa linha SUBTOTAL ou FORMULA contaria o mesmo valor duas vezes: uma
 * pelo destino e outra pelo cálculo do pai. Por isso todo destino é DETALHE.
 */
test("todo destino de resultado é linha de detalhe", () => {
  for (const c of CLASSIFICACOES) {
    if (c.tratamento !== "RESULTADO") continue;
    assert.ok(c.linhaCodigo, `${c.codigo} sem linha de destino`);
    assert.ok(detalhe.has(c.linhaCodigo), `${c.codigo} aponta para ${c.linhaCodigo}, que não é linha de detalhe`);
  }
});

test("patrimonial não tem linha e exige motivo", () => {
  for (const c of CLASSIFICACOES) {
    if (c.tratamento !== "PATRIMONIAL") continue;
    assert.equal(c.linhaCodigo, null, `${c.codigo} patrimonial não pode ter linha`);
    assert.equal(c.papelDre, null, `${c.codigo} patrimonial não pode ter papel na DRE`);
    assert.ok(c.motivoExclusao, `${c.codigo} patrimonial sem motivo de exclusão`);
  }
});

test("resultado não carrega motivo de exclusão nem fica sem papel", () => {
  for (const c of CLASSIFICACOES) {
    if (c.tratamento !== "RESULTADO") continue;
    assert.equal(c.motivoExclusao, null, `${c.codigo} de resultado não deve ter motivo de exclusão`);
    assert.ok(c.papelDre, `${c.codigo} de resultado sem papel na DRE`);
  }
});

test("toda classificação aceita ao menos uma natureza de caixa", () => {
  for (const c of CLASSIFICACOES) {
    assert.ok(c.naturezas.length > 0, `${c.codigo} sem natureza permitida`);
    assert.equal(new Set(c.naturezas).size, c.naturezas.length, `${c.codigo} repete natureza`);
  }
});

/*
 * Aceitar as duas naturezas em algo que compõe resultado apagaria a validação
 * que a Fase 3 precisa fazer: uma despesa administrativa poderia somar receita.
 * Só o patrimonial aceita entrada e saída, porque aporte e retirada usam o
 * mesmo significado.
 */
test("apenas o patrimonial aceita entrada e saída", () => {
  for (const c of CLASSIFICACOES) {
    if (c.naturezas.length > 1) {
      assert.equal(c.tratamento, "PATRIMONIAL", `${c.codigo} de resultado aceita mais de uma natureza`);
    }
  }
});

test("grupos padrão apontam para classificação existente", () => {
  const vistos = new Set<string>();
  for (const g of GRUPOS_PADRAO) {
    assert.ok(codigos.has(g.classificacao), `${g.codigo} usa classificação inexistente`);
    assert.ok(!vistos.has(g.codigo), `${g.codigo} duplicado`);
    vistos.add(g.codigo);
  }
});

test("contas padrão apontam para grupo existente e exceção válida", () => {
  const grupos = new Set(GRUPOS_PADRAO.map((g) => g.codigo));
  const vistos = new Set<string>();
  for (const c of CONTAS_PADRAO) {
    assert.ok(grupos.has(c.grupo), `${c.codigo} usa grupo inexistente`);
    assert.ok(!vistos.has(c.codigo), `${c.codigo} duplicado`);
    vistos.add(c.codigo);
    if (c.classificacao) assert.ok(codigos.has(c.classificacao), `${c.codigo} usa classificação inexistente`);
  }
});

/*
 * A regra do plano: a exceção de uma conta é compatível com a família do grupo.
 * Trocar entre receita, despesa e patrimônio exige trocar de grupo — senão a
 * família deixa de significar alguma coisa e a validação de natureza cai junto.
 */
test("exceção da conta respeita a família do grupo", () => {
  for (const conta of CONTAS_PADRAO) {
    if (!conta.classificacao) continue;
    const grupo = GRUPOS_PADRAO.find((g) => g.codigo === conta.grupo);
    assert.ok(grupo);
    const familiaGrupo = classificacaoPorCodigo(grupo.classificacao)?.familia;
    const familiaConta = classificacaoPorCodigo(conta.classificacao)?.familia;
    assert.equal(
      familiaConta,
      familiaGrupo,
      `${conta.codigo}: exceção ${familiaConta} em grupo ${familiaGrupo}`,
    );
  }
});

test("toda classificação de resultado tem alguma conta ou grupo que a alcance", () => {
  const alcancadas = new Set<string>();
  for (const g of GRUPOS_PADRAO) alcancadas.add(g.classificacao);
  for (const c of CONTAS_PADRAO) {
    const efetiva = classificacaoEfetiva(c);
    if (efetiva) alcancadas.add(efetiva);
  }
  for (const c of CLASSIFICACOES) {
    assert.ok(alcancadas.has(c.codigo), `${c.codigo} não é alcançável por nenhum cadastro padrão`);
  }
});

test("classificacaoEfetiva herda o grupo quando não há exceção", () => {
  const conta = CONTAS_PADRAO.find((c) => c.codigo === "CTA_VENDA_PECAS");
  assert.ok(conta);
  assert.equal(conta.classificacao, undefined);
  assert.equal(classificacaoEfetiva(conta), "RECEITA_PRODUTOS");
});

test("naturezaCompativel recusa despesa em receita e desconhecido", () => {
  assert.equal(naturezaCompativel("RECEITA_SERVICOS", "RECEITA"), true);
  assert.equal(naturezaCompativel("RECEITA_SERVICOS", "DESPESA"), false);
  // Desconto sai do caixa e mesmo assim deduz receita: os dois eixos são distintos.
  assert.equal(naturezaCompativel("DESCONTO_INCONDICIONAL", "DESPESA"), true);
  // Recuperação de compra entra no caixa e mesmo assim abate custo.
  assert.equal(naturezaCompativel("RECUPERACAO_COMPRA", "RECEITA"), true);
  assert.equal(naturezaCompativel("NAO_EXISTE", "RECEITA"), false);
});
