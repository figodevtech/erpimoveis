import assert from "node:assert/strict";
import test from "node:test";

import {
  arredondarMoeda,
  classificarItem,
  descricaoHistorica,
} from "./garagepremium-orcamentos-lib";

test("codigo 65 e sempre servico", () => {
  assert.equal(classificarItem(65, "FILTRO DE ÓLEO").tipo, "SERVICO");
});

test("atividades inequívocas fora do codigo 65 sao servicos", () => {
  assert.equal(classificarItem(3834, "ALINHAMENTO E BALANCEAMENTO").tipo, "SERVICO");
  assert.equal(classificarItem(432, "CARGA DE GÁS").tipo, "SERVICO");
  assert.equal(classificarItem(4567, "MÃO DE OBRA REVISÃO").tipo, "SERVICO");
  assert.equal(classificarItem(4343, "GP REPARO DO CAMBIO RAV4").tipo, "SERVICO");
});

test("codigo reutilizado e classificado pela descricao", () => {
  assert.equal(classificarItem(75, "OLEO 5W30 DPF MOTUL").tipo, "PRODUTO");
  assert.equal(classificarItem(75, "SERVIÇO MECANICO").tipo, "SERVICO");
});

test("materiais com palavras de atividade continuam produtos", () => {
  assert.equal(classificarItem(523, "KIT REVISÃO").tipo, "PRODUTO");
  assert.equal(classificarItem(2711, "ADITIVO LIMPEZA SISTEMA DIESEL").tipo, "PRODUTO");
  assert.equal(classificarItem(142, "CHUMBO BALANCEAMENTO E ALINHAMENTO").tipo, "PRODUTO");
  assert.equal(classificarItem(2319, "GAS PARA LIMPEZA DE AR CONDICIONADO").tipo, "PRODUTO");
});

test("descricao ausente recebe fallback e respeita o codigo", () => {
  assert.equal(descricaoHistorica(null, 123), "Item legado sem descrição — código 123");
  assert.equal(classificarItem(123, null).tipo, "PRODUTO");
  assert.equal(classificarItem(65, null).tipo, "SERVICO");
});

test("valores monetarios sao arredondados por linha", () => {
  assert.equal(arredondarMoeda(10.005), 10.01);
});
