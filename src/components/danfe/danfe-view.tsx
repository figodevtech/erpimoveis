"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export type DanfeItemDisplay = {
  id: string;
  n_item: number;
  produtoid: string | number | null;
  descricao: string;
  ncm: string | null;
  cfop: string;
  csosn: string | null;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  valor_bc_icms: number;
  aliquotaicms: number;
  valor_icms: number;
  cst_pis: string | null;
  valor_pis: number;
  cst_cofins: string | null;
  valor_cofins: number;
};

export type DanfeViewData = {
  nfe: {
    numero: number;
    serie: number;
    ordemservicoid?: number | null;
    protocolo?: string | null;
    dataautorizacao?: string | null;
    total_servicos?: number | string | null;
  };
  emitenteNome: string;
  emitenteEndereco: string;
  emitenteCnpj: string;
  emitenteIe?: string | null;
  emitenteTelefone?: string | null;
  destinatarioNome: string;
  destinatarioDoc: string;
  destinatarioEndereco: string;
  destinatarioCidadeUf?: string | null;
  destinatarioCep?: string | null;
  dataEmissaoDanfe?: string | Date | null;
  tipoOperacao: string;
  statusUpper: string;
  statusLabel: string;
  chaveFormatada: string;
  isAutorizada: boolean;
  xmlError?: string | null;
  xmlBaseAvailable: boolean;
  itensDisplay: DanfeItemDisplay[];
  totalBcIcms: number;
  totalIcms: number;
  totalProdutos: number;
  totalNota: number;
  infCpl?: string | null;
};

