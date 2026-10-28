import assert from "node:assert/strict";
import test from "node:test";

import {
  classificarItemBrPecas,
  lerItens,
  lerOrdens,
  montarOrdem,
  numeroBr,
  type ItemLegado,
  type OrdemLegada,
} from "./brpecas-os-historicas-lib";

function td(valor: string) {
  return `<TD NOWRAP ALIGN="LEFT" BGCOLOR=#FFFFFF><FONT STYLE="font-family: Tahoma">${valor || "&nbsp;"}</FONT></TD>`;
}

function tr(celulas: string[]) {
  return `<TR>${celulas.map(td).join("")}</TR>\n`;
}

const CABECALHO_ORDENS = [
  "Número #", "Data", "Hora", "Cliente", "Vendedor", "Status", "Total",
  "Zona", "Cidade", "Estado", "Bairro", "DESCONTO", "TOTALITENS",
];

const CABECALHO_ITENS = [
  "", "Item", "Preço", "Qtd", "Qtd. Volume", "Total", "Qtd. Faturada", "Vendedor",
  "Status", "Nota", "Fabricante", "Zona", "Vendedor Peça", "Comissão Prc. Tabela",
  "Comissão Preço Venda", "FUNCPRODUCAO", "Custo", "CustoM", "RATEIODESCONTO",
  "TOTALPGTOS", "TOTALITENS123", "TOTALPRODUTOS", "TRANSPORTADORA", "BASECALCICMS",
];

function linhaItem(descricao: string, preco: string, qtd: string, total: string, mecanico = "") {
  const celulas = Array<string>(24).fill("0,00");
  celulas[0] = "";
  celulas[1] = descricao;
  celulas[2] = preco;
  celulas[3] = qtd;
  celulas[5] = total;
  celulas[12] = mecanico;
  return celulas;
}

const HTML_ORDENS =
  "<TABLE>" +
  tr(CABECALHO_ORDENS) +
  tr(["0019036", "02/01/2026", "12:05:19", "Consumidor Final", "ND", "Enviar para o Caixa", "420,000", "", "", "PB", "", "0,00", "420,00"]) +
  tr(["0019039", "05/01/2026", "16:54:18", "ROMILDO CORDEIRO", "ND", "Faturado", "1.800,000", "", "Cabedelo", "PB", "Jardim America", "-20,00", "1.820,00"]) +
  tr(["2", "", "", "", "", "", "2.220,00", "", "", "", "", "", ""]) +
  "</TABLE>";

const HTML_ITENS =
  "<TABLE>" +
  tr(CABECALHO_ITENS) +
  `<TR class="Group"><TD COLSPAN=24>Pedido. : 0019036 </TD></TR>\n` +
  tr(linhaItem("OLEO 20W50 &amp; PREMIUM 1L", "40,000", "4,000", "160,00")) +
  tr(linhaItem("SERVIÇO DE TROCA DE CHAVE", "60,000", "1,000", "60,00")) +
  `<TR class="Group"><TD COLSPAN=24>Pedido. : 0019039 </TD></TR>\n` +
  tr(linhaItem("CHECKLIST PINTURA CAPO E PARACHOQUE", "1.820,000", "1,000", "1.820,00", "JEFFERSON CLEYTON SANTANA DA SILVA")) +
  tr(linhaItem("", "359950,45", "1.966,00", "427.436,45")) +
  "</TABLE>";

test("numeros do legado usam milhar com ponto e decimal com virgula", () => {
  assert.equal(numeroBr("1.820,000"), 1820);
  assert.equal(numeroBr("-20,00"), -20);
  assert.equal(numeroBr("0,000"), 0);
  assert.throws(() => numeroBr(""));
  assert.throws(() => numeroBr("abc"));
});

test("ordens: cabecalho validado, rodape descartado, data e desconto normalizados", () => {
  const ordens = lerOrdens(HTML_ORDENS);
  assert.equal(ordens.length, 2);
  assert.deepEqual(
    { ...ordens[1] },
    {
      numero: "0019039",
      data: "2026-01-05",
      hora: "16:54:18",
      cliente: "ROMILDO CORDEIRO",
      situacao: "Faturado",
      total: 1800,
      desconto: 20,
      totalItens: 1820,
      cidade: "Cabedelo",
      estado: "PB",
      bairro: "Jardim America",
    },
  );
});

test("ordens: situacao desconhecida interrompe a leitura", () => {
  assert.throws(() => lerOrdens(HTML_ORDENS.replace("Faturado", "Cancelado")), /Situação desconhecida/);
});

