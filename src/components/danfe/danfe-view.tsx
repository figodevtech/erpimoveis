"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { encodeCode128C } from "@/lib/nfe/code128";
import type {
  DanfeItem,
  DanfeTaxTotals,
  DanfeTransport,
  ParsedDanfeNFe,
} from "@/lib/nfe/danfeParser";

export type DanfeItemDisplay = DanfeItem;

export type DanfeViewData = {
  nfe: {
    numero: number;
    serie: number;
    ordemservicoid?: number | null;
    protocolo?: string | null;
    dataautorizacao?: string | null;
  };
  emitenteNome: string;
  emitenteEndereco: string;
  emitenteCnpj: string;
  emitenteIe?: string | null;
  emitenteIest?: string | null;
  emitenteIm?: string | null;
  emitenteTelefone?: string | null;
  destinatarioNome: string;
  destinatarioDoc: string;
  destinatarioEndereco: string;
  destinatarioCidadeUf?: string | null;
  destinatarioCep?: string | null;
  destinatarioIe?: string | null;
  dataEmissaoDanfe?: string | Date | null;
  dataSaidaEntrada?: string | Date | null;
  tipoOperacao: string;
  naturezaOperacao: string;
  ambiente: string;
  tipoEmissao: string;
  statusUpper: string;
  statusLabel: string;
  chaveAcesso: string;
  chaveFormatada: string;
  isAutorizada: boolean;
  xmlError?: string | null;
  xmlBaseAvailable: boolean;
  itensDisplay: DanfeItemDisplay[];
  totais: DanfeTaxTotals;
  transporte: DanfeTransport;
  fatura: ParsedDanfeNFe["fatura"];
  duplicatas: ParsedDanfeNFe["duplicatas"];
  pagamentos: ParsedDanfeNFe["pagamentos"];
  infCpl?: string | null;
  infAdFisco?: string | null;
};

const FRETE_LABEL: Record<string, string> = {
  "0": "0 - Emitente",
  "1": "1 - Destinatário",
  "2": "2 - Terceiros",
  "3": "3 - Próprio/emitente",
  "4": "4 - Próprio/destinatário",
  "9": "9 - Sem transporte",
};

const PAGAMENTO_LABEL: Record<string, string> = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de crédito",
  "04": "Cartão de débito",
  "05": "Crédito loja",
  "10": "Vale alimentação",
  "11": "Vale refeição",
  "12": "Vale presente",
  "13": "Vale combustível",
  "14": "Duplicata mercantil",
  "15": "Boleto bancário",
  "16": "Depósito bancário",
  "17": "PIX",
  "18": "Transferência/carteira digital",
  "19": "Fidelidade/cashback/crédito virtual",
  "90": "Sem pagamento",
  "99": "Outros",
};

function fmtDate(value?: string | Date | null) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function fmtDateOnly(value?: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function fmtMoney(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "-";
}

function fmtDecimal(value: number | string | null | undefined, digits = 4) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: digits })
    : "-";
}

