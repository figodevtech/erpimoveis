"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { encodeCode128C } from "@/lib/nfe/code128";
import {
  aumentarFonteDanfe,
  DANFE_DEFAULT_FONT_SCALE,
  DANFE_MAX_FONT_SCALE,
  diminuirFonteDanfe,
  percentualFonteDanfe,
  type DanfeFontScale,
} from "@/lib/nfe/danfeFontScale";
import {
  lerEscalaFonteImpressao,
  PRINT_FONT_SCALE_STORAGE_KEY,
} from "@/lib/print/fontScale";
import type {
  DanfeEntrega,
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
  entrega?: DanfeEntrega | null;
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
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 15_000);
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

function DefaultActions({
  data,
  exitHref,
  filename,
  fontScale,
  onFontScaleChange,
}: {
  data: DanfeViewData;
  exitHref: string;
  filename: string;
  fontScale: DanfeFontScale;
  onFontScaleChange: Dispatch<SetStateAction<DanfeFontScale>>;
}) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  async function handleDownloadPdf() {
    if (isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    try {
      const { gerarDanfePdf } = await import("@/lib/nfe/danfePdf");
      const pdf = await gerarDanfePdf(data, { fontScale });
      const bytes = new Uint8Array(pdf.byteLength);
      bytes.set(pdf);
      downloadBlob(new Blob([bytes.buffer], { type: "application/pdf" }), filename);
    } catch (error) {
      console.error("Erro ao gerar PDF do DANFE:", error);
      toast.error("Não foi possível baixar o DANFE em PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }
  return <>
    <Link href={exitHref} className="exit-link">Sair</Link>
    <div aria-label="Tamanho do texto do DANFE" className="font-size-control" role="group">
      <Button
        aria-label="Diminuir texto do DANFE"
        disabled={fontScale === DANFE_DEFAULT_FONT_SCALE}
        onClick={() => onFontScaleChange((current) => diminuirFonteDanfe(current))}
        size="sm"
        title="Diminuir texto"
        type="button"
        variant="outline"
      >
        <span aria-hidden="true" className="font-size-symbol">A−</span>
      </Button>
      <span aria-live="polite" className="font-size-value">Texto {percentualFonteDanfe(fontScale)}%</span>
      <Button
        aria-label="Aumentar texto do DANFE"
        disabled={fontScale === DANFE_MAX_FONT_SCALE}
        onClick={() => onFontScaleChange((current) => aumentarFonteDanfe(current))}
        size="sm"
        title={fontScale === DANFE_MAX_FONT_SCALE ? "Tamanho máximo atingido" : "Aumentar texto"}
        type="button"
        variant="outline"
      >
        <span aria-hidden="true" className="font-size-symbol">A+</span>
      </Button>
    </div>
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
        <span>FOLHA <strong data-danfe-page-current>{page}</strong>/<strong data-danfe-page-total>{totalPages}</strong></span>
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
  return <div className="box items-block" data-danfe-items-block>
    <div className="block-title section-title">Dados dos produtos / serviços</div>
    <table className="items-table" data-danfe-main-table>
      <thead><tr>
        <th>Cód.</th><th className="description">Descrição</th><th>NCM/SH</th><th>CST</th><th>CFOP</th><th>UN</th><th>Qtd.</th><th>V. unit.</th><th>V. total</th><th>BC ICMS</th><th>V. ICMS</th><th>V. IPI</th><th>% ICMS</th><th>% IPI</th>
      </tr></thead>
      <tbody>{items.length ? items.map((item, index) => <tr data-danfe-item-index={index} key={item.id}>
        <td>{item.produtoid || "-"}</td>
        <td className="description"><strong>{item.descricao}</strong><span className="tax-detail">PIS {item.cst_pis || "-"} ({fmtDecimal(item.aliquota_pis, 2)}%): {fmtMoney(item.valor_pis)} · COFINS {item.cst_cofins || "-"} ({fmtDecimal(item.aliquota_cofins, 2)}%): {fmtMoney(item.valor_cofins)}{item.cest ? ` · CEST ${item.cest}` : ""}</span></td>
        <td>{item.ncm || "-"}</td><td>{`${item.origem || ""}${item.csosn || ""}` || "-"}</td><td>{item.cfop}</td><td>{item.unidade}</td>
        <td className="number">{fmtDecimal(item.quantidade)}</td><td className="number">{fmtMoney(item.valor_unitario)}</td><td className="number">{fmtMoney(item.valor_total)}</td>
        <td className="number">{fmtMoney(item.valor_bc_icms)}</td><td className="number">{fmtMoney(item.valor_icms)}</td><td className="number">{fmtMoney(item.valor_ipi)}</td>
        <td className="number">{fmtDecimal(item.aliquotaicms, 2)}</td><td className="number">{fmtDecimal(item.aliquota_ipi, 2)}</td>
      </tr>) : <tr><td colSpan={14}>Nenhum item localizado.</td></tr>}</tbody>
    </table>
    {showRtc && <table className="items-table rtc-table" data-danfe-rtc-table>
      <thead><tr><th>Item</th><th>CST IBS/CBS</th><th>Classificação tributária</th><th>BC IBS/CBS</th><th>% IBS UF</th><th>V. IBS UF</th><th>% IBS Mun.</th><th>V. IBS Mun.</th><th>V. IBS</th><th>% CBS</th><th>V. CBS</th><th>CST IS</th><th>V. IS</th></tr></thead>
      <tbody>{items.map((item, index) => <tr data-danfe-item-index={index} key={`rtc-${item.id}`}><td>{item.n_item}</td><td>{item.cst_ibs_cbs || "-"}</td><td>{item.classificacao_tributaria || "-"}</td><td className="number">{fmtMoney(item.base_ibs_cbs)}</td><td>{fmtDecimal(item.aliquota_ibs_uf, 2)}</td><td>{fmtMoney(item.valor_ibs_uf)}</td><td>{fmtDecimal(item.aliquota_ibs_municipio, 2)}</td><td>{fmtMoney(item.valor_ibs_municipio)}</td><td>{fmtMoney(item.valor_ibs)}</td><td>{fmtDecimal(item.aliquota_cbs, 2)}</td><td>{fmtMoney(item.valor_cbs)}</td><td>{item.cst_is || "-"}</td><td>{fmtMoney(item.valor_is)}</td></tr>)}</tbody>
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
    {data.entrega && <>
      <div className="block-title outside-title">Local de entrega / retirada</div>
      <div className="recipient-grid box">
        <Cell label="Nome / Razão social">{data.entrega.nome || "-"}</Cell><Cell label="CNPJ / CPF">{fmtDoc(data.entrega.documento)}</Cell><Cell label="Município / UF">{[data.entrega.municipio, data.entrega.uf].filter(Boolean).join("/") || "-"}</Cell>
        <Cell label="Endereço">{[data.entrega.logradouro, data.entrega.numero].filter(Boolean).join(", ") || "-"}</Cell><Cell label="Bairro / Complemento">{[data.entrega.bairro, data.entrega.complemento].filter(Boolean).join(" - ") || "-"}</Cell><Cell label="CEP">{data.entrega.cep || "-"}</Cell>
      </div>
    </>}
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
  return <div className="footer-details" data-danfe-footer>
    {hasBilling && <div className="footer-segment" data-danfe-footer-segment><div className="block-title outside-title">Fatura / duplicatas</div><div className="billing box">
      {data.fatura && <Cell label={`Fatura ${data.fatura.numero || ""}`}>Original {fmtMoney(data.fatura.valorOriginal)} · Desconto {fmtMoney(data.fatura.desconto)} · Líquido {fmtMoney(data.fatura.valorLiquido)}</Cell>}
      {data.duplicatas.map((dup, index) => <Cell key={`${dup.numero}-${index}`} label={`Duplicata ${dup.numero || index + 1}`}>{fmtDateOnly(dup.vencimento)} · {fmtMoney(dup.valor)}</Cell>)}
    </div></div>}
    {data.pagamentos.length > 0 && <div className="footer-segment" data-danfe-footer-segment><div className="block-title outside-title">Pagamento</div><div className="payments box">{data.pagamentos.map((payment, index) => <Cell key={`${payment.tipo}-${index}`} label={payment.descricao || PAGAMENTO_LABEL[payment.tipo] || `Meio ${payment.tipo}`}>{fmtMoney(payment.valor)}{payment.bandeira ? ` · Bandeira ${payment.bandeira}` : ""}{payment.cnpjCredenciadora ? ` · Credenciadora ${fmtDoc(payment.cnpjCredenciadora)}` : ""}{payment.autorizacao ? ` · Aut. ${payment.autorizacao}` : ""}</Cell>)}</div></div>}
    {hasIssqn && <div className="footer-segment" data-danfe-footer-segment><div className="block-title outside-title">Cálculo do ISSQN</div><div className="issqn box"><Cell label="Inscrição municipal">{data.emitenteIm || "-"}</Cell><Cell label="Valor total dos serviços">{fmtMoney(data.totais.vServ)}</Cell><Cell label="Base de cálculo do ISSQN">{fmtMoney(data.totais.vBCISS)}</Cell><Cell label="Valor do ISSQN">{fmtMoney(data.totais.vISS)}</Cell></div></div>}
    <div className="footer-grid footer-segment" data-danfe-footer-segment>
      <div className="box footer-box"><div className="block-title">Informações complementares</div><div>{data.infCpl || "-"}</div>{data.xmlError && <div className="fallback-warning">Falha ao ler o XML: visualização complementada com dados do banco.</div>}{!data.xmlBaseAvailable && <div className="fallback-warning">XML não armazenado: esta visualização não substitui um DANFE originado do XML autorizado.</div>}</div>
      <div className="box footer-box"><div className="block-title">Reservado ao fisco</div><div>{data.infAdFisco || ""}</div></div>
    </div>
  </div>;
}

function useMeasuredDanfePagination({
  generatedRef,
  rootRef,
  sourceRef,
  version,
}: {
  generatedRef: RefObject<HTMLDivElement | null>;
  rootRef: RefObject<HTMLDivElement | null>;
  sourceRef: RefObject<HTMLElement | null>;
  version: unknown;
}) {
  useEffect(() => {
    const generated = generatedRef.current;
    const root = rootRef.current;
    const source = sourceRef.current;
    if (!generated || !root || !source) return;

    let disposed = false;
    let frame = 0;

    type MeasuredPage = {
      itemCount: number;
      itemsBlock: HTMLElement | null;
      mainBody: HTMLTableSectionElement | null;
      rtcBody: HTMLTableSectionElement | null;
      sheet: HTMLElement;
    };

    const paginate = () => {
      if (disposed) return;

      root.removeAttribute("data-danfe-pagination-ready");
      generated.replaceChildren();
      generated.classList.add("is-measuring");

      const receipt = source.querySelector<HTMLElement>("[data-danfe-receipt]");
      const header = source.querySelector<HTMLElement>("[data-danfe-header]");
      const firstDetails = source.querySelector<HTMLElement>("[data-danfe-first-details]");
      const itemsTemplate = source.querySelector<HTMLElement>("[data-danfe-items-block]");
      const footer = source.querySelector<HTMLElement>("[data-danfe-footer]");
      if (!header || !firstDetails || !itemsTemplate || !footer) {
        generated.classList.remove("is-measuring");
        return;
      }

      const sourceMainBody = itemsTemplate.querySelector<HTMLTableSectionElement>(
        "[data-danfe-main-table] tbody",
      );
      const sourceMainRows = sourceMainBody
        ? Array.from(sourceMainBody.querySelectorAll<HTMLTableRowElement>("tr[data-danfe-item-index]"))
        : [];
      const emptyItemRow = sourceMainRows.length === 0
        ? sourceMainBody?.querySelector<HTMLTableRowElement>("tr") ?? null
        : null;
      const sourceRtcRows = new Map(
        Array.from(
          itemsTemplate.querySelectorAll<HTMLTableRowElement>(
            "[data-danfe-rtc-table] tbody tr[data-danfe-item-index]",
          ),
        ).map((row) => [row.dataset.danfeItemIndex ?? "", row]),
      );
      const footerSegments = Array.from(
        footer.querySelectorAll<HTMLElement>(":scope > [data-danfe-footer-segment]"),
      );

      const pages: MeasuredPage[] = [];

      const createPage = (firstPage: boolean, withItems: boolean) => {
        const sheet = source.cloneNode(false) as HTMLElement;
        sheet.removeAttribute("aria-hidden");
        sheet.removeAttribute("data-danfe-measure-source");
        sheet.classList.remove("danfe-measure-source");

        if (firstPage && receipt) sheet.appendChild(receipt.cloneNode(true));
        sheet.appendChild(header.cloneNode(true));
        if (firstPage) sheet.appendChild(firstDetails.cloneNode(true));

        let itemsBlock: HTMLElement | null = null;
        let mainBody: HTMLTableSectionElement | null = null;
        let rtcBody: HTMLTableSectionElement | null = null;
        if (withItems) {
          itemsBlock = itemsTemplate.cloneNode(true) as HTMLElement;
          mainBody = itemsBlock.querySelector<HTMLTableSectionElement>("[data-danfe-main-table] tbody");
          rtcBody = itemsBlock.querySelector<HTMLTableSectionElement>("[data-danfe-rtc-table] tbody");
          mainBody?.replaceChildren();
          rtcBody?.replaceChildren();
          sheet.appendChild(itemsBlock);
        }

        generated.appendChild(sheet);
        const page = { itemCount: 0, itemsBlock, mainBody, rtcBody, sheet };
        pages.push(page);
        return page;
      };

      const fits = (page: MeasuredPage) => page.sheet.scrollHeight <= page.sheet.clientHeight + 1;

      const appendItem = (page: MeasuredPage, row: HTMLTableRowElement) => {
        const mainClone = row.cloneNode(true) as HTMLTableRowElement;
        const rtcSource = sourceRtcRows.get(row.dataset.danfeItemIndex ?? "");
        const rtcClone = rtcSource?.cloneNode(true) as HTMLTableRowElement | undefined;
        page.mainBody?.appendChild(mainClone);
        if (rtcClone) page.rtcBody?.appendChild(rtcClone);
        page.itemCount += 1;
        return () => {
          mainClone.remove();
          rtcClone?.remove();
          page.itemCount -= 1;
        };
      };

      let current = createPage(true, true);

      if (sourceMainRows.length === 0 && emptyItemRow) {
        current.mainBody?.appendChild(emptyItemRow.cloneNode(true));
      }

      sourceMainRows.forEach((row) => {
        const undo = appendItem(current, row);
        if (!fits(current) && current.itemCount > 1) {
          undo();
          current = createPage(false, true);
          appendItem(current, row);
        } else if (!fits(current) && current.itemCount === 1 && pages.length === 1) {
          undo();
          current.itemsBlock?.remove();
          current.itemsBlock = null;
          current.mainBody = null;
          current.rtcBody = null;
          current = createPage(false, true);
          appendItem(current, row);
        }

        if (!fits(current)) current.sheet.classList.add("danfe-sheet-oversize");
      });

      footerSegments.forEach((segment) => {
        let clone = segment.cloneNode(true) as HTMLElement;
        current.sheet.appendChild(clone);
        if (!fits(current)) {
          clone.remove();
          current = createPage(false, false);
          clone = segment.cloneNode(true) as HTMLElement;
          current.sheet.appendChild(clone);
        }
        if (!fits(current)) current.sheet.classList.add("danfe-sheet-oversize");
      });

      const totalPages = pages.length;
      pages.forEach((page, index) => {
        page.sheet
          .querySelectorAll<HTMLElement>("[data-danfe-page-current]")
          .forEach((element) => { element.textContent = String(index + 1); });
        page.sheet
          .querySelectorAll<HTMLElement>("[data-danfe-page-total]")
          .forEach((element) => { element.textContent = String(totalPages); });
      });

      generated.classList.remove("is-measuring");
      root.setAttribute("data-danfe-pagination-ready", "");
    };

    const schedulePagination = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(paginate);
    };
    const prepare = async () => {
      await document.fonts?.ready;
      schedulePagination();
    };
    const beforePrint = () => paginate();

    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("resize", schedulePagination, { passive: true });
    void prepare();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("resize", schedulePagination);
      root.removeAttribute("data-danfe-pagination-ready");
      generated.replaceChildren();
    };
  }, [generatedRef, rootRef, sourceRef, version]);
}

export function DanfeView({ data, exitHref = "/fiscal", actions, showActions = true }: { data: DanfeViewData; exitHref?: string; actions?: ReactNode; showActions?: boolean }) {
  const fallbackPages = paginateDanfeItems(data.itensDisplay);
  const showRtc = data.itensDisplay.some((item) => item.cst_ibs_cbs || item.cst_is);
  const filename = `danfe-nfe-${String(data.nfe.numero).padStart(9, "0")}.pdf`;
  const [fontScale, setFontScale] = useState<DanfeFontScale>(DANFE_DEFAULT_FONT_SCALE);
  const [fontPreferenceLoaded, setFontPreferenceLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLElement>(null);
  const generatedRef = useRef<HTMLDivElement>(null);
  useMeasuredDanfePagination({ generatedRef, rootRef, sourceRef, version: { data, fontScale } });

  useEffect(() => {
    try {
      const savedScale = lerEscalaFonteImpressao(
        window.localStorage.getItem(PRINT_FONT_SCALE_STORAGE_KEY),
      );
      if (savedScale !== null) setFontScale(savedScale);
    } catch {
      // O DANFE continua no tamanho padrão quando o navegador bloqueia o armazenamento.
    } finally {
      setFontPreferenceLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!fontPreferenceLoaded) return;

    try {
      window.localStorage.setItem(PRINT_FONT_SCALE_STORAGE_KEY, String(fontScale));
    } catch {
      // O tamanho continua aplicado nesta tela mesmo sem persistência.
    }
  }, [fontPreferenceLoaded, fontScale]);

  const receipt = <div className="receipt box" data-danfe-receipt><div><b>RECEBEMOS DE {data.emitenteNome} OS PRODUTOS/SERVIÇOS CONSTANTES DA NF-e INDICADA AO LADO</b><div>DATA DE RECEBIMENTO: ____________________ &nbsp; IDENTIFICAÇÃO E ASSINATURA: __________________________________________</div></div><div>NF-e<br /><b>Nº {String(data.nfe.numero).padStart(9, "0")}</b><br />SÉRIE {String(data.nfe.serie).padStart(3, "0")}</div></div>;

  return <>
    <style>{DANFE_STYLES}</style>
    <div className="danfe-page" style={{ "--danfe-font-scale": fontScale } as CSSProperties}><div className="danfe-scroll">
      {showActions && <div className="actions">{actions ?? <DefaultActions data={data} exitHref={exitHref} filename={filename} fontScale={fontScale} onFontScaleChange={setFontScale} />}</div>}
      <div className="danfe-render-root" ref={rootRef}>
        <div className="danfe-wrapper danfe-fallback">
        {fallbackPages.map((items, index) => <section className="danfe-sheet" key={index}>
          {index === 0 && receipt}
          <Header data={data} page={index + 1} totalPages={fallbackPages.length} />
          {index === 0 && <FirstPageDetails data={data} />}
          <ItemsTable items={items} showRtc={showRtc} />
          {index === fallbackPages.length - 1 && <FooterDetails data={data} />}
        </section>)}
        </div>
        <section aria-hidden="true" className="danfe-sheet danfe-measure-source" data-danfe-measure-source ref={sourceRef}>
          {receipt}
          <div className="danfe-contents-group" data-danfe-header><Header data={data} page={1} totalPages={1} /></div>
          <div className="danfe-contents-group" data-danfe-first-details><FirstPageDetails data={data} /></div>
          <ItemsTable items={data.itensDisplay} showRtc={showRtc} />
          <FooterDetails data={data} />
        </section>
        <div className="danfe-wrapper danfe-generated" ref={generatedRef} />
      </div>
    </div></div>
  </>;
}

const DANFE_STYLES = `
  @page { size: A4; margin: 0; }
  .danfe-page { --danfe-font-scale:1; font-family:Arial,Helvetica,sans-serif; font-size:calc(7px * var(--danfe-font-scale)); color:#000; background:#f3f4f6; min-height:100vh; padding:16px 0; overflow:auto; }
  .danfe-scroll { width:max-content; min-width:210mm; margin:0 auto; }
  .danfe-wrapper { display:flex; flex-direction:column; gap:12px; }
  .danfe-sheet { position:relative; width:210mm; min-width:210mm; height:297mm; min-height:297mm; max-height:297mm; padding:5mm; box-sizing:border-box; background:#fff; border:1px solid #aaa; break-after:page; page-break-after:always; }
  .danfe-sheet:last-child { break-after:auto; page-break-after:auto; }
  .danfe-contents-group,.footer-details { display:contents; }
  .danfe-measure-source { position:absolute; left:-100000px; top:0; visibility:hidden; pointer-events:none; }
  .danfe-generated { display:none; }
  .danfe-generated.is-measuring { position:absolute; left:-100000px; top:0; display:flex; visibility:hidden; pointer-events:none; }
  .danfe-render-root[data-danfe-pagination-ready]>.danfe-fallback { display:none; }
  .danfe-render-root[data-danfe-pagination-ready]>.danfe-generated { display:flex; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; align-items:center; width:210mm; margin-bottom:8px; }
  .exit-link { display:inline-flex; height:32px; align-items:center; padding:0 12px; border:1px solid #ddd; border-radius:6px; background:#fff; color:#111827; font:500 14px system-ui; text-decoration:none; }
  .font-size-control { display:flex; align-items:center; gap:4px; }
  .font-size-control button { min-width:38px; }
  .font-size-symbol { font:700 14px/1 system-ui; }
  .font-size-value { min-width:72px; color:#111827; font:600 12px/1 system-ui; text-align:center; }
  .box { min-width:0; border:1px solid #000; box-sizing:border-box; }
  .receipt { display:grid; grid-template-columns:1fr 30mm; margin-bottom:2mm; min-height:17mm; }
  .receipt>div { min-width:0; padding:2mm; overflow-wrap:anywhere; }
  .receipt>div+div { border-left:1px solid #000; text-align:center; font-size:calc(9px * var(--danfe-font-scale)); }
  .header-grid { display:grid; grid-template-columns:67mm 34mm 1fr; min-height:40mm; }
  .header-grid>div { min-width:0; padding:1.5mm; overflow-wrap:anywhere; }
  .header-grid>div+div { border-left:1px solid #000; }
  .issuer { min-width:0; font-size:calc(8px * var(--danfe-font-scale)); line-height:1.35; overflow-wrap:anywhere; }
  .issuer>strong { display:block; font-size:calc(11px * var(--danfe-font-scale)); margin:2mm 0 1mm; text-align:center; }
  .danfe-title { min-width:0; display:flex; flex-direction:column; align-items:center; text-align:center; gap:1mm; overflow-wrap:anywhere; }
  .danfe-title>b { font-size:calc(18px * var(--danfe-font-scale)); }
  .danfe-title>span:first-of-type { font-size:calc(8px * var(--danfe-font-scale)); font-weight:700; }
  .access-key { overflow:hidden; }
  .barcode { display:block; width:100%; height:13mm; margin-bottom:1mm; }
  .barcode-error { height:13mm; display:flex; align-items:center; justify-content:center; border:1px dashed #000; font-weight:700; }
  .key { font-weight:700; font-size:calc(8px * var(--danfe-font-scale)); font-family:'Courier New',monospace; letter-spacing:.4px; overflow-wrap:anywhere; }
  .tiny { font-size:calc(6px * var(--danfe-font-scale)); line-height:1.2; margin-top:1mm; }
  .center { text-align:center; }
  .field-label,.block-title { font-size:calc(6px * var(--danfe-font-scale)); font-weight:700; text-transform:uppercase; }
  .field-value { margin-top:.7mm; font-size:calc(7px * var(--danfe-font-scale)); min-height:3mm; overflow-wrap:anywhere; }
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
  .items-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:calc(5.8px * var(--danfe-font-scale)); }
  .items-table th,.items-table td { border-right:1px solid #000; border-bottom:1px solid #000; padding:.7mm .5mm; vertical-align:top; overflow-wrap:anywhere; }
  .items-table th:last-child,.items-table td:last-child { border-right:0; }
  .items-table tr:last-child td { border-bottom:0; }
  .items-table th { text-transform:uppercase; font-size:calc(5.2px * var(--danfe-font-scale)); }
  .items-table .description { width:25%; text-align:left; }
  .items-table .number { text-align:right; white-space:normal; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
  .tax-detail { display:block; font-size:calc(5px * var(--danfe-font-scale)); margin-top:.5mm; font-weight:400; }
  .rtc-table { border-top:1px solid #000; font-size:calc(5.2px * var(--danfe-font-scale)); }
  .billing,.payments { display:flex; min-width:0; flex-wrap:wrap; }
  .billing>.cell,.payments>.cell { flex:1 1 35mm; border-right:1px solid #000; }
  .issqn { display:grid; grid-template-columns:repeat(4,1fr); }
  .footer-segment { min-width:0; break-inside:avoid; page-break-inside:avoid; }
  .footer-grid { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:1mm; margin-top:1.5mm; }
  .footer-box { min-height:22mm; padding:1.5mm; white-space:pre-wrap; overflow-wrap:anywhere; }
  .fallback-warning { margin-top:1mm; font-weight:700; }
  .fiscal-warning { border:2px solid #000; padding:1mm; margin-bottom:1mm; text-align:center; font-size:calc(9px * var(--danfe-font-scale)); font-weight:800; }
  @media(max-width:767px){ .danfe-scroll{margin:0;padding:0 12px}.actions{position:sticky;left:12px;z-index:3;width:calc(100vw - 24px);justify-content:flex-start}.danfe-page{padding:12px 0} }
  @media print { .danfe-page{background:#fff;padding:0;overflow:visible}.danfe-scroll{width:auto;min-width:0;margin:0}.actions{display:none}.danfe-wrapper{display:block;gap:0}.danfe-measure-source{display:none}.danfe-sheet{border:0;margin:0;width:210mm;min-width:210mm;height:297mm;min-height:297mm;max-height:297mm} }
`;
