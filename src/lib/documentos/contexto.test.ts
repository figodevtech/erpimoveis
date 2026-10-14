import assert from "node:assert/strict";
import test from "node:test";

import { CATALOGOS } from "./catalogo";
import { contextoDaOS, contextoDaVenda, contextoDoAluguel, type EmissaoDocumento } from "./contexto";
import { ALUGUEL_EXEMPLO, EMPRESA_EXEMPLO, OS_EXEMPLO, VENDA_EXEMPLO, contextoDeExemplo } from "./exemplos";
import { MODULOS_DOCUMENTO } from "./tipos";

const EMISSAO: EmissaoDocumento = {
  nomeDocumento: "Teste",
  emitidoPor: "Ana",
  agora: new Date("2026-10-14T15:00:00Z"),
  logoUrl: null,
};

const semEspacoDuro = (s: unknown) => String(s).replace(/\s/g, " ");

function valor(contexto: Record<string, unknown>, chave: string) {
  return chave.split(".").reduce<unknown>((atual, parte) => (atual as Record<string, unknown> | undefined)?.[parte], contexto);
}

test("toda variável do catálogo sai do contexto de cada módulo", () => {
  for (const modulo of MODULOS_DOCUMENTO) {
    const contexto = contextoDeExemplo(modulo);
    const catalogo = CATALOGOS[modulo];
    for (const grupo of catalogo.grupos) {
      for (const variavel of grupo.variaveis) {
        assert.equal(typeof valor(contexto, variavel.chave), "string", `${modulo}: ${variavel.chave} não está no contexto`);
      }
    }
    for (const lista of catalogo.listas) {
      const linhas = contexto[lista.chave];
      assert.ok(Array.isArray(linhas) && linhas.length > 0, `${modulo}: a lista ${lista.chave} veio vazia no exemplo`);
      for (const campo of lista.campos) {
        assert.equal(typeof (linhas[0] as Record<string, unknown>)[campo.chave], "string", `${modulo}: ${lista.chave}.${campo.chave} não está no item`);
      }
    }
  }
});

test("venda: totais iguais aos do diálogo (descontos de item e geral, frete)", () => {
  const ctx = contextoDaVenda({ venda: VENDA_EXEMPLO, empresa: EMPRESA_EXEMPLO, pagamentos: null, emissao: EMISSAO }) as any;
  // 180 + 140 = 320; 10% no segundo item = 14; geral fixo 20; frete 30.
  assert.equal(semEspacoDuro(ctx.venda.subtotal), "R$ 320,00");
  assert.equal(semEspacoDuro(ctx.venda.desconto), "R$ 34,00");
  assert.equal(semEspacoDuro(ctx.venda.total), "R$ 316,00");
  assert.equal(ctx.venda.total_extenso, "trezentos e dezesseis reais");
  assert.equal(semEspacoDuro(ctx.itens[1].valor_unitario), "R$ 35,00");
  assert.equal(semEspacoDuro(ctx.itens[1].desconto), "R$ 14,00");
  assert.equal(ctx.cliente.nome, "Maria da Silva Souza");
  assert.equal(ctx.cliente.documento, "123.456.789-09");
  assert.equal(ctx.cliente.tipo_pessoa, "Pessoa física");
  assert.equal(ctx.venda.pagamentos, "");
  assert.equal(ctx.documento.data_emissao_extenso, "14 de outubro de 2026");
});