function fmtDate(s?: string | Date | null) {
  if (!s) return "-";
  const d = s instanceof Date ? s : new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function fmtMoney(v: number | string | null | undefined) {
  if (v == null) return "-";
  const n = Number(v);
  if (Number.isNaN(n)) return "-";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function fmtPercent(v: number | string | null | undefined) {
  if (v == null) return "-";
  const n = Number(v);
  if (Number.isNaN(n)) return "-";
  return `${n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function fmtDoc(cpfCnpj: unknown) {
  if (cpfCnpj == null) return "-";
  const s = String(cpfCnpj).replace(/\D/g, "");
  if (!s) return "-";

  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Imagem do DANFE inválida.");

  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function buildImagePdf(imageBytes: Uint8Array, imageWidth: number, imageHeight: number) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let offset = 0;

  function pushString(value: string) {
    const bytes = encoder.encode(value);
    chunks.push(bytes);
    offset += bytes.length;
  }

  function pushBytes(bytes: Uint8Array) {
    chunks.push(bytes);
    offset += bytes.length;
  }

  function addObject(number: number, parts: Array<string | Uint8Array>) {
    offsets[number] = offset;
    pushString(`${number} 0 obj\n`);
    for (const part of parts) {
      if (typeof part === "string") pushString(part);
      else pushBytes(part);
    }
    pushString("\nendobj\n");
  }

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ`;
  const contentLength = encoder.encode(content).length;

  pushString("%PDF-1.4\n");
  addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  addObject(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  addObject(3, [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
  ]);
  addObject(4, [`<< /Length ${contentLength} >>\nstream\n${content}\nendstream`]);
  addObject(5, [
    `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
    imageBytes,
    "\nendstream",
  ]);

  const xrefOffset = offset;
  pushString("xref\n0 6\n0000000000 65535 f \n");
  for (let number = 1; number <= 5; number += 1) {
    pushString(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  pushString(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const pdfBytes = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    pdfBytes.set(chunk, cursor);
    cursor += chunk.length;
  }

  return new Blob([pdfBytes.buffer], { type: "application/pdf" });
}

function readImageSize(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Não foi possível ler a imagem do DANFE."));
    image.src = dataUrl;
  });
}

function DefaultActions({ exitHref, filename }: { exitHref: string; filename: string }) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  async function handleDownloadPdf() {
    if (isGeneratingPdf) return;

    const target = document.querySelector<HTMLElement>(".danfe-wrapper");
    if (!target) {
      toast.error("Não foi possível localizar o DANFE para baixar.");
      return;
    }

    setIsGeneratingPdf(true);

    try {
      await document.fonts?.ready;

      const { toJpeg } = await import("html-to-image");
      const rect = target.getBoundingClientRect();
      const width = Math.ceil(target.scrollWidth || rect.width);
      const height = Math.ceil(target.scrollHeight || rect.height);
      const dataUrl = await toJpeg(target, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        pixelRatio: 2,
        quality: 0.98,
        width,
        height,
        style: {
          margin: "0",
          transform: "none",
        },
      });
      const imageBytes = dataUrlToBytes(dataUrl);
      const imageSize = await readImageSize(dataUrl);
      const pdf = buildImagePdf(imageBytes, imageSize.width, imageSize.height);

      downloadBlob(pdf, filename);
    } catch (error) {
      console.error("Erro ao gerar PDF do DANFE:", error);
      toast.error("Não foi possível baixar o DANFE em PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  return (
    <>
      <Link href={exitHref} className="exit-link">
        Sair
      </Link>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void handleDownloadPdf()}
        disabled={isGeneratingPdf}
      >
        {isGeneratingPdf ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {isGeneratingPdf ? "Gerando PDF..." : "Baixar PDF"}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="mr-2 h-4 w-4" />
        Imprimir
      </Button>
    </>
  );
}

export function DanfeView({
  data,
  exitHref = "/fiscal",
  actions,
  showActions = true,
}: {
  data: DanfeViewData;
  exitHref?: string;
  actions?: React.ReactNode;
  showActions?: boolean;
}) {
  const {
    nfe,
    emitenteNome,
    emitenteEndereco,
    emitenteCnpj,
    emitenteIe,
    emitenteTelefone,
    destinatarioNome,
    destinatarioDoc,
    destinatarioEndereco,
    destinatarioCidadeUf,
    destinatarioCep,
    dataEmissaoDanfe,
    tipoOperacao,
    statusUpper,
    statusLabel,
    chaveFormatada,
    isAutorizada,
    xmlError,
    xmlBaseAvailable,
    itensDisplay,
    totalBcIcms,
    totalIcms,
    totalProdutos,
    totalNota,
    infCpl,
  } = data;
  const pdfFilename = `danfe-nfe-${nfe.numero.toString().padStart(9, "0")}.pdf`;

  return (
    <>
      <style>{`
        @page {
          size: A4;
          margin: 7mm 5mm;
        }

        .danfe-page {
          font-family: "Times New Roman", "Courier New", system-ui, -apple-system,
            BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 9px;
          color: #000;
          background: #f3f4f6;
          min-height: 100vh;
          padding: 16px 0;
          overflow-x: auto;
          overflow-y: visible;
          -webkit-overflow-scrolling: touch;
        }

        .danfe-scroll {
          width: max-content;
          min-width: 210mm;
          margin: 0 auto;
        }

        .danfe-wrapper {
          width: 210mm;
          min-width: 210mm;
          min-height: 297mm;
          margin: 0;
          background: #ffffff;
          border: 1px solid #000;
          padding: 4mm;
          box-sizing: border-box;
        }

        .actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          align-items: center;
          width: 210mm;
          margin: 0 0 8px 0;
          padding: 0 2px;
        }

        .exit-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 32px;
          padding: 0 12px;
          border: 1px solid hsl(214.3 31.8% 91.4%);
          border-radius: 6px;
          background: #ffffff;
          color: #111827;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 14px;
          font-weight: 500;
          text-decoration: none;
        }

        .exit-link:hover {
          background: #f9fafb;
        }

        .block-title {
          font-size: 7px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .field-label {
          font-size: 7px;
          text-transform: uppercase;
        }

        .field-value {
          font-size: 9px;
          font-weight: 500;
        }

        .border-box {
          border: 1px solid #000;
          box-sizing: border-box;
        }

        .center {
          text-align: center;
        }

        .right {
          text-align: right;
        }

        .small-text {
          font-size: 7px;
        }

        .danfe-main-title {
          font-size: 16px;
          font-weight: 700;
        }

        .danfe-subtitle {
          font-size: 9px;
          font-weight: 700;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          padding: 1px 8px;
          font-size: 7px;
          font-weight: 700;
          border: 1px solid #000;
        }

        .chave {
          font-family: "Courier New", ui-monospace, SFMono-Regular, Menlo, Monaco,
            Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 9px;
          letter-spacing: 1px;
          word-break: break-all;
        }

        .barcode-placeholder {
          border: 1px solid #000;
          height: 14mm;
          margin-top: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 7px;
        }

        .items-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 7px;
        }

        .items-table thead {
          background: #f9fafb;
        }

        .items-table th,
        .items-table td {
          border: 1px solid #000;
          padding: 2px 3px;
        }

        .items-table th {
          font-weight: 700;
          text-transform: uppercase;
        }

        .items-table td.desc {
          word-break: break-word;
        }

        @media (max-width: 767px) {
          .danfe-page {
            min-height: auto;
            padding: 12px 0 16px;
          }

          .danfe-scroll {
            margin: 0;
            padding: 0 12px;
          }

          .actions {
            position: sticky;
            left: 12px;
            z-index: 2;
            width: calc(100vw - 24px);
            justify-content: flex-start;
            background: #f3f4f6;
            padding: 0 0 8px;
          }
        }

        @media print {
          .danfe-page {
            background: #ffffff;
            padding: 0;
            min-height: auto;
            overflow: visible;
          }
          .danfe-scroll {
            width: auto;
            min-width: 0;
            margin: 0;
            padding: 0;
          }
          .actions {
            display: none;
          }
          .danfe-wrapper {
            margin: 0;
            border: none;
            width: auto;
            min-width: 0;
            min-height: auto;
            padding: 0;
          }
        }
      `}</style>

      <div className="danfe-page">
        <div className="danfe-scroll">
          {showActions && (
            <div className="actions">
              {actions ?? <DefaultActions exitHref={exitHref} filename={pdfFilename} />}
            </div>
          )}

          <div className="danfe-wrapper">
          <div
            className="border-box"
            style={{
              display: "grid",
              gridTemplateColumns: "2.5fr 2fr",
              marginBottom: "2mm",
            }}
          >
            <div style={{ borderRight: "1px solid #000", padding: "2px 3px" }}>
              <div className="block-title">RECEBEMOS DE</div>
              <div className="small-text">{emitenteNome}</div>
              <div className="small-text">
                NF-e Nº {nfe.numero.toString().padStart(9, "0")} SÉRIE{" "}
                {nfe.serie.toString().padStart(3, "0")}
              </div>
              <div className="small-text">
                A descrição dos produtos e/ou serviços constantes na NF-e indicada ao lado.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr" }}>
              <div style={{ borderRight: "1px solid #000", padding: "2px 3px", fontSize: 8 }}>
                <div className="block-title">DATA DE RECEBIMENTO</div>
                <div style={{ minHeight: "14mm" }} />
              </div>
              <div style={{ padding: "2px 3px", fontSize: 8 }}>
                <div className="block-title">IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR</div>
                <div style={{ minHeight: "14mm" }} />
              </div>
            </div>
          </div>

          <div
            className="border-box"
            style={{
              display: "grid",
              gridTemplateColumns: "2.8fr 2.2fr 2.5fr",
              marginBottom: "2mm",
            }}
          >
            <div style={{ borderRight: "1px solid #000", padding: "2px 3px" }}>
              <div className="block-title">IDENTIFICAÇÃO DO EMITENTE</div>
              <div className="field-value">{emitenteNome}</div>
              <div className="small-text">{emitenteEndereco}</div>
              <div className="small-text">
                CNPJ: {fmtDoc(emitenteCnpj)} {emitenteIe && ` | IE: ${emitenteIe}`}
              </div>
              {emitenteTelefone && <div className="small-text">Fone: {emitenteTelefone}</div>}
            </div>

            <div
              style={{
                borderRight: "1px solid #000",
                padding: "2px 3px",
                textAlign: "center",
              }}
            >
              <div className="danfe-main-title">DANFE</div>
              <div className="danfe-subtitle">DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA</div>
              <div className="small-text" style={{ marginTop: 4 }}>
                {tipoOperacao === "ENTRADA" ? "0-ENTRADA" : "1-SAÍDA"}
              </div>
              <div className="small-text" style={{ marginTop: 2 }}>
                Nº <strong>{nfe.numero.toString().padStart(9, "0")}</strong> SÉRIE{" "}
                <strong>{nfe.serie.toString().padStart(3, "0")}</strong>
              </div>
              <div className="small-text">
                FOLHA <strong>1/1</strong>
              </div>
              {nfe.ordemservicoid && (
                <div className="small-text" style={{ marginTop: 2 }}>
                  Ref. OS nº {nfe.ordemservicoid}
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                <span className="field-label">Status: </span>
                <span className="status-pill">{statusLabel || statusUpper || "DESCONHECIDO"}</span>
              </div>
              {xmlError && (
                <div className="small-text" style={{ marginTop: 4 }}>
                  ** Atenção: erro ao ler XML. DANFE baseado em dados do banco.
                </div>
              )}
            </div>

            <div style={{ padding: "2px 3px" }}>
              <div className="field-label center">CHAVE DE ACESSO</div>
              <div className="chave center">{chaveFormatada}</div>
              <div className="barcode-placeholder">CÓDIGO DE BARRAS (CODE-128C)</div>
              <div className="small-text" style={{ marginTop: 2 }}>
                {isAutorizada ? (
                  <>
                    Consulta de autenticidade no Portal Nacional da NF-e (www.nfe.fazenda.gov.br/portal) ou no site da
                    Sefaz Autorizadora.
                  </>
                ) : (
                  <>
                    DANFE emitido em ambiente de homologação ou em contingência. Consulte a NF-e no portal apropriado.
                  </>
                )}
              </div>
              {isAutorizada && nfe.protocolo && (
                <div className="small-text" style={{ marginTop: 2 }}>
                  PROTOCOLO DE AUTORIZAÇÃO DE USO: {nfe.protocolo}{" "}
                  {nfe.dataautorizacao && " - "}
                  {nfe.dataautorizacao && fmtDate(nfe.dataautorizacao)}
                </div>
              )}
            </div>
          </div>

          <div className="border-box" style={{ padding: "2px 3px", marginBottom: "2mm" }}>
            <div className="block-title">DESTINATÁRIO / REMETENTE</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "3fr 1.4fr 1.2fr",
                columnGap: "2mm",
                rowGap: "1mm",
                marginTop: 2,
              }}
            >
              <div>
                <div className="field-label">Nome / Razão Social</div>
                <div className="field-value">{destinatarioNome}</div>
              </div>
              <div>
                <div className="field-label">CPF/CNPJ</div>
                <div className="field-value">{fmtDoc(destinatarioDoc)}</div>
              </div>
              <div>
                <div className="field-label">Data de Emissão</div>
                <div className="field-value">{fmtDate(dataEmissaoDanfe)}</div>
              </div>
              <div>
                <div className="field-label">Endereço</div>
                <div className="field-value">{destinatarioEndereco}</div>
              </div>
              <div>
                <div className="field-label">Município / UF</div>
                <div className="field-value">{destinatarioCidadeUf ?? "-"}</div>
              </div>
              <div>
                <div className="field-label">CEP</div>
                <div className="field-value">{destinatarioCep}</div>
              </div>
            </div>
          </div>

          <div className="border-box" style={{ padding: "2px 3px", marginBottom: "2mm" }}>
            <div className="block-title">CÁLCULO DO IMPOSTO</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                columnGap: "2mm",
                marginTop: 2,
              }}
            >
              <div>
                <div className="field-label">Base de Cálculo do ICMS</div>
                <div className="field-value">{fmtMoney(totalBcIcms)}</div>
              </div>
              <div>
                <div className="field-label">Valor do ICMS</div>
                <div className="field-value">{fmtMoney(totalIcms)}</div>
              </div>
              <div>
                <div className="field-label">Base de Cálculo do ICMS ST</div>
                <div className="field-value">{fmtMoney(0)}</div>
              </div>
              <div>
                <div className="field-label">Valor do ICMS ST</div>
                <div className="field-value">{fmtMoney(0)}</div>
              </div>
              <div>
                <div className="field-label">Valor Total dos Produtos</div>
                <div className="field-value">{fmtMoney(totalProdutos)}</div>
              </div>
              <div>
                <div className="field-label">Valor Total da Nota</div>
                <div className="field-value">{fmtMoney(totalNota)}</div>
              </div>
            </div>
          </div>

          <div className="border-box" style={{ padding: "2px 3px", marginBottom: "2mm" }}>
            <div className="block-title">TRANSPORTADOR / VOLUMES TRANSPORTADOS</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "3fr 1fr 1.5fr 1fr 1.5fr",
                columnGap: "2mm",
                rowGap: "1mm",
                marginTop: 2,
              }}
            >
              <div>
                <div className="field-label">Nome / Razão Social</div>
                <div className="field-value">-</div>
              </div>
              <div>
                <div className="field-label">Frete por conta</div>
                <div className="field-value">9 - Sem Ocorrência</div>
              </div>
              <div>
                <div className="field-label">CNPJ/CPF</div>
                <div className="field-value">-</div>
              </div>
              <div>
                <div className="field-label">Placa do Veículo</div>
                <div className="field-value">-</div>
              </div>
              <div>
                <div className="field-label">UF</div>
                <div className="field-value">-</div>
              </div>
            </div>
          </div>

          <div className="border-box" style={{ padding: "2px 1px", marginBottom: "2mm" }}>
            <div className="block-title">DADOS DOS PRODUTOS / SERVIÇOS</div>
            <div style={{ marginTop: 2 }}>
              {itensDisplay.length === 0 ? (
                <div className="small-text">Nenhum item cadastrado para esta NF-e.</div>
              ) : (
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Cód. Produto</th>
                      <th>Descrição do Produto / Serviço</th>
                      <th>NCM</th>
                      <th>CST/CSOSN</th>
                      <th>CFOP</th>
                      <th>UN</th>
                      <th>Qtde</th>
                      <th>Valor Unitário</th>
                      <th>Valor Total</th>
                      <th>BC ICMS</th>
                      <th>Alíquota ICMS</th>
                      <th>Valor ICMS</th>
                      <th>CST PIS</th>
                      <th>Valor PIS</th>
                      <th>CST COFINS</th>
                      <th>Valor COFINS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensDisplay.map((item) => (
                      <tr key={item.id}>
                        <td className="center">{item.n_item}</td>
                        <td className="center">{item.produtoid ?? "-"}</td>
                        <td className="desc">{item.descricao}</td>
                        <td className="center">{item.ncm ?? "-"}</td>
                        <td className="center">{item.csosn ?? "-"}</td>
                        <td className="center">{item.cfop}</td>
                        <td className="center">{item.unidade}</td>
                        <td className="right">
                          {Number(item.quantidade ?? 0).toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="right">{fmtMoney(item.valor_unitario)}</td>
                        <td className="right">{fmtMoney(item.valor_total)}</td>
                        <td className="right">{fmtMoney(item.valor_bc_icms)}</td>
                        <td className="right">{fmtPercent(item.aliquotaicms)}</td>
                        <td className="right">{fmtMoney(item.valor_icms)}</td>
                        <td className="center">{item.cst_pis ?? "-"}</td>
                        <td className="right">{fmtMoney(item.valor_pis)}</td>
                        <td className="center">{item.cst_cofins ?? "-"}</td>
                        <td className="right">{fmtMoney(item.valor_cofins)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 2fr 1.2fr",
              columnGap: "2mm",
            }}
          >
            <div className="border-box" style={{ padding: "2px 3px" }}>
              <div className="block-title">CÁLCULO DO ISSQN</div>
              <div style={{ marginTop: 2 }}>
                <div className="small-text">Inscrição Municipal: -</div>
                <div className="small-text">Valor Total dos Serviços: {fmtMoney(nfe.total_servicos)}</div>
                <div className="small-text">Base de Cálculo do ISSQN: {fmtMoney(0)}</div>
                <div className="small-text">Valor do ISSQN: {fmtMoney(0)}</div>
              </div>
            </div>

            <div className="border-box" style={{ padding: "2px 3px" }}>
              <div className="block-title">INFORMAÇÕES COMPLEMENTARES</div>
              {infCpl && (
                <div className="small-text" style={{ marginTop: 2, fontWeight: 600 }}>
                  {infCpl}
                </div>
              )}
              <div className="small-text" style={{ marginTop: 2 }}>
                Versão de visualização do DANFE gerada pelo sistema. Para fins fiscais, prevalece o XML da NF-e
                autorizado pela SEFAZ.
              </div>
              {!xmlBaseAvailable && (
                <div className="small-text" style={{ marginTop: 2 }}>
                  ** Atenção: XML da NF-e não está armazenado nesta NF-e. Visualização baseada apenas nos dados do
                  banco.
                </div>
              )}
            </div>

            <div className="border-box" style={{ padding: "2px 3px" }}>
              <div className="block-title">RESERVADO AO FISCO</div>
              <div className="small-text" style={{ marginTop: 2 }} />
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
