import assert from "node:assert/strict";
import test from "node:test";

import {
  motivoForaDaEmissaoEmLote,
  osPodeEmitirNota,
  podeEntrarNaEmissaoEmLote,
  vendaPodeEmitirNota,
} from "./elegibilidadeEmissao";

const ligado = { habilitar_emissao_nfe: true };

test("sem a chave geral, nada emite", () => {
  assert.equal(osPodeEmitirNota("CONCLUIDO", { habilitar_emissao_nfe: false }), false);
  assert.equal(vendaPodeEmitirNota("FINALIZADA", { habilitar_emissao_nfe: false }), false);
  assert.equal(osPodeEmitirNota("CONCLUIDO", null), false);
});

test("no padrão, a OS só emite depois de concluída", () => {
  assert.equal(osPodeEmitirNota("CONCLUIDO", ligado), true);
  assert.equal(osPodeEmitirNota("PAGAMENTO", ligado), false);
  assert.equal(osPodeEmitirNota("FATURAMENTO", ligado), false);
  assert.equal(osPodeEmitirNota("EM_ANDAMENTO", ligado), false);
});

test("com faturamento antes do pagamento, a OS emite em PAGAMENTO e FATURAMENTO", () => {
  const config = { ...ligado, emissao_nf_ordens_nao_pagas: true };
  assert.equal(osPodeEmitirNota("PAGAMENTO", config), true);
  assert.equal(osPodeEmitirNota("FATURAMENTO", config), true);
  assert.equal(osPodeEmitirNota("CONCLUIDO", config), true);
  assert.equal(osPodeEmitirNota("EM_ANDAMENTO", config), false);
});

test("a venda segue a mesma lógica com os status dela", () => {
  assert.equal(vendaPodeEmitirNota("FINALIZADA", ligado), true);
  assert.equal(vendaPodeEmitirNota("PAGAMENTO", ligado), false);

  const config = { ...ligado, emissao_nf_vendas_nao_pagas: true };
  assert.equal(vendaPodeEmitirNota("PAGAMENTO", config), true);
  assert.equal(vendaPodeEmitirNota("FINALIZADA", config), true);
});

test("o status é comparado sem depender de caixa ou espaços", () => {
  assert.equal(osPodeEmitirNota(" concluido ", ligado), true);
  assert.equal(vendaPodeEmitirNota("finalizada", ligado), true);
});

test("documento que já tem nota fica fora do lote, mesmo podendo emitir", () => {
  const ordem = { status: "CONCLUIDO", notaNumero: 1042 };
  assert.equal(osPodeEmitirNota(ordem.status, ligado), true);
  assert.equal(podeEntrarNaEmissaoEmLote(ordem, ligado, "OS"), false);
  assert.match(
    String(motivoForaDaEmissaoEmLote(ordem, ligado, "OS")),
    /1042/,
    "o motivo precisa dizer qual nota já existe",
  );
});

test("documento sem nota e em status válido entra no lote", () => {
  const ordem = { status: "CONCLUIDO", notaNumero: null };
  assert.equal(podeEntrarNaEmissaoEmLote(ordem, ligado, "OS"), true);
  assert.equal(motivoForaDaEmissaoEmLote(ordem, ligado, "OS"), undefined);
});

test("o motivo distingue chave desligada de status insuficiente", () => {
  assert.match(
    String(motivoForaDaEmissaoEmLote({ status: "CONCLUIDO" }, { habilitar_emissao_nfe: false }, "OS")),
    /desligada/i,
  );
  assert.match(
    String(motivoForaDaEmissaoEmLote({ status: "EM_ANDAMENTO" }, ligado, "OS")),
    /status/i,
  );
});