function fmtDoc(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return digits || "-";
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
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

type PdfImage = { bytes: Uint8Array; width: number; height: number };

function buildImagePdf(images: PdfImage[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let offset = 0;
  const pushString = (value: string) => {
    const bytes = encoder.encode(value);
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const addObject = (number: number, parts: Array<string | Uint8Array>) => {
    offsets[number] = offset;
    pushString(`${number} 0 obj\n`);
    parts.forEach((part) => (typeof part === "string" ? pushString(part) : pushBytes(part)));
    pushString("\nendobj\n");
  };

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const pageObjects = images.map((_, index) => 3 + index * 3);
  pushString("%PDF-1.4\n");
  addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  addObject(2, [`<< /Type /Pages /Kids [${pageObjects.map((number) => `${number} 0 R`).join(" ")}] /Count ${images.length} >>`]);

  images.forEach((image, index) => {
    const pageObject = pageObjects[index];
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const imageName = `Im${index}`;
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ`;
    addObject(pageObject, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`]);
    addObject(contentObject, [`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`]);
    addObject(imageObject, [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      image.bytes,
      "\nendstream",
    ]);
  });

  const objectCount = 2 + images.length * 3;
  const xrefOffset = offset;
  pushString(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let number = 1; number <= objectCount; number += 1) {
    pushString(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  pushString(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const pdfBytes = new Uint8Array(offset);
  let cursor = 0;
  chunks.forEach((chunk) => {
    pdfBytes.set(chunk, cursor);
    cursor += chunk.length;
  });
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

function Code128Barcode({ value }: { value: string }) {
  const encoded = encodeCode128C(value);
  if (!encoded || encoded.digits.length !== 44) {
    return <div className="barcode-error">Chave inválida para código de barras</div>;
  }
  return (
    <svg className="barcode" viewBox={`0 0 ${encoded.width} 48`} preserveAspectRatio="none" role="img" aria-label={`Código de barras da chave ${value}`}>
      <rect width={encoded.width} height="48" fill="#fff" />
      {encoded.bars.map((bar, index) => <rect key={`${bar.x}-${index}`} x={bar.x} y="1" width={bar.width} height="46" fill="#000" />)}
    </svg>
  );
}

function itemUnits(item: DanfeItemDisplay) {
  const fiscalLength = [item.cst_pis, item.cst_cofins, item.cst_ibs_cbs, item.classificacao_tributaria].filter(Boolean).length * 10;
  return Math.max(1, Math.ceil((item.descricao.length + fiscalLength) / 70));
}

export function paginateDanfeItems(items: DanfeItemDisplay[]) {
  const pages: DanfeItemDisplay[][] = [];
  let current: DanfeItemDisplay[] = [];
  let units = 0;
  let capacity = 11;
  for (const item of items) {
    const nextUnits = itemUnits(item);
    if (current.length && units + nextUnits > capacity) {
      pages.push(current);
      current = [];
      units = 0;
      capacity = 22;
    }
    current.push(item);
    units += nextUnits;
  }
  if (current.length || pages.length === 0) pages.push(current);
  return pages;
}

function DefaultActions({ exitHref, filename }: { exitHref: string; filename: string }) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  async function handleDownloadPdf() {
    if (isGeneratingPdf) return;
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(".danfe-sheet"));
    if (!sheets.length) return toast.error("Não foi possível localizar o DANFE para baixar.");
    setIsGeneratingPdf(true);
    try {
      await document.fonts?.ready;
      const { toJpeg } = await import("html-to-image");
      const images: PdfImage[] = [];
      for (const sheet of sheets) {
        const dataUrl = await toJpeg(sheet, { backgroundColor: "#fff", cacheBust: true, pixelRatio: 2, quality: 0.98 });
        const size = await readImageSize(dataUrl);
        images.push({ bytes: dataUrlToBytes(dataUrl), ...size });
      }
      downloadBlob(buildImagePdf(images), filename);
    } catch (error) {
      console.error("Erro ao gerar PDF do DANFE:", error);
      toast.error("Não foi possível baixar o DANFE em PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }
  return <>
    <Link href={exitHref} className="exit-link">Sair</Link>
    <Button type="button" variant="outline" size="sm" onClick={() => void handleDownloadPdf()} disabled={isGeneratingPdf}>
      {isGeneratingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      {isGeneratingPdf ? "Gerando PDF..." : "Baixar PDF"}
    </Button>
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
  </>;
}

function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`cell ${className}`}><div className="field-label">{label}</div><div className="field-value">{children || "-"}</div></div>;
}

function StatusWarning({ data }: { data: DanfeViewData }) {
  if (data.ambiente === "2") return <div className="fiscal-warning">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL</div>;
  if (!data.isAutorizada) return <div className="fiscal-warning">SEM VALOR FISCAL — {data.statusLabel || data.statusUpper || "NÃO AUTORIZADA"}</div>;
  if (data.tipoEmissao && data.tipoEmissao !== "1") return <div className="fiscal-warning">EMISSÃO EM CONTINGÊNCIA — TIPO {data.tipoEmissao}</div>;
  return null;
}

function Header({ data, page, totalPages }: { data: DanfeViewData; page: number; totalPages: number }) {
  return <>
    <StatusWarning data={data} />
    <div className="header-grid box">
      <div className="issuer">
        <div className="block-title">Identificação do emitente</div>
        <strong>{data.emitenteNome}</strong>
        <div>{data.emitenteEndereco}</div>
        <div>CNPJ: {fmtDoc(data.emitenteCnpj)} · IE: {data.emitenteIe || "-"}</div>
        {data.emitenteTelefone && <div>Fone: {data.emitenteTelefone}</div>}
      </div>
      <div className="danfe-title">
        <b>DANFE</b>
        <span>Documento Auxiliar da Nota Fiscal Eletrônica</span>
        <span><strong>{data.tipoOperacao === "ENTRADA" ? "0 - ENTRADA" : "1 - SAÍDA"}</strong></span>
        <span>Nº <strong>{String(data.nfe.numero).padStart(9, "0")}</strong> · SÉRIE <strong>{String(data.nfe.serie).padStart(3, "0")}</strong></span>
        <span>FOLHA <strong>{page}/{totalPages}</strong></span>
      </div>
      <div className="access-key">
        <Code128Barcode value={data.chaveAcesso} />
        <div className="field-label center">Chave de acesso</div>
        <div className="key center">{data.chaveFormatada}</div>
        <div className="tiny">Consulta de autenticidade no Portal Nacional da NF-e (www.nfe.fazenda.gov.br/portal) ou no site da Sefaz autorizadora.</div>
      </div>
    </div>
    <div className="ide-grid box">
      <Cell label="Natureza da operação">{data.naturezaOperacao}</Cell>
      <Cell label="Protocolo de autorização de uso">{data.nfe.protocolo ? `${data.nfe.protocolo} - ${fmtDate(data.nfe.dataautorizacao)}` : "-"}</Cell>
      <Cell label="Inscrição estadual">{data.emitenteIe || "-"}</Cell>
      <Cell label="Inscrição estadual do substituto tributário">{data.emitenteIest || "-"}</Cell>
      <Cell label="CNPJ">{fmtDoc(data.emitenteCnpj)}</Cell>
    </div>
  </>;
}

function ItemsTable({ items, showRtc }: { items: DanfeItemDisplay[]; showRtc: boolean }) {
  return <div className="box items-block">
    <div className="block-title section-title">Dados dos produtos / serviços</div>
    <table className="items-table">
      <thead><tr>
        <th>Cód.</th><th className="description">Descrição</th><th>NCM/SH</th><th>CST</th><th>CFOP</th><th>UN</th><th>Qtd.</th><th>V. unit.</th><th>V. total</th><th>BC ICMS</th><th>V. ICMS</th><th>V. IPI</th><th>% ICMS</th><th>% IPI</th>
      </tr></thead>
      <tbody>{items.length ? items.map((item) => <tr key={item.id}>
        <td>{item.produtoid || "-"}</td>
        <td className="description"><strong>{item.descricao}</strong><span className="tax-detail">PIS {item.cst_pis || "-"} ({fmtDecimal(item.aliquota_pis, 2)}%): {fmtMoney(item.valor_pis)} · COFINS {item.cst_cofins || "-"} ({fmtDecimal(item.aliquota_cofins, 2)}%): {fmtMoney(item.valor_cofins)}{item.cest ? ` · CEST ${item.cest}` : ""}</span></td>
        <td>{item.ncm || "-"}</td><td>{`${item.origem || ""}${item.csosn || ""}` || "-"}</td><td>{item.cfop}</td><td>{item.unidade}</td>
        <td className="number">{fmtDecimal(item.quantidade)}</td><td className="number">{fmtMoney(item.valor_unitario)}</td><td className="number">{fmtMoney(item.valor_total)}</td>
        <td className="number">{fmtMoney(item.valor_bc_icms)}</td><td className="number">{fmtMoney(item.valor_icms)}</td><td className="number">{fmtMoney(item.valor_ipi)}</td>
        <td className="number">{fmtDecimal(item.aliquotaicms, 2)}</td><td className="number">{fmtDecimal(item.aliquota_ipi, 2)}</td>
      </tr>) : <tr><td colSpan={14}>Nenhum item localizado.</td></tr>}</tbody>
    </table>
    {showRtc && <table className="items-table rtc-table">
      <thead><tr><th>Item</th><th>CST IBS/CBS</th><th>Classificação tributária</th><th>BC IBS/CBS</th><th>% IBS UF</th><th>V. IBS UF</th><th>% IBS Mun.</th><th>V. IBS Mun.</th><th>V. IBS</th><th>% CBS</th><th>V. CBS</th><th>CST IS</th><th>V. IS</th></tr></thead>
      <tbody>{items.map((item) => <tr key={`rtc-${item.id}`}><td>{item.n_item}</td><td>{item.cst_ibs_cbs || "-"}</td><td>{item.classificacao_tributaria || "-"}</td><td className="number">{fmtMoney(item.base_ibs_cbs)}</td><td>{fmtDecimal(item.aliquota_ibs_uf, 2)}</td><td>{fmtMoney(item.valor_ibs_uf)}</td><td>{fmtDecimal(item.aliquota_ibs_municipio, 2)}</td><td>{fmtMoney(item.valor_ibs_municipio)}</td><td>{fmtMoney(item.valor_ibs)}</td><td>{fmtDecimal(item.aliquota_cbs, 2)}</td><td>{fmtMoney(item.valor_cbs)}</td><td>{item.cst_is || "-"}</td><td>{fmtMoney(item.valor_is)}</td></tr>)}</tbody>
    </table>}
  </div>;
}

function FirstPageDetails({ data }: { data: DanfeViewData }) {
  const totals = data.totais;
  const volume = data.transporte.volumes[0];
  const hasRtc = totals.vBCIBSCBS || totals.vIBS || totals.vCBS || totals.vIS;
  return <>
    <div className="recipient-grid box">
      <Cell label="Nome / Razão social">{data.destinatarioNome}</Cell><Cell label="CNPJ / CPF">{fmtDoc(data.destinatarioDoc)}</Cell><Cell label="Data de emissão">{fmtDate(data.dataEmissaoDanfe)}</Cell>
      <Cell label="Endereço">{data.destinatarioEndereco}</Cell><Cell label="Município / UF">{data.destinatarioCidadeUf || "-"}</Cell><Cell label="CEP">{data.destinatarioCep || "-"}</Cell>
      <Cell label="Inscrição estadual">{data.destinatarioIe || "-"}</Cell><Cell label="Data de saída / entrada">{fmtDate(data.dataSaidaEntrada)}</Cell>
    </div>
    <div className="block-title outside-title">Cálculo do imposto</div>
    <div className="totals-grid box">
      <Cell label="Base de cálculo do ICMS">{fmtMoney(totals.vBC)}</Cell><Cell label="Valor do ICMS">{fmtMoney(totals.vICMS)}</Cell><Cell label="Valor ICMS desonerado">{fmtMoney(totals.vICMSDeson)}</Cell><Cell label="Valor do FCP">{fmtMoney(totals.vFCP)}</Cell><Cell label="BC ICMS ST">{fmtMoney(totals.vBCST)}</Cell><Cell label="Valor ICMS ST">{fmtMoney(totals.vST)}</Cell><Cell label="Total dos produtos">{fmtMoney(totals.vProd)}</Cell>
      <Cell label="Valor do frete">{fmtMoney(totals.vFrete)}</Cell><Cell label="Valor do seguro">{fmtMoney(totals.vSeg)}</Cell><Cell label="Desconto">{fmtMoney(totals.vDesc)}</Cell><Cell label="Outras despesas">{fmtMoney(totals.vOutro)}</Cell><Cell label="Valor do II">{fmtMoney(totals.vII)}</Cell><Cell label="Valor do IPI">{fmtMoney(totals.vIPI)}</Cell><Cell label="Valor total da nota">{fmtMoney(totals.vNF)}</Cell>
    </div>
    <div className="other-totals box">
      <Cell label="Valor do PIS">{fmtMoney(totals.vPIS)}</Cell><Cell label="Valor da COFINS">{fmtMoney(totals.vCOFINS)}</Cell><Cell label="FCP ST">{fmtMoney(totals.vFCPST)}</Cell><Cell label="FCP ST retido">{fmtMoney(totals.vFCPSTRet)}</Cell><Cell label="IPI devolvido">{fmtMoney(totals.vIPIDevol)}</Cell><Cell label="Tributos aproximados">{fmtMoney(totals.vTotTrib)}</Cell>
    </div>
    {hasRtc ? <><div className="block-title outside-title">Reforma tributária (IBS / CBS / IS)</div><div className="rtc-totals box"><Cell label="BC IBS/CBS">{fmtMoney(totals.vBCIBSCBS)}</Cell><Cell label="IBS UF">{fmtMoney(totals.vIBSUF)}</Cell><Cell label="IBS Município">{fmtMoney(totals.vIBSMun)}</Cell><Cell label="Total IBS">{fmtMoney(totals.vIBS)}</Cell><Cell label="Total CBS">{fmtMoney(totals.vCBS)}</Cell><Cell label="Imposto seletivo">{fmtMoney(totals.vIS)}</Cell></div></> : null}
    <div className="block-title outside-title">Transportador / volumes transportados</div>
    <div className="transport-grid box">
      <Cell label="Nome / Razão social">{data.transporte.nome || "-"}</Cell><Cell label="Frete por conta">{FRETE_LABEL[data.transporte.modFrete] || data.transporte.modFrete}</Cell><Cell label="CNPJ / CPF">{fmtDoc(data.transporte.documento)}</Cell><Cell label="Placa">{data.transporte.placa || "-"}</Cell><Cell label="UF">{data.transporte.ufVeiculo || "-"}</Cell><Cell label="RNTC">{data.transporte.rntc || "-"}</Cell>
      <Cell label="Endereço">{data.transporte.endereco || "-"}</Cell><Cell label="Município">{data.transporte.municipio || "-"}</Cell><Cell label="UF">{data.transporte.uf || "-"}</Cell><Cell label="Quantidade">{volume ? fmtDecimal(data.transporte.volumes.reduce((sum, item) => sum + item.quantidade, 0)) : "-"}</Cell><Cell label="Espécie / Marca / Numeração">{volume ? [volume.especie, volume.marca, volume.numeracao].filter(Boolean).join(" / ") : "-"}</Cell><Cell label="Peso líquido / bruto">{volume ? `${fmtDecimal(data.transporte.volumes.reduce((sum, item) => sum + item.pesoLiquido, 0), 3)} / ${fmtDecimal(data.transporte.volumes.reduce((sum, item) => sum + item.pesoBruto, 0), 3)}` : "-"}</Cell>
    </div>
  </>;
}

function FooterDetails({ data }: { data: DanfeViewData }) {
  const hasIssqn = data.totais.vServ !== 0 || data.totais.vBCISS !== 0 || data.totais.vISS !== 0;
  const hasBilling = data.fatura || data.duplicatas.length > 0;
  return <>
    {hasBilling && <><div className="block-title outside-title">Fatura / duplicatas</div><div className="billing box">
      {data.fatura && <Cell label={`Fatura ${data.fatura.numero || ""}`}>Original {fmtMoney(data.fatura.valorOriginal)} · Desconto {fmtMoney(data.fatura.desconto)} · Líquido {fmtMoney(data.fatura.valorLiquido)}</Cell>}
      {data.duplicatas.map((dup, index) => <Cell key={`${dup.numero}-${index}`} label={`Duplicata ${dup.numero || index + 1}`}>{fmtDateOnly(dup.vencimento)} · {fmtMoney(dup.valor)}</Cell>)}
    </div></>}
    {data.pagamentos.length > 0 && <><div className="block-title outside-title">Pagamento</div><div className="payments box">{data.pagamentos.map((payment, index) => <Cell key={`${payment.tipo}-${index}`} label={payment.descricao || PAGAMENTO_LABEL[payment.tipo] || `Meio ${payment.tipo}`}>{fmtMoney(payment.valor)}{payment.bandeira ? ` · Bandeira ${payment.bandeira}` : ""}{payment.cnpjCredenciadora ? ` · Credenciadora ${fmtDoc(payment.cnpjCredenciadora)}` : ""}{payment.autorizacao ? ` · Aut. ${payment.autorizacao}` : ""}</Cell>)}</div></>}
    {hasIssqn && <><div className="block-title outside-title">Cálculo do ISSQN</div><div className="issqn box"><Cell label="Inscrição municipal">{data.emitenteIm || "-"}</Cell><Cell label="Valor total dos serviços">{fmtMoney(data.totais.vServ)}</Cell><Cell label="Base de cálculo do ISSQN">{fmtMoney(data.totais.vBCISS)}</Cell><Cell label="Valor do ISSQN">{fmtMoney(data.totais.vISS)}</Cell></div></>}
    <div className="footer-grid">
      <div className="box footer-box"><div className="block-title">Informações complementares</div><div>{data.infCpl || "-"}</div>{data.xmlError && <div className="fallback-warning">Falha ao ler o XML: visualização complementada com dados do banco.</div>}{!data.xmlBaseAvailable && <div className="fallback-warning">XML não armazenado: esta visualização não substitui um DANFE originado do XML autorizado.</div>}</div>
      <div className="box footer-box"><div className="block-title">Reservado ao fisco</div><div>{data.infAdFisco || ""}</div></div>
    </div>
  </>;
}

export function DanfeView({ data, exitHref = "/fiscal", actions, showActions = true }: { data: DanfeViewData; exitHref?: string; actions?: ReactNode; showActions?: boolean }) {
  const pages = paginateDanfeItems(data.itensDisplay);
  const showRtc = data.itensDisplay.some((item) => item.cst_ibs_cbs || item.cst_is);
  const filename = `danfe-nfe-${String(data.nfe.numero).padStart(9, "0")}.pdf`;
  return <>
    <style>{DANFE_STYLES}</style>
    <div className="danfe-page"><div className="danfe-scroll">
      {showActions && <div className="actions">{actions ?? <DefaultActions exitHref={exitHref} filename={filename} />}</div>}
      <div className="danfe-wrapper">
        {pages.map((items, index) => <section className="danfe-sheet" key={index}>
          {index === 0 && <div className="receipt box"><div><b>RECEBEMOS DE {data.emitenteNome} OS PRODUTOS/SERVIÇOS CONSTANTES DA NF-e INDICADA AO LADO</b><div>DATA DE RECEBIMENTO: ____________________ &nbsp; IDENTIFICAÇÃO E ASSINATURA: __________________________________________</div></div><div>NF-e<br /><b>Nº {String(data.nfe.numero).padStart(9, "0")}</b><br />SÉRIE {String(data.nfe.serie).padStart(3, "0")}</div></div>}
          <Header data={data} page={index + 1} totalPages={pages.length} />
          {index === 0 && <FirstPageDetails data={data} />}
          <ItemsTable items={items} showRtc={showRtc} />
          {index === pages.length - 1 && <FooterDetails data={data} />}
        </section>)}
      </div>
    </div></div>
  </>;
}

const DANFE_STYLES = `
  @page { size: A4; margin: 0; }
  .danfe-page { font-family: Arial, Helvetica, sans-serif; font-size: 7px; color:#000; background:#f3f4f6; min-height:100vh; padding:16px 0; overflow:auto; }
  .danfe-scroll { width:max-content; min-width:210mm; margin:0 auto; }
  .danfe-wrapper { display:flex; flex-direction:column; gap:12px; }
  .danfe-sheet { position:relative; width:210mm; min-width:210mm; min-height:297mm; padding:5mm; box-sizing:border-box; background:#fff; border:1px solid #aaa; break-after:page; page-break-after:always; }
  .danfe-sheet:last-child { break-after:auto; page-break-after:auto; }
  .actions { display:flex; gap:8px; justify-content:flex-end; align-items:center; width:210mm; margin-bottom:8px; }
  .exit-link { display:inline-flex; height:32px; align-items:center; padding:0 12px; border:1px solid #ddd; border-radius:6px; background:#fff; color:#111827; font:500 14px system-ui; text-decoration:none; }
  .box { border:1px solid #000; box-sizing:border-box; }
  .receipt { display:grid; grid-template-columns:1fr 30mm; margin-bottom:2mm; min-height:17mm; }
  .receipt>div { padding:2mm; }
  .receipt>div+div { border-left:1px solid #000; text-align:center; font-size:9px; }
  .header-grid { display:grid; grid-template-columns:67mm 34mm 1fr; min-height:40mm; }
  .header-grid>div { padding:1.5mm; }
  .header-grid>div+div { border-left:1px solid #000; }
  .issuer { font-size:8px; line-height:1.35; }
  .issuer>strong { display:block; font-size:11px; margin:2mm 0 1mm; text-align:center; }
  .danfe-title { display:flex; flex-direction:column; align-items:center; text-align:center; gap:1mm; }
  .danfe-title>b { font-size:18px; }
  .danfe-title>span:first-of-type { font-size:8px; font-weight:700; }
  .access-key { overflow:hidden; }
  .barcode { display:block; width:100%; height:13mm; margin-bottom:1mm; }
  .barcode-error { height:13mm; display:flex; align-items:center; justify-content:center; border:1px dashed #000; font-weight:700; }
  .key { font:700 8px 'Courier New', monospace; letter-spacing:.4px; white-space:nowrap; }
  .tiny { font-size:6px; line-height:1.2; margin-top:1mm; }
  .center { text-align:center; }
  .field-label,.block-title { font-size:6px; font-weight:700; text-transform:uppercase; }
  .field-value { margin-top:.7mm; font-size:7px; min-height:3mm; overflow-wrap:anywhere; }
  .cell { min-width:0; padding:1mm; }
  .ide-grid { display:grid; grid-template-columns:2fr 2fr 1fr 1.25fr 1.35fr; margin-top:1mm; }
  .ide-grid>.cell+.cell,.recipient-grid>.cell:not(:nth-child(3n+1)),.totals-grid>.cell:not(:nth-child(7n+1)),.other-totals>.cell+.cell,.rtc-totals>.cell+.cell,.transport-grid>.cell:not(:nth-child(6n+1)),.issqn>.cell+.cell { border-left:1px solid #000; }
  .recipient-grid { display:grid; grid-template-columns:2.2fr 1fr 1fr; margin-top:1mm; }
  .recipient-grid>.cell:nth-child(n+4) { border-top:1px solid #000; }
  .outside-title { margin:1.5mm 0 .5mm; }
  .totals-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); }
  .totals-grid>.cell:nth-child(n+8) { border-top:1px solid #000; }
  .other-totals { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); border-top:0; }
  .rtc-totals { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); }
  .transport-grid { display:grid; grid-template-columns:2fr 1.3fr 1.3fr .8fr .6fr .8fr; }
  .transport-grid>.cell:nth-child(n+7) { border-top:1px solid #000; }
  .items-block { margin-top:1.5mm; }
  .section-title { padding:1mm; border-bottom:1px solid #000; }
  .items-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:5.8px; }
  .items-table th,.items-table td { border-right:1px solid #000; border-bottom:1px solid #000; padding:.7mm .5mm; vertical-align:top; overflow-wrap:anywhere; }
  .items-table th:last-child,.items-table td:last-child { border-right:0; }
  .items-table tr:last-child td { border-bottom:0; }
  .items-table th { text-transform:uppercase; font-size:5.2px; }
  .items-table .description { width:25%; text-align:left; }
  .items-table .number { text-align:right; white-space:nowrap; }
  .tax-detail { display:block; font-size:5px; margin-top:.5mm; font-weight:400; }
  .rtc-table { border-top:1px solid #000; font-size:5.2px; }
  .billing,.payments { display:flex; flex-wrap:wrap; }
  .billing>.cell,.payments>.cell { flex:1 1 35mm; border-right:1px solid #000; }
  .issqn { display:grid; grid-template-columns:repeat(4,1fr); }
  .footer-grid { display:grid; grid-template-columns:2fr 1fr; gap:1mm; margin-top:1.5mm; }
  .footer-box { min-height:22mm; padding:1.5mm; white-space:pre-wrap; overflow-wrap:anywhere; }
  .fallback-warning { margin-top:1mm; font-weight:700; }
  .fiscal-warning { border:2px solid #000; padding:1mm; margin-bottom:1mm; text-align:center; font-size:9px; font-weight:800; }
  @media(max-width:767px){ .danfe-scroll{margin:0;padding:0 12px}.actions{position:sticky;left:12px;z-index:3;width:calc(100vw - 24px);justify-content:flex-start}.danfe-page{padding:12px 0} }
  @media print { .danfe-page{background:#fff;padding:0;overflow:visible}.danfe-scroll{width:auto;min-width:0;margin:0}.actions{display:none}.danfe-wrapper{display:block;gap:0}.danfe-sheet{border:0;margin:0;width:210mm;min-width:210mm;height:297mm;min-height:297mm} }
`;
