"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import type { TotaisServicos } from "@/lib/relatorios/servicos-realizados";
import {
  MM_ESPACO, MM_IDENTIFICACAO, MM_LINHA, MM_LINHA_NOTA, MM_VALORES, inteiro, moeda, observacaoDaTaxa, paginarServicos, percentual,
  rotuloSituacao, rotuloStatus, type BlocoGrupo, type BlocoRelatorio, type BlocoServico, type PaginaServicos,
} from "./report-model";

/**
 * Folha de serviços realizados.
 *
 * A leitura desta folha é sempre a mesma: fecha-se a comissão de alguém. Então
 * a faixa de cada grupo carrega os próprios totais — antes eles eram calculados
 * e não chegavam ao papel, e quem conferia somava serviço a serviço.
 *
 * Cada serviço é um bloco de três partes: identificação da OS, o que foi feito
 * e para quem, e a conta da comissão. Os tamanhos vêm do modelo, em milímetros,
 * porque o PDF é gerado rasterizando cada folha inteira.
 */

/** Tom de cada status da OS. No preto e branco vira cinza, então a cor acompanha o rótulo — nunca o substitui. */
const STATUS_TOM: Record<string, { faixa: string; selo: string }> = {
  AGUARDANDO_CHECKLIST: { faixa: "bg-neutral-400", selo: "bg-neutral-100 text-neutral-700" },
  ORCAMENTO: { faixa: "bg-amber-400", selo: "bg-amber-50 text-amber-800" },
  APROVACAO_ORCAMENTO: { faixa: "bg-amber-500", selo: "bg-amber-50 text-amber-800" },
  ORCAMENTO_APROVADO: { faixa: "bg-sky-500", selo: "bg-sky-50 text-sky-800" },
  ORCAMENTO_RECUSADO: { faixa: "bg-red-400", selo: "bg-red-50 text-red-800" },
  EM_ANDAMENTO: { faixa: "bg-blue-500", selo: "bg-blue-50 text-blue-800" },
  FATURAMENTO: { faixa: "bg-cyan-600", selo: "bg-cyan-50 text-cyan-800" },
  PAGAMENTO: { faixa: "bg-violet-500", selo: "bg-violet-50 text-violet-800" },
  SEM_COBRANCA: { faixa: "bg-neutral-500", selo: "bg-neutral-100 text-neutral-700" },
  CONCLUIDO: { faixa: "bg-emerald-500", selo: "bg-emerald-50 text-emerald-800" },
  CANCELADO: { faixa: "bg-red-500", selo: "bg-red-50 text-red-800" },
};
const SEM_TOM = { faixa: "bg-neutral-300", selo: "bg-neutral-100 text-neutral-700" };
const SITUACAO_TOM: Record<string, string> = {
  PENDENTE: "border-amber-300 text-amber-800", EM_EXECUCAO: "border-blue-300 text-blue-800", FINALIZADO: "border-emerald-300 text-emerald-800",
};

export function ServicosReportView({ endpoint }: { endpoint: string }) {
  const [resultado, setResultado] = useState<{ endpoint: string; paginas: PaginaServicos[]; empresa: string; emitido: string } | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function carregar() {
      try {
        const res = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || "Não foi possível carregar o relatório."); }
        const buffer = await res.arrayBuffer();
        const { lerWorkbookServicos } = await import("@/lib/relatorios/servicos-realizados-workbook");
        const { linhas, metadados, por } = lerWorkbookServicos(buffer);
        const paginas = paginarServicos(linhas, por, metadados);
        if (!controller.signal.aborted) { setErro(""); setResultado({ endpoint, paginas, empresa: metadados.find(([k]) => k === "Empresa")?.[1] || "Oficina", emitido: metadados.find(([k]) => k === "Emitido em")?.[1] || "" }); }
      } catch (e) { if (!controller.signal.aborted) setErro(e instanceof Error ? e.message : "Não foi possível carregar o relatório."); }
    }
    void carregar();
    return () => controller.abort();
  }, [endpoint]);
  if (erro) return <main className="p-8"><p role="alert">{erro}</p><Link href="/relatorios" className="underline">Voltar aos relatórios</Link></main>;
  if (!resultado || resultado.endpoint !== endpoint) return <main className="flex items-center justify-center gap-2 p-12"><Loader2 className="h-5 w-5 animate-spin" />Preparando relatório...</main>;
  return <ServicosReportPages resultado={resultado} />;
}