test("venda: acréscimo financeiro entra no total", () => {
  const ctx = contextoDaVenda({
    venda: { ...VENDA_EXEMPLO, acrescimo_financeiro_tipo: "PORCENTAGEM", acrescimo_financeiro_valor: 10 },
    empresa: null,
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.equal(semEspacoDuro(ctx.venda.acrescimo), "R$ 31,60");
  assert.equal(semEspacoDuro(ctx.venda.total), "R$ 347,60");
  assert.equal(ctx.empresa.nome, "");
});

test("OS de veículo: peças com avulso, serviços com realizadores, total com desconto", () => {
  const ctx = contextoDaOS({
    os: OS_EXEMPLO,
    realizadores: [{ servicoid: 12, usuario: { nome: "Carlos" } }, { servicoid: 12, usuario: { nome: "Pedro" } }],
    empresa: EMPRESA_EXEMPLO,
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.equal(ctx.pecas.length, 2);
  assert.equal(ctx.pecas[1].descricao, "Fluido de freio DOT 4");
  assert.equal(ctx.servicos[1].realizadores, "Carlos, Pedro");
  assert.equal(ctx.servicos[0].realizadores, "");
  assert.equal(semEspacoDuro(ctx.os.total), "R$ 545,00");
  assert.equal(ctx.os.alvo, "Veículo");
  assert.equal(ctx.os.alvo_descricao, "Volkswagen Gol 1.6 2019/2020 · placa QFX1A23 · 40.210 km");
  assert.equal(ctx.os.data_conclusao, "13/10/2026");
});

test("OS de peça e de equipamento identificam o que foi atendido", () => {
  const peca = contextoDaOS({
    os: { ...OS_EXEMPLO, alvo_tipo: "PECA", veiculo: null, peca: { titulo: "Turbina", lacre: "L-77" } },
    realizadores: [],
    empresa: null,
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.equal(peca.os.alvo, "Peça");
  assert.equal(peca.os.alvo_descricao, "Turbina · lacre L-77");
  assert.equal(peca.veiculo.placa, "");

  const equipamento = contextoDaOS({
    os: { ...OS_EXEMPLO, alvo_tipo: "EQUIPAMENTO", veiculo: null, equipamento_nome: "Gerador", equipamento_horimetro: 1200 },
    realizadores: [],
    empresa: null,
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.equal(equipamento.os.alvo, "Máquina/Equipamento");
  assert.equal(equipamento.os.alvo_descricao, "Gerador · 1.200 h");
});

test("OS cancelada não tem data de conclusão", () => {
  const ctx = contextoDaOS({
    os: { ...OS_EXEMPLO, status: "CANCELADO", execucao_fim_em: null },
    realizadores: [],
    empresa: null,
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.equal(ctx.os.data_conclusao, "");
});

test("aluguel: sem data limite, cliente avulso e observação antiga em texto puro", () => {
  const ctx = contextoDoAluguel({
    aluguel: {
      ...ALUGUEL_EXEMPLO,
      data_limite: null,
      cliente: null,
      cliente_nome: "José Avulso",
      cliente_documento: "12345678909",
      observacao: "linha 1\nlinha <2>",
    },
    empresa: null,
    emissao: EMISSAO,
  }) as any;
  assert.equal(ctx.aluguel.data_limite, "Sem data limite");
  assert.equal(ctx.aluguel.duracao, "Prazo indeterminado");
  assert.equal(ctx.cliente.nome, "José Avulso");
  assert.equal(ctx.cliente.documento, "123.456.789-09");
  assert.equal(ctx.aluguel.observacao, "<p>linha 1</p><p>linha &lt;2&gt;</p>");
  assert.equal(semEspacoDuro(ctx.itens[1].total), "R$ 200,00");
  assert.equal(ctx.itens[0].tipo, "Produto");
});

test("aluguel com prazo: duração e status do dia da emissão", () => {
  const ctx = contextoDoAluguel({ aluguel: ALUGUEL_EXEMPLO, empresa: null, emissao: EMISSAO }) as any;
  assert.equal(ctx.aluguel.duracao, "7 dias");
  assert.equal(ctx.aluguel.data_limite, "21/10/2026");
  assert.equal(ctx.aluguel.status, "Em andamento");
});

test("tabelas prontas escapam o texto dos itens", () => {
  const ctx = contextoDaVenda({
    venda: { ...VENDA_EXEMPLO, itens: [{ ...VENDA_EXEMPLO.itens[0], produto: { id: 1, titulo: "<b>Peça</b>" } }] },
    empresa: null,
    pagamentos: null,
    emissao: EMISSAO,
  }) as any;
  assert.ok(ctx.venda.itens_tabela.includes("&lt;b&gt;Peça&lt;/b&gt;"));
  assert.ok(!ctx.venda.itens_tabela.includes("<b>"));
});