test("itens: agrupados pela OS, entidades decodificadas e rodape fora", () => {
  const itens = lerItens(HTML_ITENS);
  assert.deepEqual(
    itens.map((item) => [item.numero, item.linhaOrigem, item.descricao, item.subtotal]),
    [
      ["0019036", 3, "OLEO 20W50 & PREMIUM 1L", 160],
      ["0019036", 4, "SERVIÇO DE TROCA DE CHAVE", 60],
      ["0019039", 6, "CHECKLIST PINTURA CAPO E PARACHOQUE", 1820],
    ],
  );
  assert.equal(itens[2].mecanico, "JEFFERSON CLEYTON SANTANA DA SILVA");
});

test("itens: total que nao confere com quantidade vezes preco interrompe", () => {
  assert.throws(() => lerItens(HTML_ITENS.replace("160,00", "150,00")), /não confere/);
});

test("classificacao: checklist e servico do legado, retificador e peca", () => {
  assert.deepEqual(classificarItemBrPecas("CHECKLIST PINTURA CAPO E PARACHOQUE"), {
    tipo: "SERVICO",
    motivo: "SERVICO_NO_LEGADO",
  });
  assert.equal(classificarItemBrPecas("PINTURA E RECUPERACAO").tipo, "SERVICO");
  assert.equal(classificarItemBrPecas("MATERIAL PINTURA").tipo, "PRODUTO");
  assert.equal(classificarItemBrPecas("RETIFICADOR ALT 120A DENSO").tipo, "PRODUTO");
  assert.equal(classificarItemBrPecas("RETIFICA PLAINA").tipo, "SERVICO");
  assert.equal(classificarItemBrPecas("SERVIÇO DE TROCA DE CHAVE").tipo, "SERVICO");
  assert.equal(classificarItemBrPecas("MAO DE OBRA").tipo, "SERVICO");
  assert.equal(classificarItemBrPecas("CHUMBO PARA ALINHAMENTO").tipo, "PRODUTO");
  assert.equal(classificarItemBrPecas("FILTRO DE OLEO").tipo, "PRODUTO");
});

const ordemBase: OrdemLegada = {
  numero: "0019039",
  data: "2026-01-05",
  hora: "16:54:18",
  cliente: "ROMILDO CORDEIRO",
  situacao: "Enviar para o Caixa",
  total: 1800,
  desconto: 20,
  totalItens: 1820,
  cidade: "Cabedelo",
  estado: "PB",
  bairro: "",
};

function item(subtotal: number, mecanico = ""): ItemLegado {
  return { numero: "0019039", linhaOrigem: 2, descricao: "X", precoUnitario: subtotal, quantidade: 1, subtotal, mecanico };
}

test("montagem: totais, snapshot sem campos vazios e observacoes do legado", () => {
  const montada = montarOrdem(ordemBase, [item(1000, "JOSENILSON"), item(820, "JOSENILSON")]);
  assert.equal(montada.dataentrada, "2026-01-05T16:54:18-03:00");
  assert.equal(montada.descricao, "OS 0019039 do sistema anterior");
  assert.deepEqual([montada.subtotal, montada.desconto, montada.orcamentototal], [1820, 20, 1800]);
  assert.deepEqual(montada.clienteSnapshot, { nome: "ROMILDO CORDEIRO", cidade: "Cabedelo", estado: "PB" });
  assert.equal(montada.consumidorFinal, false);
  assert.equal(
    montada.observacoes,
    "Registro legado: 0019039\nSituação no sistema anterior: Enviar para o Caixa\nMecânicos no sistema anterior: JOSENILSON",
  );
});

test("montagem: itens que nao cobrem o total do legado viram observacao", () => {
  const montada = montarOrdem(ordemBase, [item(820)]);
  assert.equal(montada.orcamentototal, 800);
  assert.equal(montada.diferencaLegado, 1000);
  assert.match(montada.observacoes, /Total no sistema anterior: R\$ 1\.800,00 \(os itens exportados somam R\$ 800,00\)/);
});

test("montagem: consumidor final vincula ao cadastro do sistema, sem snapshot", () => {
  const montada = montarOrdem({ ...ordemBase, cliente: "Consumidor Final", desconto: 0, total: 1820 }, [item(1820)]);
  assert.equal(montada.consumidorFinal, true);
  assert.equal(montada.clienteSnapshot, null);
});