export function ServicosReportPages({ resultado }: { resultado: { paginas: PaginaServicos[]; empresa: string; emitido: string } }) {
  return <>
    <style>{`
      @page { size: A4 portrait; margin: 0; }
      /* Arial é a fonte que o modelo mede para quebrar as linhas: trocá-la aqui desalinha a paginação. */
      .sr-sheet { box-sizing: border-box; width: 210mm; height: 297mm; padding: 10mm; background: white; color: #171717;
        font-family: Arial, Helvetica, "Liberation Sans", sans-serif; }
      .sr-linha { font-size: 9px; line-height: ${MM_LINHA}mm; height: ${MM_LINHA}mm; white-space: pre; overflow: hidden; }
      .sr-nota { font-size: 8px; line-height: ${MM_LINHA_NOTA}mm; height: ${MM_LINHA_NOTA}mm; white-space: pre; overflow: hidden; }
      @media print {
        html,body { margin:0!important; padding:0!important; background:white!important; }
        .sr-shell { padding:0!important; background:white!important; }
        .sr-sheet { margin:0!important; border:0!important; box-shadow:none!important; break-after:page; page-break-after:always; }
        .sr-sheet:last-child { break-after:auto; page-break-after:auto; }
        .sr-sheet,.sr-sheet * { -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
        .no-print { display:none!important; }
      }
    `}</style>
    <main className="sr-shell min-h-screen overflow-x-auto bg-neutral-200 p-6 text-black">
      <div className="no-print mx-auto mb-4 flex w-[210mm] justify-end"><A4PdfActions filename="servicos-realizados.pdf" backHref="/relatorios" selector=".sr-sheet" /></div>
      <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
        {resultado.paginas.map((pagina, i) => {
          // O zebrado conta só os serviços da folha: faixas de grupo no meio da
          // contagem fariam duas listras seguidas caírem lado a lado.
          let indiceServico = -1;
          return <section className="sr-sheet flex flex-col overflow-hidden border shadow-xl" key={i}>
            {/* Título, recorte e período abrem o relatório uma vez. Nas folhas
                seguintes fica só a linha de página: o rodapé já carrega a
                empresa e a numeração em todas elas. */}
            {i === 0 ? <header className="flex h-[15mm] shrink-0 items-start justify-between gap-4 border-b-2 border-neutral-900 pb-1">
              <div className="min-w-0">
                <h1 className="text-[15px] font-bold uppercase tracking-wide">Serviços realizados</h1>
                <p className="text-[8.5px] text-neutral-500">Serviços, atribuições e comissões por {pagina.agrupamento.toLowerCase()}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[7.5px] uppercase tracking-wide text-neutral-500">{pagina.eixo}</p>
                <p className="text-[10px] font-bold tabular-nums">{pagina.periodo}</p>
                <p className="text-[8px] text-neutral-500">Página {i + 1} de {resultado.paginas.length}</p>
              </div>
            </header> : <p className="flex h-[5mm] shrink-0 items-start justify-end text-[8px] text-neutral-500">Página {i + 1} de {resultado.paginas.length}</p>}
            <div className="mt-[3mm] min-h-0 flex-1">
              {pagina.blocos.map((b, index) => {
                if (b.tipo === "servico") indiceServico += 1;
                return <Bloco key={`${b.chave}-${index}`} bloco={b} listrado={b.tipo === "servico" && indiceServico % 2 === 1} />;
              })}
            </div>
            <footer className="mt-auto flex h-[6mm] shrink-0 items-end justify-between gap-3 border-t pt-1 text-[8px] text-neutral-500">
              <span className="min-w-0 flex-1 truncate">{resultado.empresa}{pagina.cnpj ? ` · CNPJ ${pagina.cnpj}` : ""}</span>
              <span className="shrink-0">{resultado.emitido ? `Emitido em ${resultado.emitido} · ` : ""}{i + 1}/{resultado.paginas.length}</span>
            </footer>
          </section>;
        })}
      </div>
    </main>
  </>;
}

