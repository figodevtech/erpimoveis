import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import { Car, ClipboardList, Power, ShoppingBag, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintShareMenu } from "../../../../components/PrintShareMenu";
import { fetchPrintColors } from "@/lib/print-config";
import { calcularScoreCliente, type ResumoFinanceiroCliente } from "@/lib/financeiro/score-cliente";
import { carregarTitulosDoCliente } from "@/lib/financeiro/titulos-cliente";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
};

const EMPTY = "-";

/**
 * Teto por seção. Um cliente antigo pode ter centenas de OS e o documento
 * viraria um calhamaço — quando o corte acontece, a folha diz explicitamente
 * quantos itens ficaram de fora em vez de mentir por omissão.
 */
const LIMITE_LINHAS = 300;
const LIMITE_TITULOS = 120;

/* ========= HELPERS DE FORMATAÇÃO ========= */

function fmtMoney(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtText(value?: string | number | null) {
  if (value == null) return EMPTY;
  const s = String(value).trim();
  return s ? s : EMPTY;
}

function fmtDoc(cpfCnpj: unknown) {
  const s = String(cpfCnpj ?? "").replace(/\D/g, "");
  if (!s) return EMPTY;
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return s;
}

function fmtPhone(value?: string | null) {
  const s = String(value ?? "").replace(/\D/g, "");
  if (!s) return EMPTY;
  if (s.length === 11) return s.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (s.length === 10) return s.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return s;
}

function fmtDate(value?: string | Date | null) {
  if (!value) return EMPTY;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ano, mes, dia] = value.split("-");
    return `${dia}/${mes}/${ano}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
}

function fmtDateTime(value?: string | Date | null) {
  if (!value) return EMPTY;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  });
}

function fmtEnum(value?: string | null) {
  if (!value) return EMPTY;
  return String(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function joinParts(parts: Array<string | null | undefined>, separator = ", ") {
  return parts
    .map((part) => (part ?? "").toString().trim())
    .filter((part) => part.length > 0)
    .join(separator);
}

function iniciais(nome?: string | null) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

/** Classe do selo de status, compartilhada por OS, venda e título. */
function classeStatus(status?: string | null) {
  const upper = String(status ?? "").toUpperCase();
  if (["FINALIZADA", "CONCLUIDO", "CONCLUIDA", "PAGO", "PAGO_EM_DIA", "PAGO_A_VISTA", "ORCAMENTO_APROVADO"].includes(upper)) return "selo selo-ok";
  if (["CANCELADA", "CANCELADO", "VENCIDO", "PAGO_EM_ATRASO", "ORCAMENTO_RECUSADO"].includes(upper)) return "selo selo-ruim";
  if (["PENDENTE", "PAGAMENTO", "APROVACAO_ORCAMENTO", "ORCAMENTO", "VENCE_HOJE"].includes(upper)) return "selo selo-atencao";
  return "selo";
}

const rotuloSituacao: Record<string, string> = {
  A_VENCER: "A vencer",
  VENCE_HOJE: "Vence hoje",
  VENCIDO: "Vencido",
  PAGO_A_VISTA: "Pago à vista",
  PAGO_EM_DIA: "Pago em dia",
  PAGO_EM_ATRASO: "Pago em atraso",
};

const rotuloClassificacao: Record<ResumoFinanceiroCliente["classificacao"], string> = {
  EXCELENTE: "Excelente",
  BOM: "Bom",
  ATENCAO: "Atenção",
  CRITICO: "Crítico",
  SEM_HISTORICO: "Sem histórico",
};

/** Descrição do alvo da OS: veículo, peça ou equipamento. */
function descreverAlvoOrdem(ordem: any) {
  if (ordem.alvo_tipo === "PECA") {
    return fmtText(ordem.peca?.titulo || ordem.peca?.descricao);
  }
  if (ordem.alvo_tipo === "EQUIPAMENTO") {
    return (
      joinParts(
        [
          ordem.equipamento_nome,
          ordem.equipamento_patrimonio ? `Patrimônio ${ordem.equipamento_patrimonio}` : null,
        ],
        " • ",
      ) || EMPTY
    );
  }
  if (!ordem.veiculo) return EMPTY;
  return (
    joinParts(
      [
        joinParts([ordem.veiculo.marca, ordem.veiculo.modelo], " "),
        ordem.veiculo.placa ? `Placa ${ordem.veiculo.placa}` : null,
      ],
      " • ",
    ) || EMPTY
  );
}

function tipoAlvo(alvo?: string | null) {
  if (alvo === "PECA") return "Peça";
  if (alvo === "EQUIPAMENTO") return "Equipamento";
  return "Veículo";
}

/* ========= BLOCOS ========= */

function Secao({
  numero,
  titulo,
  icone,
  contador,
  children,
}: {
  numero: string;
  titulo: string;
  icone: React.ReactNode;
  contador?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="secao">
      <div className="secao-titulo">
        <span className="secao-numero">{numero}</span>
        {icone}
        <span>{titulo}</span>
        {contador ? <span className="secao-contador">{contador}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-rotulo">{rotulo}</div>
      <div className="kpi-valor">{valor}</div>
      <div className="kpi-detalhe">{detalhe ?? " "}</div>
    </div>
  );
}

/** Rosca do Score. SVG inline para não depender de recurso externo na impressão. */
function ScoreDonut({ score }: { score: number | null }) {
  const raio = 42;
  const circunferencia = 2 * Math.PI * raio;
  const preenchido = circunferencia * (1 - (score ?? 0) / 100);

  return (
    <svg viewBox="0 0 110 110" className="score-donut" aria-hidden="true">
      <g transform="rotate(-90 55 55)">
        <circle cx="55" cy="55" r={raio} fill="none" stroke="#e2e8f0" strokeWidth="11" />
        {score != null && (
          <circle
            cx="55"
            cy="55"
            r={raio}
            fill="none"
            stroke="var(--brand-primary)"
            strokeLinecap="round"
            strokeWidth="11"
            strokeDasharray={circunferencia}
            strokeDashoffset={preenchido}
          />
        )}
      </g>
      <text x="55" y="59" textAnchor="middle" className="score-numero">
        {score ?? EMPTY}
      </text>
      <text x="55" y="72" textAnchor="middle" className="score-de">
        de 100
      </text>
    </svg>
  );
}

function LinhaVazia({ colSpan, texto }: { colSpan: number; texto: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="linha-vazia">
        {texto}
      </td>
    </tr>
  );
}

function NotaCorte({
  exibidos,
  total,
  plural,
}: {
  exibidos: number;
  total: number;
  plural: string;
}) {
  if (exibidos >= total) return null;
  return (
    <div className="nota-corte">
      Exibindo {exibidos} de {total} {plural}. Os demais foram omitidos por limite de página.
    </div>
  );
}

async function fetchEmpresa() {
  const { data, error } = await supabaseAdmin.from("empresa").select("*").single();
  if (error) {
    console.error("Erro ao buscar empresa no Supabase:", error);
    return null;
  }
  return data ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Histórico do Cliente #${id}` };
}

