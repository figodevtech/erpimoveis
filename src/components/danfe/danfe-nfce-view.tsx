"use client";

import { useCallback } from "react";
import Image from "next/image";
import { Printer, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * DANFE NFC-e — representação auxiliar em bobina.
 *
 * Não é o DANFE A4 da NF-e com outro cabeçalho: o modelo 65 tem layout próprio,
 * pensado para impressora térmica de 80 mm, com itens resumidos, o QR Code e a
 * chave em blocos de 4 para digitação manual.
 *
 * Vale lembrar o que este documento é: representação auxiliar. O documento
 * fiscal é o XML autorizado.
 */

export type DanfeNfceItem = {
  codigo: string;
  descricao: string;
  quantidade: string;
  unidade: string;
  valorUnitario: string;
  valorTotal: string;
};

export type DanfeNfcePagamento = {
  descricao: string;
  valor: string;
};

export type DanfeNfceViewData = {
  emitenteNome: string;
  emitenteCnpj: string;
  emitenteEndereco: string;
  emitenteIe?: string | null;

  numero: number | string;
  serie: number | string;
  dataEmissao: string;
  protocolo?: string | null;
  dataAutorizacao?: string | null;

  chaveAcesso: string;
  chaveFormatada: string;
  ambienteHomologacao: boolean;
  statusLabel: string;
  isAutorizada: boolean;
  contingencia: boolean;

  consumidorDocumento?: string | null;
  /** "CNPJ", "CPF" ou "Id. Estrangeiro", conforme o Manual v6.0, item 3.1.6. */
  consumidorTipoDocumento?: string | null;
  consumidorNome?: string | null;

  itens: DanfeNfceItem[];
  totalItens: number;
  valorTotal: string;
  desconto?: string | null;
  pagamentos: DanfeNfcePagamento[];
  troco?: string | null;

  /** Imagem do QR Code em data URL. */
  qrCodeDataUrl: string | null;
  urlConsulta?: string | null;

  tributosTotais?: string | null;
  informacoesAdicionais?: string | null;
};

export function DanfeNfceView({
  data,
  exitHref = "/fiscal",
}: {
  data: DanfeNfceViewData;
  exitHref?: string;
}) {
  const imprimir = useCallback(() => window.print(), []);

  return (
    <div className="min-h-screen bg-muted/40 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[302px] items-center justify-between print:hidden">
        <Button asChild size="sm" variant="ghost">
          <Link href={exitHref}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar
          </Link>
        </Button>
        <Button onClick={imprimir} size="sm">
          <Printer className="mr-1 h-4 w-4" />
          Imprimir
        </Button>
      </div>

      {/* 302px ≈ 80 mm de bobina em 96 dpi. */}
      <div className="mx-auto w-[302px] bg-white p-3 font-mono text-[11px] leading-tight text-black shadow-sm print:w-full print:shadow-none">
        {/* Texto exigido pelo Manual v6.0, item 3.1.8, para homologação. */}
        {data.ambienteHomologacao ? (
          <p className="mb-2 border border-black p-1 text-center text-[10px] font-bold uppercase">
            Emitida em ambiente de homologação — sem valor fiscal
          </p>
        ) : null}

        <header className="text-center">
          <p className="text-[12px] font-bold uppercase">{data.emitenteNome}</p>
          <p>CNPJ {data.emitenteCnpj}</p>
          {data.emitenteIe ? <p>IE {data.emitenteIe}</p> : null}
          <p className="whitespace-pre-line">{data.emitenteEndereco}</p>
        </header>

        {/* Contingência: o Manual (3.1.8) manda destacar em DOIS pontos — logo
            abaixo do cabeçalho e abaixo da identificação da NFC-e. */}
        {data.contingencia ? <AvisoContingencia /> : null}

        {!data.isAutorizada && !data.contingencia ? (
          <p className="mt-2 border border-dashed border-black p-1 text-center text-[10px] font-bold uppercase">
            {data.statusLabel}
          </p>
        ) : null}

        <Separador />

        <p className="text-center text-[10px] font-bold uppercase">
          Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
        </p>

        <Separador />

        <table className="w-full">
          <thead>
            <tr className="text-left">
              <th className="w-[38%]">Descrição</th>
              <th className="w-[14%] text-right">Qtd</th>
              <th className="w-[22%] text-right">Un.</th>
              <th className="w-[26%] text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.itens.map((item, index) => (
              <tr key={`${item.codigo}-${index}`} className="align-top">
                <td className="pr-1">
                  <span className="block">{item.descricao}</span>
                  <span className="block text-[9px] text-neutral-600">Cód. {item.codigo}</span>
                </td>
                <td className="text-right">
                  {item.quantidade} {item.unidade}
                </td>
                <td className="text-right">{item.valorUnitario}</td>
                <td className="text-right">{item.valorTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Separador />

        <Linha rotulo={`Qtd. total de itens`} valor={String(data.totalItens)} />
        {data.desconto ? <Linha rotulo="Descontos" valor={data.desconto} /> : null}
        <Linha rotulo="Valor total" valor={data.valorTotal} destaque />

        <Separador />

        <p className="font-bold uppercase">Forma de pagamento</p>
        {data.pagamentos.map((pagamento, index) => (
          <Linha key={index} rotulo={pagamento.descricao} valor={pagamento.valor} />
        ))}
        {data.troco ? <Linha rotulo="Troco" valor={data.troco} /> : null}

        <Separador />

        <div className="text-center">
          <p className="font-bold uppercase">Consulte pela chave de acesso em</p>
          {data.urlConsulta ? <p className="break-all">{data.urlConsulta}</p> : null}
          <p className="mt-1 break-all font-bold tracking-tight">{data.chaveFormatada}</p>
        </div>

        <Separador />

        {/* Rótulos do Manual v6.0, item 3.1.6. */}
        <div className="text-center">
          <p className="font-bold uppercase">
            {data.consumidorDocumento
              ? `Consumidor ${data.consumidorTipoDocumento ?? "CPF"}: ${data.consumidorDocumento}`
              : "Consumidor não identificado"}
          </p>
          {data.consumidorNome ? <p>{data.consumidorNome}</p> : null}
        </div>

        <Separador />

        <div className="text-center">
          <p>
            NFC-e nº {data.numero} · Série {data.serie}
          </p>
          <p>Emissão {data.dataEmissao}</p>
          {/* Em contingência o protocolo é suprimido (Manual, item 3.1.7). */}
          {data.protocolo && !data.contingencia ? (
            <p>
              Protocolo {data.protocolo}
              {data.dataAutorizacao ? ` · ${data.dataAutorizacao}` : ""}
            </p>
          ) : null}
        </div>

        {data.contingencia ? <AvisoContingencia /> : null}

        {data.qrCodeDataUrl ? (
          <div className="mt-2 flex justify-center">
            <Image
              alt="QR Code para consulta da NFC-e"
              height={160}
              src={data.qrCodeDataUrl}
              unoptimized
              width={160}
            />
          </div>
        ) : (
          <p className="mt-2 text-center text-[10px] font-bold uppercase">
            QR Code indisponível — documento ainda não autorizado
          </p>
        )}

        {data.tributosTotais ? (
          <p className="mt-2 text-center text-[10px]">
            Tributos totais incidentes (Lei 12.741/2012): {data.tributosTotais}
          </p>
        ) : null}

        {data.informacoesAdicionais ? (
          <>
            <Separador />
            <p className="text-[10px] whitespace-pre-line">{data.informacoesAdicionais}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Separador() {
  return <div className="my-2 border-t border-dashed border-black" />;
}

/** Texto obrigatório em duas linhas na contingência (Manual v6.0, item 3.1.8). */
function AvisoContingencia() {
  return (
    <div className="my-2 border-y border-black py-1 text-center">
      <p className="text-[12px] font-bold uppercase">Emitida em contingência</p>
      <p className="text-[11px]">Pendente de autorização</p>
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-2 ${destaque ? "text-[13px] font-bold" : ""}`}>
      <span className="uppercase">{rotulo}</span>
      <span>{valor}</span>
    </div>
  );
}