function Bloco({ bloco, listrado }: { bloco: BlocoRelatorio; listrado: boolean }) {
  if (bloco.tipo === "painel") return <div style={{ height: `${bloco.altura}mm`, boxSizing: "border-box", paddingBottom: "3mm" }} className="overflow-hidden">
    <div className="grid grid-cols-4 gap-2">
      {[
        { label: "Serviços distintos", valor: inteiro(bloco.totais.servicos), destaque: false },
        { label: "Valor dos serviços", valor: moeda(bloco.totais.valor), destaque: false },
        { label: "Base individual total", valor: moeda(bloco.totais.base), destaque: false },
        { label: "Comissão sugerida", valor: moeda(bloco.totais.comissao), destaque: true },
      ].map(card => <div key={card.label} className={`flex h-[17mm] flex-col justify-center rounded border px-2 ${card.destaque ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-slate-50"}`}>
        <p className="text-[7.5px] uppercase tracking-wide text-neutral-500">{card.label}</p>
        <p className={`mt-[1mm] text-[14px] font-bold tabular-nums ${card.destaque ? "text-violet-800" : "text-slate-900"}`}>{card.valor}</p>
      </div>)}
    </div>
    <p className="mt-[1.5mm] text-[8px] text-neutral-500">
      <strong className="tabular-nums text-neutral-700">{inteiro(bloco.participacoes)}</strong> {bloco.participacoes === 1 ? "participação" : "participações"}
      {" · "}<strong className="tabular-nums text-neutral-700">{inteiro(bloco.realizadores)}</strong> {bloco.realizadores === 1 ? "realizador" : "realizadores"}
      {" · Agrupado por "}{bloco.agrupamento.toLowerCase()}
    </p>
  </div>;

  if (bloco.tipo === "filtros") return <div style={{ height: `${bloco.altura}mm`, boxSizing: "border-box", paddingBottom: "2mm" }} className="overflow-hidden">
    {bloco.chips.map((fileira, i) => <div className="flex h-[5mm] items-center gap-1" key={i}>
      {fileira.map(chip => <span key={chip} className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-[1px] text-[8px] uppercase leading-none text-neutral-600">{chip}</span>)}
    </div>)}
  </div>;

  if (bloco.tipo === "nota") return <div style={{ height: `${bloco.altura}mm`, boxSizing: "border-box" }} className={`overflow-hidden ${bloco.vazio ? "mt-[6mm] rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-[3mm] text-center" : "mt-[4mm] border-t pt-[2mm]"}`}>
    {bloco.linhas.map((linha, i) => <div className={`sr-nota ${bloco.vazio ? "text-[9px] text-neutral-600" : "text-neutral-500"}`} key={i}>{linha || " "}</div>)}
  </div>;

  if (bloco.tipo === "grupo") return <FaixaDeGrupo bloco={bloco} />;
  return <LinhaDeServico bloco={bloco} listrado={listrado} />;
}

/**
 * Faixa de um grupo, com os totais do próprio grupo à direita.
 *
 * O nível de cima é o recorte pedido — setor, criador ou realizador — e vai em
 * fundo escuro; o de baixo é sempre o realizador dentro dele.
 */
function FaixaDeGrupo({ bloco }: { bloco: BlocoGrupo }) {
  const raiz = bloco.nivel === 0;
  return <div style={{ height: `${bloco.altura}mm`, boxSizing: "border-box", paddingBottom: "1.5mm" }} className="overflow-hidden">
    <div className={`flex h-full items-center justify-between gap-3 px-2 ${raiz ? "rounded-sm bg-slate-800 text-white" : "rounded-sm border-l-[3px] border-slate-400 bg-slate-100"}`}>
      <div className="min-w-0">
        <p className={`text-[7px] uppercase tracking-wide ${raiz ? "text-slate-300" : "text-slate-500"}`}>
          {bloco.rotulo}
          {bloco.percentualAtual != null ? ` · comissão atual ${percentual(bloco.percentualAtual)}` : ""}
        </p>
        {bloco.nome.map((linha, i) => <p className={`truncate font-bold ${raiz ? "text-[11px]" : "text-[10px]"}`} style={{ lineHeight: `${MM_LINHA}mm` }} key={i}>{linha}</p>)}
      </div>
      <TotaisDoGrupo totais={bloco.totais} raiz={raiz} />
    </div>
  </div>;
}

function TotaisDoGrupo({ totais, raiz }: { totais: TotaisServicos; raiz: boolean }) {
  const itens = [
    { label: "Serviços", valor: inteiro(totais.servicos) },
    { label: "Valor", valor: moeda(totais.valor) },
    { label: "Base", valor: moeda(totais.base) },
    { label: "Comissão", valor: moeda(totais.comissao) },
  ];
  return <div className="flex shrink-0 items-end gap-3">
    {itens.map((item, i) => <div key={item.label} className="text-right">
      <p className={`text-[6.5px] uppercase tracking-wide ${raiz ? "text-slate-300" : "text-slate-500"}`}>{item.label}</p>
      <p className={`text-[9px] font-bold tabular-nums ${i === 3 ? (raiz ? "text-violet-200" : "text-violet-800") : (raiz ? "text-white" : "text-slate-800")}`}>{item.valor}</p>
    </div>)}
  </div>;
}

/**
 * Um serviço na folha: identificação da OS, o que foi feito, e a conta da
 * comissão. Fragmento de continuação repete só a identificação e não repete os
 * valores — a comissão é lançada uma vez, no último pedaço.
 */
function LinhaDeServico({ bloco, listrado }: { bloco: BlocoServico; listrado: boolean }) {
  const l = bloco.linha;
  const tom = STATUS_TOM[l.statusOS] ?? SEM_TOM;
  return <article style={{ height: `${bloco.altura}mm`, boxSizing: "border-box", paddingBottom: `${MM_ESPACO}mm` }} className="overflow-hidden">
    <div className={`flex h-full flex-col overflow-hidden rounded-sm border border-neutral-200 ${listrado ? "bg-neutral-50" : "bg-white"}`}>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-200 px-1.5" style={{ height: `${MM_IDENTIFICACAO}mm` }}>
        <span className={`h-[3mm] w-[1mm] shrink-0 rounded-sm ${tom.faixa}`} aria-hidden />
        <span className="shrink-0 text-[10px] font-bold tabular-nums">OS #{l.ordemId}</span>
        <span className="shrink-0 text-[8px] text-neutral-500">Serviço #{l.servicoId}</span>
        <span className={`shrink-0 rounded px-1 py-[1px] text-[7px] font-semibold uppercase leading-none ${tom.selo}`}>{rotuloStatus(l.statusOS)}</span>
        <span className={`shrink-0 rounded border bg-white px-1 py-[1px] text-[7px] font-semibold uppercase leading-none ${SITUACAO_TOM[l.situacao] ?? "border-neutral-300 text-neutral-600"}`}>{rotuloSituacao(l.situacao)}</span>
        {bloco.continuacao && <span className="shrink-0 rounded bg-neutral-200 px-1 py-[1px] text-[7px] uppercase leading-none text-neutral-700">continuação</span>}
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 text-[7px] uppercase tracking-wide text-neutral-500">Valor do serviço</span>
        <span className="shrink-0 text-[10px] font-bold tabular-nums">{moeda(l.valorServico)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-1.5 pt-[0.6mm]">
        {bloco.titulo.map((linha, i) => <div className="sr-linha font-semibold text-slate-900" key={`t${i}`}>{linha || " "}</div>)}
        {bloco.complemento.map((linha, i) => <div className="sr-linha text-neutral-600" key={`c${i}`}>{linha || " "}</div>)}
        {bloco.contexto.map((linha, i) => <div className="sr-linha text-neutral-700" key={`x${i}`}>{linha || " "}</div>)}
        {bloco.execucao.map((linha, i) => <div className="sr-linha text-neutral-500" key={`e${i}`}>{linha || " "}</div>)}
      </div>
      {bloco.valores && <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 bg-slate-50 px-1.5 text-[8px]" style={{ height: `${MM_VALORES}mm` }}>
        {/* Corrigida no evento da OS, a conta base × % não fecha com o valor;
            a faixa diz de onde o número veio e o que a regra daria. */}
        {l.comissaoAjustada ? <span className="min-w-0 truncate text-neutral-500">
          <strong className="text-amber-700">Ajustada no evento financeiro da OS</strong>
          {" · pela regra "}<strong className="tabular-nums text-neutral-800">{moeda(l.comissaoCalculada)}</strong>
          <span className="text-neutral-400">{`  (base ${moeda(l.baseComissao)} × ${percentual(l.percentualAplicado)})`}</span>
        </span> : <span className="min-w-0 truncate text-neutral-500">
          Base individual <strong className="tabular-nums text-neutral-800">{moeda(l.baseComissao)}</strong>
          {" × "}<strong className="tabular-nums text-neutral-800">{percentual(l.percentualAplicado)}</strong>
          {observacaoDaTaxa(l) ? <span className="text-neutral-400">{`  (${observacaoDaTaxa(l)})`}</span> : null}
        </span>}
        <span className="shrink-0 whitespace-nowrap">
          <span className="text-[7px] uppercase tracking-wide text-neutral-500">Comissão sugerida </span>
          <strong className="text-[10px] tabular-nums text-violet-800">{moeda(l.comissao)}</strong>
        </span>
      </div>}
    </div>
  </article>;
}
