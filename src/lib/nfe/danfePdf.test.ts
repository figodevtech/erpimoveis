import assert from "node:assert/strict";
import test from "node:test";

import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DanfeView, type DanfeViewData } from "@/components/danfe/danfe-view";
import { DANFE_MAX_FONT_SCALE } from "@/lib/nfe/danfeFontScale";
import type { DanfeItem, DanfeTaxTotals } from "@/lib/nfe/danfeParser";
import { gerarDanfePdf } from "@/lib/nfe/danfePdf";
import { descreverDocumentoReferenciado } from "@/lib/nfe/danfeDocumentosReferenciados";
import { temTotaisRtc, usaDanfeRtc2026 } from "@/lib/nfe/danfeRtc";

const totaisZerados: DanfeTaxTotals = {
  vBC: 0,
  vICMS: 0,
  vICMSDeson: 0,
  vFCP: 0,
  vBCST: 0,
  vST: 0,
  vFCPST: 0,
  vFCPSTRet: 0,
  vProd: 0,
  vFrete: 0,
  vSeg: 0,
  vDesc: 0,
  vII: 0,
  vIPI: 0,
  vIPIDevol: 0,
  vPIS: 0,
  vCOFINS: 0,
  vOutro: 0,
  vNF: 0,
  vTotTrib: 0,
  vBCIBSCBS: 0,
  vIBSUF: 0,
  vIBSMun: 0,
  vIBS: 0,
  vCBS: 0,
  vIS: 0,
  vServ: 0,
  vBCISS: 0,
  vISS: 0,
};

function pdfContent(pdf: PDFDocument) {
  return pdf.getPages().map((page) => {
    const streams = page.node.Contents();
    if (!streams) return "";
    const entries = streams instanceof PDFArray ? streams.asArray() : [streams];
    return entries.map((entry) => {
      const stream = pdf.context.lookup(entry);
      assert.ok(stream instanceof PDFRawStream);
      return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    }).join("\n");
  }).join("\n");
}

function pdfHexText(text: string) {
  return `<${Buffer.from(text, "latin1").toString("hex").toUpperCase()}> Tj`;
}

function item(index: number): DanfeItem {
  return {
    id: String(index),
    n_item: index,
    produtoid: `CODIGO-${index}`,
    ean: "",
    descricao: `ITEM ${index} COM DESCRICAO LONGA PARA VALIDAR A QUEBRA E A PAGINACAO DO DANFE VETORIAL`,
    ncm: "12345678",
    cest: "",
    cfop: "5102",
    unidade: "UN",
    quantidade: 1234.5678,
    valor_unitario: 123456.78,
    valor_total: 123456.78,
    valor_desconto: 0,
    origem: "0",
    csosn: "102",
    valor_bc_icms: 0,
    aliquotaicms: 0,
    valor_icms: 0,
    cst_ipi: null,
    valor_bc_ipi: 0,
    aliquota_ipi: 0,
    valor_ipi: 0,
    cst_pis: "99",
    aliquota_pis: 0,
    valor_pis: 0,
    cst_cofins: "99",
    aliquota_cofins: 0,
    valor_cofins: 0,
    cst_ibs_cbs: null,
    classificacao_tributaria: null,
    base_ibs_cbs: 0,
    aliquota_ibs_uf: 0,
    valor_ibs_uf: 0,
    aliquota_ibs_municipio: 0,
    valor_ibs_municipio: 0,
    valor_ibs: 0,
    aliquota_cbs: 0,
    valor_cbs: 0,
    cst_is: null,
    valor_is: 0,
  };
}

