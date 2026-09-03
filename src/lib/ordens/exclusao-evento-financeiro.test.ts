import assert from "node:assert/strict";
import test from "node:test";

import {
  analisarExclusaoEventoFinanceiro,
  eventoTemProvenienciaExcluivel,
  type EventoParaExclusao,
} from "./exclusao-evento-financeiro";

function evento(overrides: Partial<EventoParaExclusao> = {}): EventoParaExclusao {
  return {
    id: 1,
    origem: "SERVICO",
    natureza: "DESPESA",
    status: "ATIVO",
    descricao: "Despesa manual",
    valor: 100,
    chave_origem: "MANUAL:teste",
    is_manual: true,
    ...overrides,
  };
}

test("somente a proveniência manual real permite exclusão", () => {
  assert.equal(eventoTemProvenienciaExcluivel(evento()), true);
  assert.equal(eventoTemProvenienciaExcluivel(evento({ is_manual: false })), false);
  assert.equal(eventoTemProvenienciaExcluivel(evento({ chave_origem: "15" })), false);

  // A correção de comissão marca is_manual, mas não muda sua origem automática.
  assert.equal(eventoTemProvenienciaExcluivel(evento({
    origem: "COMISSAO",
    chave_origem: "12:usuario",
  })), false);

  assert.equal(eventoTemProvenienciaExcluivel(evento({
    origem: "FRETE",
    natureza: "RECEITA",
    chave_origem: "FRETE",
    is_manual: false,
  })), false);
});

test("receita de frete é protegida e orienta editar o orçamento", () => {
  const impacto = analisarExclusaoEventoFinanceiro(evento({
    origem: "FRETE",
    natureza: "RECEITA",
    chave_origem: "FRETE",
    is_manual: false,
  }), { statusOs: "EM_ANDAMENTO" });

  assert.equal(impacto.podeExcluir, false);
  assert.match(impacto.bloqueio ?? "", /orçamento da OS/i);
});

test("despesa manual de frete explica resultado, DRE e preservação da cobrança", () => {
  const impacto = analisarExclusaoEventoFinanceiro(evento({
    origem: "FRETE",
    natureza: "DESPESA",
    descricao: "Transportadora",
    valor: 80,
  }), { statusOs: "CONCLUIDO", mesesFechados: ["08/2026"] });

  assert.equal(impacto.podeExcluir, true);
  assert.equal(impacto.devolveEstoque, false);
  assert.ok(impacto.efeitos.some((texto) => /resultado da OS aumentará/i.test(texto)));
  assert.ok(impacto.efeitos.some((texto) => /frete cobrado do cliente/i.test(texto)));
  assert.ok(impacto.efeitos.some((texto) => /linha 4\.6/i.test(texto)));
  assert.ok(impacto.efeitos.some((texto) => /08\/2026/i.test(texto)));
});

test("receita manual e consumo sem estoque deixam explícito que não alteram itens", () => {
  const receita = analisarExclusaoEventoFinanceiro(evento({
    natureza: "RECEITA",
    valor: 55,
  }), { statusOs: "EM_ANDAMENTO" });
  assert.equal(receita.podeExcluir, true);
  assert.ok(receita.efeitos.some((texto) => /resultado da OS diminuirá/i.test(texto)));
  assert.ok(receita.efeitos.some((texto) => /saldo de estoque não serão alterados/i.test(texto)));

  const consumo = analisarExclusaoEventoFinanceiro(evento({
    origem: "CONSUMO",
    natureza: "DESPESA",
  }), { statusOs: "EM_ANDAMENTO" });
  assert.equal(consumo.podeExcluir, true);
  assert.equal(consumo.exigeMotivo, false);
  assert.ok(consumo.efeitos.some((texto) => /não possui saída de estoque vinculada/i.test(texto)));
});

test("consumo com saída informa a devolução e exige motivo", () => {
  const impacto = analisarExclusaoEventoFinanceiro(evento({
    origem: "CONSUMO",
    chave_origem: "CONSUMO:77",
    consumo_saida_id: 77,
    quantidade_snapshot: 2.5,
    dados_snapshot: { item_titulo: "Desengripante", unidade: "UN", escopo: "PRODUTO" },
  }), { statusOs: "EM_ANDAMENTO" });

  assert.equal(impacto.podeExcluir, true);
  assert.equal(impacto.exigeMotivo, true);
  assert.equal(impacto.estoque?.quantidade, 2.5);
  assert.ok(impacto.efeitos.some((texto) => /retornará ao estoque/i.test(texto)));

  const finalizada = analisarExclusaoEventoFinanceiro(evento({
    origem: "CONSUMO",
    chave_origem: "CONSUMO:77",
    consumo_saida_id: 77,
  }), { statusOs: "SEM_COBRANCA" });
  assert.equal(finalizada.podeExcluir, false);
  assert.match(finalizada.bloqueio ?? "", /reabra a OS/i);
});

test("evento convertido bloqueia a exclusão e nunca promete cascata", () => {
  const impacto = analisarExclusaoEventoFinanceiro(evento({
    status: "CONVERTIDO",
    lancamento_id: 91,
  }), { statusOs: "EM_ANDAMENTO" });

  assert.equal(impacto.podeExcluir, false);
  assert.equal(impacto.lancamentoId, 91);
  assert.match(impacto.bloqueio ?? "", /Financeiro/i);
  assert.ok(impacto.efeitos.some((texto) => /nenhuma transação será removida em cascata/i.test(texto)));
});