export default async function ClienteHistoricoPrintPage({ params }: PageProps) {
  const { id: idStr } = await params;
  const clienteId = Number(idStr);

  if (!Number.isInteger(clienteId)) notFound();

  const { data: cliente, error: clienteError } = await supabaseAdmin
    .from("cliente")
    .select(
      `id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone,
       endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep,
       status, rank, foto_url, createdat`,
    )
    .eq("id", clienteId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (clienteError || !cliente) {
    console.error("Erro ao carregar cliente:", clienteError);
    notFound();
  }

  const [veiculosResult, ordensResult, vendasResult, titulos] = await Promise.all([
    supabaseAdmin
      .from("veiculo")
      .select("id, placa, placa_formatada, marca, modelo, ano, cor, kmatual, tipo", {
        count: "exact",
      })
      .eq("clienteid", clienteId)
      .order("id", { ascending: false })
      .limit(LIMITE_LINHAS),
    supabaseAdmin
      .from("ordemservico")
      .select(
        `id, dataentrada, datasaida, status, descricao, orcamentototal, alvo_tipo,
         equipamento_nome, equipamento_patrimonio,
         peca:pecaid ( titulo, descricao ),
         veiculo:veiculoid ( placa, marca, modelo )`,
        { count: "exact" },
      )
      .eq("clienteid", clienteId)
      .order("id", { ascending: false })
      .limit(LIMITE_LINHAS),
    supabaseAdmin
      .from("venda")
      .select(
        "id, status, valortotal, datavenda, forma_pagamento, valor_frete, itens:vendaproduto(id)",
        { count: "exact" },
      )
      .eq("clienteid", clienteId)
      .order("datavenda", { ascending: false })
      .order("id", { ascending: false })
      .limit(LIMITE_LINHAS),
    carregarTitulosDoCliente(clienteId),
  ]);

  if (veiculosResult.error) console.error("Erro ao carregar veículos:", veiculosResult.error);
  if (ordensResult.error) console.error("Erro ao carregar ordens:", ordensResult.error);
  if (vendasResult.error) console.error("Erro ao carregar vendas:", vendasResult.error);

  const veiculos = (veiculosResult.data ?? []) as any[];
  const ordens = (ordensResult.data ?? []) as any[];
  const vendas = (vendasResult.data ?? []) as any[];
  const financeiro = calcularScoreCliente(titulos);

  // O `count` vem do banco e ignora o teto de linhas: o contador diz a verdade
  // mesmo quando a tabela impressa está cortada. Já as somas só conseguem
  // percorrer o que foi buscado, então são marcadas como parciais no corte.
  const totalVeiculos = veiculosResult.count ?? veiculos.length;
  const totalOrdens = ordensResult.count ?? ordens.length;
  const totalVendas = vendasResult.count ?? vendas.length;

  const somaOrdens = ordens.reduce((acc, o) => acc + toNumber(o.orcamentototal), 0);
  const somaVendas = vendas.reduce((acc, v) => acc + toNumber(v.valortotal), 0);
  const sufixoParcial = (exibidos: number, total: number) =>
    exibidos < total ? " (parcial)" : "";

  const empresa = await fetchEmpresa();
  const printColors = await fetchPrintColors();

  // A empresa saiu do cabeçalho; sobra como assinatura discreta no rodapé.
  const empresaNome = empresa?.nomefantasia || empresa?.razaosocial || "Oficina Mecânica";

  const nomeCliente = fmtText(cliente.nomerazaosocial);
  const contatoCliente = joinParts(
    [fmtPhone(cliente.telefone), fmtText(cliente.email)].filter((v) => v !== EMPTY),
    " • ",
  );
  const localCliente = joinParts([cliente.bairro, cliente.cidade, cliente.estado], " • ");

  return (
    <div className="cliente-print-root">
      <Script id="cliente-historico-a4-autoscale" strategy="afterInteractive">{`
        (function () {
          function mmParaPx(mm) { return (mm * 96) / 25.4; }

          function lerVarNumericaPx(nomeVar, fallbackPx) {
            try {
              var val = getComputedStyle(document.documentElement).getPropertyValue(nomeVar).trim();
              if (!val) return fallbackPx;
              if (val.endsWith('px')) return parseFloat(val);
              if (val.endsWith('mm')) return mmParaPx(parseFloat(val));
              return fallbackPx;
            } catch { return fallbackPx; }
          }

          function aplicarEscala() {
            var a4w = lerVarNumericaPx('--a4w', 794);
            var margem = 16;
            var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            var disponivel = Math.max(320, vw - margem);
            var scale = Math.min(1, disponivel / a4w);

            document.documentElement.style.setProperty('--os-scale', String(scale));
          }

          aplicarEscala();
          window.addEventListener('resize', aplicarEscala, { passive: true });
          window.addEventListener('orientationchange', aplicarEscala);

          window.addEventListener('beforeprint', function () {
            document.documentElement.style.setProperty('--os-scale', '1');
          });
          window.addEventListener('afterprint', aplicarEscala);
        })();
      `}</Script>

      <style>{`
  :root{
    --brand-primary:${printColors.primary};
    --brand-secondary:${printColors.secondary};

    --ink:#0f172a;
    --muted:#64748b;
    --faint:#94a3b8;
    --border:#cbd5e1;
    --paper:#ffffff;
    --soft-bg:#f8fafc;

    --primary-soft: color-mix(in srgb, var(--brand-primary) 8%, transparent);
    --secondary-soft: color-mix(in srgb, var(--brand-secondary) 10%, transparent);

    --radius: 12px;

    --a4w: 794px;
    --a4h: 1123px;
    --os-scale: 1;
  }

  @media print{
    :root{ --a4w: 210mm; --a4h: 297mm; }
  }

  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  @page{ size:A4; margin:0; }

  .cliente-print-root{
    min-height:100vh;
    padding:20px 0;
    background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    overflow-x:auto;
    -webkit-overflow-scrolling: touch;
  }

  .toolbar{
    width: min(var(--a4w), calc(100vw - 16px));
    margin: 0 auto 16px;
    display:flex;
    align-items:flex-end;
    justify-content:space-between;
    gap:8px;
    padding: 0 8px;
  }

  .folha-scaler{
    position:relative;
    width: calc(var(--a4w) * var(--os-scale));
    min-height: calc(var(--a4h) * var(--os-scale));
    height:auto;
    margin: 0 auto;
  }

  .folha{
    width: var(--a4w);
    min-height: var(--a4h);
    height:auto;
    background: var(--paper);
    border: 1px solid var(--border);
    box-shadow: 0 20px 60px rgba(15,23,42,.15);
    overflow:visible;
    display:flex;
    flex-direction:column;
    position:static;
    zoom: var(--os-scale);
  }

  .conteudo{
    padding: 9mm;
    flex: 1 0 auto;
    display:flex;
    flex-direction:column;
    gap: 10px;
  }

  /* ===== CABEÇALHO ===== */

  .header{
    background: linear-gradient(135deg, var(--brand-primary), var(--brand-secondary));
    padding: 14px 16px;
    color:#fff;
    display:grid;
    grid-template-columns: auto 1fr auto;
    gap:16px;
    align-items:center;
  }

  .titular-foto{
    width:70px; height:70px; background:#fff; border-radius:10px;
    display:flex; align-items:center; justify-content:center; overflow:hidden;
    font-weight:800; font-size:22px; color: var(--brand-primary);
    box-shadow: 0 4px 12px rgba(0,0,0,.15);
  }
  .titular-foto img{ width:100%; height:100%; object-fit:cover; }

  .titular-nome{
    font-size:18px; font-weight:700; margin-bottom:4px;
    line-height:1.15; overflow-wrap:anywhere;
  }
  .titular-details{ font-size:9px; opacity:.95; line-height:1.4; overflow-wrap:anywhere; }

  .doc-box{
    background: rgba(255,255,255,.15);
    border:1px solid rgba(255,255,255,.3);
    border-radius:10px;
    padding:10px 14px;
    text-align:right;
    min-width:150px;
  }
  .doc-label{ font-size:8px; text-transform:uppercase; letter-spacing:.2em; font-weight:800; opacity:.9; }
  .doc-numero{ font-size:28px; font-weight:900; line-height:1; margin:4px 0 2px; letter-spacing:-.02em; }
  .doc-data{ font-size:8px; opacity:.9; font-weight:600; }

  /* ===== FAIXA DE SITUAÇÃO ===== */

  /* Nome, documento e foto vivem no cabeçalho; aqui fica só a situação. */
  .identidade{
    display:flex;
    flex-flow:row wrap;
    gap:5px;
    align-items:center;
    border:1px solid color-mix(in srgb, var(--brand-primary) 30%, var(--border));
    border-radius: var(--radius);
    background: linear-gradient(135deg, var(--primary-soft), var(--secondary-soft));
    padding:8px 12px;
  }

  .chips{ display:flex; flex-flow:row wrap; gap:5px; align-items:center; }
  .chip{
    border:1px solid var(--border); background:#fff; border-radius:999px;
    padding:3px 10px; font-size:8px; font-weight:800;
    text-transform:uppercase; letter-spacing:.1em; color: var(--muted); white-space:nowrap;
  }
  .chip-forte{ border-color: var(--brand-primary); color: var(--brand-primary); background: var(--primary-soft); }

  /* ===== KPIs ===== */

  .kpis{ display:grid; grid-template-columns: repeat(6, 1fr); gap:6px; }

  .kpi{
    border:1px solid var(--border);
    border-radius:8px;
    background: var(--soft-bg);
    padding:7px 8px;
    text-align:center;
  }
  .kpi-rotulo{
    font-size:7.5px; text-transform:uppercase; letter-spacing:.12em;
    color: var(--muted); font-weight:700; margin-bottom:3px;
  }
  .kpi-valor{ font-size:13px; font-weight:800; color: var(--ink); letter-spacing:-.01em; }
  .kpi-detalhe{ font-size:7.5px; color: var(--faint); margin-top:2px; }

  /* ===== SEÇÕES ===== */

  .secao{
    border:1px solid var(--border);
    border-radius: var(--radius);
    background:#fff;
    padding:10px 12px 12px;
  }

  .secao-titulo{
    display:flex; align-items:center; gap:8px;
    padding-bottom:6px; margin-bottom:10px;
    border-bottom:2px solid var(--border);
    font-size:10px; font-weight:800;
    text-transform:uppercase; letter-spacing:.1em;
    color: var(--brand-primary);
  }

  .secao-numero{
    display:inline-flex; align-items:center; justify-content:center;
    min-width:18px; height:18px; padding:0 4px; border-radius:5px;
    background: var(--brand-primary); color:#fff;
    font-size:9px; font-weight:900; letter-spacing:.06em;
  }

  .secao-contador{
    margin-left:auto;
    color: var(--muted);
    font-weight:700;
    letter-spacing:.06em;
  }

  /* ===== TABELAS ===== */

  table{ width:100%; border-collapse:collapse; }

  thead th{
    font-size:8px; text-transform:uppercase; letter-spacing:.1em;
    font-weight:800; color: var(--muted);
    padding:5px 6px; text-align:left;
    border-bottom:1px solid var(--border);
    background: var(--soft-bg);
  }

  tbody td{
    font-size:9px;
    padding:5px 6px;
    border-bottom:1px solid #eef2f7;
    vertical-align:top;
  }
  tbody tr:last-child td{ border-bottom:none; }

  .num{ text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .centro{ text-align:center; }
  .id{ font-weight:800; color: var(--muted); white-space:nowrap; }
  .nowrap{ white-space:nowrap; }

  .linha-vazia{
    text-align:center;
    color: var(--faint);
    font-style:italic;
    padding:14px 6px;
  }

  .selo{
    display:inline-block;
    border:1px solid var(--border);
    border-radius:999px;
    padding:1px 7px;
    font-size:7.5px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.06em;
    color: var(--muted);
    white-space:nowrap;
  }
  .selo-ok{ border-color:#86efac; background:#f0fdf4; color:#15803d; }
  .selo-ruim{ border-color:#fca5a5; background:#fef2f2; color:#b91c1c; }
  .selo-atencao{ border-color:#fcd34d; background:#fffbeb; color:#b45309; }

  .nota-corte{
    margin-top:6px;
    font-size:8px;
    color: var(--muted);
    font-style:italic;
    text-align:center;
  }

  /* ===== FINANCEIRO ===== */

  .financeiro-topo{
    display:grid;
    grid-template-columns: 132px 1fr;
    gap:12px;
    align-items:center;
    margin-bottom:10px;
  }

  .score-caixa{
    border:1px solid var(--border);
    border-radius:10px;
    background: var(--soft-bg);
    padding:8px;
    text-align:center;
  }
  .score-donut{ width:100%; height:auto; display:block; }
  .score-numero{ font-size:26px; font-weight:800; fill: var(--ink); }
  .score-de{ font-size:8px; fill: var(--muted); }
  .score-classificacao{
    margin-top:4px;
    font-size:9px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.1em;
    color: var(--brand-primary);
  }
  .score-teto{
    margin-top:6px;
    padding-top:6px;
    border-top:1px solid var(--border);
    font-size:8px;
    line-height:1.35;
    color: var(--muted);
  }

  .financeiro-kpis{ display:grid; grid-template-columns: repeat(2, 1fr); gap:6px; }

  /* ===== RODAPÉ ===== */

  .rodape{ margin-top:auto; padding-top:10px; }

  .creditos{
    display:flex; justify-content:space-between; gap:8px;
    font-size:7.5px; color: var(--faint); letter-spacing:.04em;
    border-top:1px solid var(--border); padding-top:6px;
  }

  /* ===== IMPRESSÃO ===== */

  @media print{
    @page{ size:A4; margin: 10mm 0 8mm; }
    @page :first{ margin-top: 8mm; }

    html, body{
      margin:0 !important; padding:0 !important; background:#fff !important;
      height:auto !important; max-height:none !important; overflow:visible !important;
    }

    .no-print{ display:none !important; }

    .cliente-print-root{
      padding:0 !important; background:none !important;
      min-height:auto !important; overflow:visible !important;
    }

    .folha-scaler{
      position:static !important; width:auto !important;
      min-height:auto !important; height:auto !important; margin:0 !important;
    }

    .folha{
      width:210mm !important; min-height:auto !important; height:auto !important;
      max-height:none !important; margin:0 !important;
      border:0 !important; border-radius:0 !important; box-shadow:none !important;
      overflow:visible !important; background:#fff !important;
      position:static !important; transform:none !important; zoom:1 !important;
      inset:auto !important; display:block !important;
    }

    .conteudo{
      padding: 8mm !important; height:auto !important;
      min-height:auto !important; max-height:none !important;
      display:block !important; overflow:visible !important;
    }

    .conteudo > * + *{ margin-top: 10px; }

    .header, .identidade, .kpis, .financeiro-topo, .creditos{
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* A seção pode quebrar entre páginas; a linha da tabela, não. */
    .secao{ break-inside: auto; page-break-inside: auto; }
    .secao-titulo{ break-after: avoid; page-break-after: avoid; }

    table, tbody{ break-inside: auto; page-break-inside: auto; }
    thead{ display: table-header-group; }
    tbody{ display: table-row-group; }
    tr{ break-inside: avoid; page-break-inside: avoid; }
    td, th{ orphans:3; widows:3; }

    .rodape{ margin-top: 18px !important; }

    *{ box-shadow:none !important; text-shadow:none !important; outline:0 !important; }

    body{ zoom:1 !important; }
  }
`}</style>

      <div className="toolbar no-print">
        <div>
          <div
            className="text-[9px]"
            style={{ textTransform: "uppercase", letterSpacing: ".32em", fontWeight: 800, color: "#64748b" }}
          >
            Histórico do Cliente
          </div>
          <div className="text-[10px] md:text-xs" style={{ fontWeight: 700 }}>
            Visualização de Impressão
          </div>
        </div>

        <div className="flex flex-row items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="!border-slate-300 !bg-white !text-slate-900 hover:!bg-slate-100 hover:!text-slate-900 hover:cursor-pointer"
          >
            <Link href="/clientes">
              <Power className="w-3 h-3" />
              Sair
            </Link>
          </Button>

          <PrintShareMenu documentId={cliente.id} filenamePrefix="historico-cliente" />
        </div>
      </div>

      <div className="folha-scaler">
        <div className="folha" data-print-export-target>
          <div className="header">
            <div className="titular-foto">
              {cliente.foto_url ? (
                /* Foto do cliente vem do storage e não passa pelo otimizador. */
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cliente.foto_url} alt={`Foto de ${nomeCliente}`} />
              ) : (
                iniciais(cliente.nomerazaosocial)
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              <div className="titular-nome">{nomeCliente.toUpperCase()}</div>
              <div className="titular-details">
                <div>
                  {cliente.tipopessoa === "JURIDICA" ? "CNPJ" : "CPF"}: {fmtDoc(cliente.cpfcnpj)}
                  {" • Cliente desde "}
                  {fmtDate(cliente.createdat)}
                </div>
                <div>{contatoCliente || EMPTY}</div>
                <div>{localCliente || EMPTY}</div>
              </div>
            </div>

            <div className="doc-box">
              <div className="doc-label">Histórico</div>
              <div className="doc-numero">#{cliente.id}</div>
              <div className="doc-data">Emitido em {fmtDateTime(new Date())}</div>
            </div>
          </div>

          <div className="conteudo">
            <div className="identidade">
              <div className="chips">
                <span className="chip chip-forte">
                  {cliente.tipopessoa === "JURIDICA" ? "Pessoa Jurídica" : "Pessoa Física"}
                </span>
                <span className="chip">Status: {fmtEnum(cliente.status)}</span>
                <span className="chip">Classificação: {fmtEnum(cliente.rank)}</span>
              </div>
            </div>

            <div className="kpis">
              <Kpi rotulo="Veículos" valor={String(totalVeiculos)} />
              <Kpi
                rotulo="Ordens"
                valor={String(totalOrdens)}
                detalhe={fmtMoney(somaOrdens) + sufixoParcial(ordens.length, totalOrdens)}
              />
              <Kpi
                rotulo="Vendas"
                valor={String(totalVendas)}
                detalhe={fmtMoney(somaVendas) + sufixoParcial(vendas.length, totalVendas)}
              />
              <Kpi
                rotulo="Em aberto"
                valor={fmtMoney(financeiro.totalEmAberto)}
                detalhe={`${financeiro.quantidadeEmAberto} título(s)`}
              />
              <Kpi
                rotulo="Vencido"
                valor={fmtMoney(financeiro.totalVencido)}
                detalhe={`${financeiro.quantidadeVencida} em atraso`}
              />
              <Kpi
                rotulo="Score"
                valor={financeiro.score == null ? EMPTY : String(financeiro.score)}
                detalhe={rotuloClassificacao[financeiro.classificacao]}
              />
            </div>

            <Secao
              numero="01"
              titulo="Veículos"
              icone={<Car className="w-3.5 h-3.5" />}
              contador={`${totalVeiculos} registro(s)`}
            >
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>ID</th>
                    <th style={{ width: 90 }}>Placa</th>
                    <th>Marca / Modelo</th>
                    <th style={{ width: 60 }}>Ano</th>
                    <th style={{ width: 80 }}>Cor</th>
                    <th style={{ width: 90 }} className="num">
                      KM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {veiculos.length > 0 ? (
                    veiculos.slice(0, LIMITE_LINHAS).map((veiculo) => (
                      <tr key={veiculo.id}>
                        <td className="id">#{veiculo.id}</td>
                        <td className="nowrap">{fmtText(veiculo.placa || veiculo.placa_formatada)}</td>
                        <td>{joinParts([veiculo.marca, veiculo.modelo], " ") || EMPTY}</td>
                        <td>{fmtText(veiculo.ano)}</td>
                        <td>{fmtText(veiculo.cor)}</td>
                        <td className="num">
                          {veiculo.kmatual == null
                            ? EMPTY
                            : `${Number(veiculo.kmatual).toLocaleString("pt-BR")} km`}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <LinhaVazia colSpan={6} texto="Nenhum veículo vinculado a este cliente." />
                  )}
                </tbody>
              </table>
              <NotaCorte exibidos={veiculos.length} total={totalVeiculos} plural="veículos" />
            </Secao>

            <Secao
              numero="02"
              titulo="Ordens de Serviço"
              icone={<ClipboardList className="w-3.5 h-3.5" />}
              contador={`${totalOrdens} registro(s) • ${fmtMoney(somaOrdens)}${sufixoParcial(ordens.length, totalOrdens)}`}
            >
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>ID</th>
                    <th style={{ width: 62 }}>Entrada</th>
                    <th style={{ width: 62 }}>Saída</th>
                    <th style={{ width: 62 }}>Alvo</th>
                    <th>Objeto</th>
                    <th>Descrição</th>
                    <th style={{ width: 74 }}>Status</th>
                    <th style={{ width: 80 }} className="num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordens.length > 0 ? (
                    ordens.slice(0, LIMITE_LINHAS).map((ordem) => (
                      <tr key={ordem.id}>
                        <td className="id">#{ordem.id}</td>
                        <td className="nowrap">{fmtDate(ordem.dataentrada)}</td>
                        <td className="nowrap">{fmtDate(ordem.datasaida)}</td>
                        <td>{tipoAlvo(ordem.alvo_tipo)}</td>
                        <td>{descreverAlvoOrdem(ordem)}</td>
                        <td>{fmtText(ordem.descricao)}</td>
                        <td>
                          <span className={classeStatus(ordem.status)}>{fmtEnum(ordem.status)}</span>
                        </td>
                        <td className="num">{fmtMoney(ordem.orcamentototal)}</td>
                      </tr>
                    ))
                  ) : (
                    <LinhaVazia colSpan={8} texto="Nenhuma ordem de serviço registrada para este cliente." />
                  )}
                </tbody>
              </table>
              <NotaCorte exibidos={ordens.length} total={totalOrdens} plural="ordens" />
            </Secao>

            <Secao
              numero="03"
              titulo="Vendas"
              icone={<ShoppingBag className="w-3.5 h-3.5" />}
              contador={`${totalVendas} registro(s) • ${fmtMoney(somaVendas)}${sufixoParcial(vendas.length, totalVendas)}`}
            >
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>ID</th>
                    <th style={{ width: 70 }}>Data</th>
                    <th style={{ width: 80 }}>Status</th>
                    <th>Forma de pagamento</th>
                    <th style={{ width: 50 }} className="centro">
                      Itens
                    </th>
                    <th style={{ width: 80 }} className="num">
                      Frete
                    </th>
                    <th style={{ width: 90 }} className="num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vendas.length > 0 ? (
                    vendas.slice(0, LIMITE_LINHAS).map((venda) => (
                      <tr key={venda.id}>
                        <td className="id">#{venda.id}</td>
                        <td className="nowrap">{fmtDate(venda.datavenda)}</td>
                        <td>
                          <span className={classeStatus(venda.status)}>{fmtEnum(venda.status)}</span>
                        </td>
                        <td>{fmtEnum(venda.forma_pagamento)}</td>
                        <td className="centro">
                          {Array.isArray(venda.itens) ? venda.itens.length : 0}
                        </td>
                        <td className="num">{fmtMoney(venda.valor_frete)}</td>
                        <td className="num">{fmtMoney(venda.valortotal)}</td>
                      </tr>
                    ))
                  ) : (
                    <LinhaVazia colSpan={7} texto="Nenhuma venda registrada para este cliente." />
                  )}
                </tbody>
              </table>
              <NotaCorte exibidos={vendas.length} total={totalVendas} plural="vendas" />
            </Secao>

            <Secao
              numero="04"
              titulo="Financeiro"
              icone={<WalletCards className="w-3.5 h-3.5" />}
              contador={`${financeiro.titulos.length} título(s)`}
            >
              <div className="financeiro-topo">
                <div className="score-caixa">
                  <ScoreDonut score={financeiro.score} />
                  <div className="score-classificacao">
                    {rotuloClassificacao[financeiro.classificacao]}
                  </div>
                  {financeiro.tetoAplicado != null && (
                    <div className="score-teto">
                      Limitado a {financeiro.tetoAplicado} por título vencido há{" "}
                      {financeiro.maiorAtrasoEmAberto ?? 0} dia(s). Só pelo histórico seria{" "}
                      {financeiro.scoreBase}.
                    </div>
                  )}
                </div>

                <div className="financeiro-kpis">
                  <Kpi
                    rotulo="Total recebido"
                    valor={fmtMoney(financeiro.totalRecebido)}
                    detalhe="Receitas de OS e vendas"
                  />
                  <Kpi
                    rotulo="A vencer"
                    valor={fmtMoney(financeiro.totalAVencer)}
                    detalhe="Compromissos futuros"
                  />
                  <Kpi
                    rotulo="Pagamentos em dia"
                    valor={
                      financeiro.percentualPagoEmDia == null
                        ? EMPTY
                        : `${financeiro.percentualPagoEmDia}%`
                    }
                    detalhe={`${financeiro.quantidadeAvaliada} título(s) avaliado(s)`}
                  />
                  <Kpi
                    rotulo="Média de atraso"
                    valor={
                      financeiro.mediaDiasAtraso == null
                        ? EMPTY
                        : `${financeiro.mediaDiasAtraso} dia(s)`
                    }
                    detalhe="Sobre os títulos já pagos"
                  />
                </div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>ID</th>
                    <th style={{ width: 80 }}>Origem</th>
                    <th style={{ width: 70 }}>Vencimento</th>
                    <th style={{ width: 70 }}>Pagamento</th>
                    <th>Método</th>
                    <th style={{ width: 84 }}>Situação</th>
                    <th style={{ width: 54 }} className="centro">
                      Atraso
                    </th>
                    <th style={{ width: 90 }} className="num">
                      Valor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {financeiro.titulos.length > 0 ? (
                    financeiro.titulos.slice(0, LIMITE_TITULOS).map((titulo) => (
                      <tr key={titulo.id}>
                        <td className="id">#{titulo.id}</td>
                        <td className="nowrap">
                          {titulo.ordemServicoId
                            ? `OS #${titulo.ordemServicoId}`
                            : titulo.vendaId
                              ? `Venda #${titulo.vendaId}`
                              : EMPTY}
                        </td>
                        <td className="nowrap">{fmtDate(titulo.vencimentoEm)}</td>
                        <td className="nowrap">{fmtDate(titulo.pagoEm)}</td>
                        <td>{fmtEnum(titulo.metodoPagamento)}</td>
                        <td>
                          <span className={classeStatus(titulo.situacao)}>
                            {rotuloSituacao[titulo.situacao] ?? fmtEnum(titulo.situacao)}
                          </span>
                        </td>
                        <td className="centro">
                          {titulo.diasAtraso > 0 ? `${titulo.diasAtraso}d` : EMPTY}
                        </td>
                        <td className="num">{fmtMoney(titulo.valor)}</td>
                      </tr>
                    ))
                  ) : (
                    <LinhaVazia
                      colSpan={8}
                      texto="Nenhum título de OS ou venda encontrado para este cliente."
                    />
                  )}
                </tbody>
              </table>
              <NotaCorte
                exibidos={Math.min(financeiro.titulos.length, LIMITE_TITULOS)}
                total={financeiro.titulos.length}
                plural="títulos"
              />
            </Secao>

            <div className="rodape">
              <div className="creditos">
                <span>
                  {empresaNome} — Histórico do cliente #{cliente.id}
                </span>
                <span>Emitido em {fmtDateTime(new Date())}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