test("gera DANFE vetorial com mais de uma folha quando os itens excedem o A4", async () => {
  const data: DanfeViewData = {
    nfe: { numero: 123, serie: 1, protocolo: "123456789012345", dataautorizacao: "2026-08-22T12:00:00-03:00" },
    emitenteNome: "EMPRESA TESTE LTDA",
    emitenteEndereco: "RUA DE TESTE, 123 - JOAO PESSOA/PB",
    emitenteCnpj: "12345678000199",
    emitenteIe: "123456789",
    destinatarioNome: "CLIENTE TESTE",
    destinatarioDoc: "12345678901",
    destinatarioEndereco: "AVENIDA DE TESTE, 456",
    destinatarioCidadeUf: "JOAO PESSOA/PB",
    destinatarioCep: "58000000",
    destinatarioIe: "ISENTO",
    dataEmissaoDanfe: "2026-08-22T12:00:00-03:00",
    dataSaidaEntrada: "2026-08-22T12:00:00-03:00",
    tipoOperacao: "SAIDA",
    naturezaOperacao: "VENDA",
    ambiente: "1",
    tipoEmissao: "1",
    statusUpper: "AUTORIZADA",
    statusLabel: "Autorizada",
    chaveAcesso: "12345678901234567890123456789012345678901234",
    chaveFormatada: "1234 5678 9012 3456 7890 1234 5678 9012 3456 7890 1234",
    isAutorizada: true,
    xmlBaseAvailable: true,
    itensDisplay: Array.from({ length: 50 }, (_, index) => item(index + 1)),
    totais: totaisZerados,
    transporte: {
      modFrete: "9",
      nome: "",
      documento: "",
      ie: "",
      endereco: "",
      municipio: "",
      uf: "",
      placa: "",
      ufVeiculo: "",
      rntc: "",
      volumes: [],
    },
    fatura: null,
    duplicatas: [],
    pagamentos: [],
    documentosReferenciados: [{ tipo: "NFE", chave: "29260815851413000157550010004179631007316491" }],
    infCpl: "Informacoes complementares de teste.",
    infAdFisco: "",
  };

  const bytes = await gerarDanfePdf(data);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(pdf.getProducer(), "ERP Imóveis");
  assert.equal(pdf.getCreator(), "ERP Imóveis");
  const bytesComFonteMaxima = await gerarDanfePdf(data, { fontScale: DANFE_MAX_FONT_SCALE });
  const pdfComFonteMaxima = await PDFDocument.load(bytesComFonteMaxima);

  assert.ok(bytes.byteLength > 1_000);
  assert.ok(pdf.getPageCount() > 1);
  assert.ok(bytesComFonteMaxima.byteLength > 1_000);
  assert.ok(pdfComFonteMaxima.getPageCount() > pdf.getPageCount());
  assert.equal(descreverDocumentoReferenciado(data.documentosReferenciados[0]),
    "NF-e: 2926 0815 8514 1300 0157 5500 1000 4179 6310 0731 6491");
  const html = renderToStaticMarkup(createElement(DanfeView, { data, showActions: false }));
  assert.match(html, /DOCUMENTOS FISCAIS REFERENCIADOS/i);
  assert.match(html, /NF-e: 2926 0815 8514 1300 0157 5500 1000 4179 6310 0731 6491/);

  assert.ok(pdfContent(pdf).includes(pdfHexText("NF-e: 2926 0815 8514 1300 0157 5500 1000 4179 6310 0731 6491")));

  data.itensDisplay = [];
  data.documentosReferenciados = [];
  const htmlSemReferencias = renderToStaticMarkup(createElement(DanfeView, { data, showActions: false }));
  assert.doesNotMatch(htmlSemReferencias, /DOCUMENTOS FISCAIS REFERENCIADOS/i);
  data.documentosReferenciados = Array.from({ length: 180 }, (_, index) => ({
    tipo: "NFE" as const,
    chave: `2926081585141300015755001000417963100731${String(index).padStart(4, "0")}`,
  }));
  const pdfComReferencias = await PDFDocument.load(await gerarDanfePdf(data));
  assert.ok(pdfComReferencias.getPageCount() > 1);
  const conteudoReferencias = pdfContent(pdfComReferencias);
  for (const referencia of data.documentosReferenciados) {
    assert.ok(conteudoReferencias.includes(pdfHexText(descreverDocumentoReferenciado(referencia))));
  }

  // A reimpressão do histórico conserva o modelo anterior, independentemente de hoje.
  assert.equal(usaDanfeRtc2026("2026-11-30T23:59:59-03:00"), false);
  assert.equal(usaDanfeRtc2026("2026-12-01T00:00:00-03:00"), true);
  assert.equal(temTotaisRtc({ ...totaisZerados, possuiGrupoRtc: true }), true);
  data.documentosReferenciados = [];
  data.dataEmissaoDanfe = "2026-12-01T10:00:00-03:00";
  data.emitenteCrt = "3";
  data.totais = { ...totaisZerados, possuiGrupoRtc: true, vIBSMono: 0, vCBSMono: 123.45, vNFTot: 987.65 };
  data.itensDisplay = [{ ...item(1), cst_ibs_cbs: "200", classificacao_tributaria: "200001", base_ibs_cbs: 100,
    aliquota_ibs_uf: 0.1, aliquota_ibs_uf_efetiva: 0, aliquota_cbs: 0.9, aliquota_cbs_efetiva: 0.36,
    cst_is: "000", base_is: 100, aliquota_is: 2, valor_is: 2 }];
  const htmlRtc = renderToStaticMarkup(createElement(DanfeView, { data, showActions: false }));
  assert.match(htmlRtc, /Código do Regime Tributário/);
  assert.match(htmlRtc, /Total do IBS\/CBS\/IS/);
  assert.match(htmlRtc, /IBS monofásico/);
  assert.match(htmlRtc, /0,36/);
  assert.match(htmlRtc, /987,65/);
  assert.doesNotMatch(htmlRtc, /CBS monofásica por retenção/);
  const pdfRtc = await PDFDocument.load(await gerarDanfePdf(data));
  const conteudoRtc = pdfContent(pdfRtc);
  for (const texto of ["CODIGO DO REGIME TRIBUTARIO", "TOTAL DO IBS/CBS/IS", "IBS MONOFASICO", "987,65"]) {
    assert.ok(conteudoRtc.includes(pdfHexText(texto)), `PDF deve imprimir ${texto}`);
  }
  data.dataEmissaoDanfe = "2026-11-30T10:00:00-03:00";
  const htmlHistorico = renderToStaticMarkup(createElement(DanfeView, { data, showActions: false }));
  assert.doesNotMatch(htmlHistorico, /Código do Regime Tributário/);
  assert.doesNotMatch(htmlHistorico, /Total do IBS\/CBS\/IS/);
});
