import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";

import { gerarDanfsePdf } from "@/lib/nfse/danfsePdf";
import type { DanfseViewData } from "@/lib/nfse/danfseDados";

function nota(overrides: Partial<DanfseViewData> = {}): DanfseViewData {
  return {
    id: 42,
    numero: "1234",
    codigoVerificacao: "ABCD-1234",
    referencia: "OS_195_SRV_7_1756000000",
    status: "AUTORIZADA",
    isAutorizada: true,
    isCancelada: false,
    modeloEmissao: "MUNICIPAL_CABEDELO",
    municipioLabel: "Cabedelo",
    homologacao: false,
    ordemServicoId: 195,
    dataEmissao: "2026-08-24T13:00:00-03:00",
    prestador: {
      nome: "OFICINA MODELO LTDA",
      documento: "12.260.723/0001-09",
      inscricaoMunicipal: "998877",
      endereco: "AV BEIRA RIO, 100, CENTRO, 58100-000",
      municipio: "CABEDELO / PB",
      telefone: "(83) 99999-0000",
      email: "contato@oficina.com.br",
    },
    tomador: {
      nome: "CLIENTE EXEMPLO ME",
      documento: "111.222.333-44",
      inscricaoMunicipal: "",
      endereco: "RUA DAS ACACIAS, 45, JARDIM, 58000-000",
      municipio: "JOAO PESSOA / PB",
      telefone: "(83) 98888-1111",
      email: "cliente@exemplo.com",
    },
    itens: [
      { descricao: "Troca de correia dentada", quantidade: 1, valorUnitario: 450, valorTotal: 450 },
      { descricao: "Alinhamento e balanceamento", quantidade: 2, valorUnitario: 75, valorTotal: 150 },
    ],
    valorServicos: 600,
    aliquotaIss: 5,
    valorIss: 30,
    issRetido: false,
    itemListaServico: "14.01",
    codigoCnae: "4520001",
    naturezaOperacao: "1 - Tributacao no municipio",
    discriminacao: "OS 195 - Troca de correia dentada; Alinhamento e balanceamento",
    informacoesComplementares: "Garantia de 90 dias para o servico prestado.",
    urlConsulta: "https://portal.cabedelo.pb.gov.br/nfse/consulta?codigo=ABCD-1234",
    ...overrides,
  };
}

describe("DANFSe gerado pelo sistema", () => {
  it("monta um PDF valido para a nota de Cabedelo, que a prefeitura nao publica", async () => {
    const bytes = await gerarDanfsePdf(nota());

    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
  });

  it("pagina quando a discriminacao nao cabe numa folha", async () => {
    const discriminacao = Array.from(
      { length: 220 },
      (_, indice) => `Servico ${indice + 1} executado com substituicao de pecas e conferencia final`,
    ).join("\n");

    const pdf = await PDFDocument.load(await gerarDanfsePdf(nota({ discriminacao })));
    assert.ok(pdf.getPageCount() > 1, "esperava mais de uma pagina");
  });

  it("sai mesmo sem numero, codigo de verificacao ou link de consulta", async () => {
    // Nota autorizada cujo retorno da Focus ainda nao trouxe os identificadores:
    // o anexo nao pode falhar por causa disso, so sai sem QR.
    const bytes = await gerarDanfsePdf(
      nota({ numero: "", codigoVerificacao: "", urlConsulta: "", itens: [], valorServicos: 0, aliquotaIss: null, valorIss: null }),
    );

    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
  });

  it("marca homologacao e cancelamento no corpo do documento", async () => {
    const pdf = await PDFDocument.load(
      await gerarDanfsePdf(nota({ homologacao: true, isAutorizada: false, isCancelada: true, status: "CANCELADA" })),
    );

    assert.equal(pdf.getPageCount(), 1);
  });
});
