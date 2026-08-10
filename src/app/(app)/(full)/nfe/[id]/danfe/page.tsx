import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DanfeView } from "@/components/danfe/danfe-view";
import {
  DanfeNfceView,
  type DanfeNfceViewData,
} from "@/components/danfe/danfe-nfce-view";
import { carregarDadosDanfe } from "@/lib/nfe/danfeData";
import {
  extrairQrCodeDoXml,
  formatarChaveEmBlocos,
  gerarQrCodeDataUrl,
} from "@/lib/nfe/nfce/danfeNfceData";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ origem?: string }>;
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
  "15": "Boleto bancário",
  "16": "Depósito bancário",
  "17": "PIX",
  "18": "Transferência/carteira digital",
  "19": "Programa de fidelidade",
  "90": "Sem pagamento",
  "99": "Outros",
};

const dinheiro = (valor: number) =>
  Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return { title: "DANFE" };
  const { data } = await supabaseAdmin
    .from("nfe")
    .select("numero, modelo")
    .eq("id", id)
    .maybeSingle();
  if (!data?.numero) return { title: "DANFE" };
  return {
    title: `DANFE ${data.modelo === "NFCE" ? "NFC-e" : "NF-e"} #${data.numero}`,
  };
}

const onlyDigits = (valor: unknown) => String(valor ?? "").replace(/\D/g, "");

/** vTroco não é lido pelo parser do DANFE A4; aqui vem direto do XML. */
function extrairTroco(xml: string | null | undefined): number {
  const match = xml?.match(/<vTroco>([\d.]+)<\/vTroco>/);
  return match ? Number(match[1]) : 0;
}

export default async function DanfePage({ params, searchParams }: PageProps) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  const search = searchParams ? await searchParams : {};
  const dados = await carregarDadosDanfe(id, search.origem === "terceiros" ? "terceiros" : "proprias");
  if (!dados) notFound();

  // O layout é escolhido pelo modelo do documento: o DANFE NFC-e é bobina, e
  // não o A4 da NF-e com outro título.
  if (dados.nfe.modelo !== "NFCE") {
    return <DanfeView data={dados.view} />;
  }

  const view = dados.view;
  const xml = dados.nfe.xml_autorizado || dados.nfe.xml_assinado || null;
  const { qrCode, urlChave } = extrairQrCodeDoXml(xml);
  const qrCodeDataUrl = qrCode ? await gerarQrCodeDataUrl(qrCode) : null;
  const troco = extrairTroco(xml);

  const dadosNfce: DanfeNfceViewData = {
    emitenteNome: view.emitenteNome,
    emitenteCnpj: view.emitenteCnpj,
    emitenteEndereco: view.emitenteEndereco,
    emitenteIe: view.emitenteIe,

    numero: view.nfe.numero,
    serie: view.nfe.serie,
    dataEmissao: view.dataEmissaoDanfe ? String(view.dataEmissaoDanfe) : "",
    protocolo: view.nfe.protocolo,
    dataAutorizacao: view.nfe.dataautorizacao ? String(view.nfe.dataautorizacao) : null,

    chaveAcesso: view.chaveAcesso,
    chaveFormatada: formatarChaveEmBlocos(view.chaveAcesso),
    ambienteHomologacao: String(view.ambiente).toUpperCase().includes("HOMOLOG"),
    statusLabel: view.statusLabel,
    isAutorizada: view.isAutorizada,
    contingencia: String(view.tipoEmissao).includes("9"),

    // Consumidor não identificado é o caso normal: o grupo dest nem existe.
    consumidorDocumento: view.destinatarioDoc && view.destinatarioDoc !== "-" ? view.destinatarioDoc : null,
    consumidorTipoDocumento:
      onlyDigits(view.destinatarioDoc).length === 14 ? "CNPJ" : "CPF",
    consumidorNome:
      view.destinatarioNome && view.destinatarioNome !== "-" ? view.destinatarioNome : null,

    itens: view.itensDisplay.map((item) => ({
      codigo: String(item.produtoid ?? item.n_item),
      descricao: item.descricao,
      quantidade: Number(item.quantidade ?? 0).toLocaleString("pt-BR", {
        maximumFractionDigits: 4,
      }),
      unidade: item.unidade,
      valorUnitario: dinheiro(item.valor_unitario),
      valorTotal: dinheiro(item.valor_total),
    })),
    totalItens: view.itensDisplay.length,
    valorTotal: dinheiro(view.totais.vNF),
    desconto: view.totais.vDesc > 0 ? dinheiro(view.totais.vDesc) : null,
    pagamentos: view.pagamentos.map((pagamento) => ({
      descricao:
        pagamento.descricao || PAGAMENTO_LABEL[pagamento.tipo] || `Meio ${pagamento.tipo}`,
      valor: dinheiro(pagamento.valor),
    })),
    troco: troco > 0 ? dinheiro(troco) : null,

    qrCodeDataUrl,
    urlConsulta: urlChave,
    informacoesAdicionais: view.infCpl,
  };

  return <DanfeNfceView data={dadosNfce} />;
}
