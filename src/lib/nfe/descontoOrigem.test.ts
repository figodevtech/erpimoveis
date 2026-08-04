import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  descontoPorItem,
  distribuirDinheiro,
  parcelaDoDescontoNaNota,
  ratearDescontoGeral,
} from "./descontoOrigem";

describe("desconto vindo de OS e venda", () => {
  it("soma o desconto do item ao rateio do desconto geral", () => {
    // Dois itens de R$ 100 brutos; o primeiro já tem R$ 20 de desconto próprio.
    // O desconto geral de R$ 16 se divide na proporção 80/100 do líquido.
    const descontos = descontoPorItem(
      [
        { bruto: 100, liquido: 80 },
        { bruto: 100, liquido: 100 },
      ],
      16,
    );

    assert.deepEqual(descontos, [27.11, 8.89]);
  });

  it("não deixa o desconto geral estourar o bruto do item", () => {
    const descontos = descontoPorItem([{ bruto: 50, liquido: 10 }], 100);
    assert.deepEqual(descontos, [50]);
  });

  it("devolve zeros quando a origem não tem desconto geral", () => {
    const descontos = descontoPorItem(
      [
        { bruto: 100, liquido: 90 },
        { bruto: 200, liquido: 200 },
      ],
      0,
    );

    assert.deepEqual(descontos, [10, 0]);
  });

  it("reserva para os serviços a parte do desconto geral que não entra na nota", () => {
    // OS com R$ 100 de peças e R$ 100 de mão de obra e R$ 20 de desconto geral:
    // só metade cabe aos produtos, o resto sai na NFS-e.
    const rateio = ratearDescontoGeral(20, [100], [100]);
    assert.deepEqual(rateio, [10]);
  });

  it("fecha exatamente o total distribuído mesmo com sobra de centavos", () => {
    const partes = distribuirDinheiro(10, [1, 1, 1]);
    assert.equal(
      partes.reduce((soma, parte) => soma + parte, 0).toFixed(2),
      "10.00",
    );
  });
});

describe("desconto geral editado na emissão", () => {
  it("rateia R$ 30 proporcionalmente e joga a sobra de centavos no último item", () => {
    // Três itens iguais: 30/3 não fecha em centavos redondos por acaso, mas o
    // caso clássico é 10/3 — aqui garantimos que a soma bate com o digitado.
    const descontos = descontoPorItem(
      [
        { bruto: 100, liquido: 100 },
        { bruto: 100, liquido: 100 },
        { bruto: 100, liquido: 100 },
      ],
      10,
    );

    assert.deepEqual(descontos, [3.33, 3.33, 3.34]);
    assert.equal(descontos.reduce((soma, valor) => soma + valor, 0).toFixed(2), "10.00");
  });

  it("rateia R$ 30 na proporção do valor de cada item", () => {
    const descontos = descontoPorItem(
      [
        { bruto: 200, liquido: 200 },
        { bruto: 100, liquido: 100 },
      ],
      30,
    );

    assert.deepEqual(descontos, [20, 10]);
  });

  it("informa quanto do desconto geral cabe aos produtos da nota", () => {
    // OS de R$ 100 em peças e R$ 300 em serviço, R$ 40 de desconto geral:
    // só um quarto entra na NF-e.
    assert.equal(parcelaDoDescontoNaNota(40, [100], [300]), 10);
    // Sem serviços, o desconto inteiro cabe aos produtos.
    assert.equal(parcelaDoDescontoNaNota(40, [100, 300]), 40);
  });
});
