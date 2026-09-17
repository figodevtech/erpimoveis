import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import { FileText, IdCard, MapPin, Phone, Power, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintShareMenu } from "../../../components/PrintShareMenu";
import { fetchPrintColors } from "@/lib/print-config";
import { normalizarIndIEDest, INDICADORES_IE_DEST } from "@/lib/nfe/indIEDest";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";
import { calcularScoreCliente, type ResumoFinanceiroCliente } from "@/lib/financeiro/score-cliente";
import { carregarTitulosDoCliente } from "@/lib/financeiro/titulos-cliente";
import { formatCpfCnpj } from "@/lib/nfe/recipientNormalization";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
};

const EMPTY = "-";

const CLIENTE_FIELDS = `
  id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone,
  endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep,
  inscricaoestadual, inscricaomunicipal, codigomunicipio, ind_ie_dest,
  status, rank, foto_url, createdat, updatedat
`;

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
  return formatCpfCnpj(cpfCnpj) || EMPTY;
}

function fmtPhone(value?: string | null) {
  const s = String(value ?? "").replace(/\D/g, "");
  if (!s) return EMPTY;
  if (s.length === 11) return s.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (s.length === 10) return s.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return s;
}

function fmtCep(value?: string | null) {
  const s = String(value ?? "").replace(/\D/g, "");
  if (!s) return EMPTY;
  if (s.length === 8) return s.replace(/(\d{5})(\d{3})/, "$1-$2");
  return s;
}

function fmtDate(value?: string | Date | null) {
  if (!value) return EMPTY;
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

/** Rótulo do indicador de IE do destinatário (indIEDest da NF-e). */
function fmtIndicadorIe(value: unknown) {
  const indicador = normalizarIndIEDest(value);
  if (indicador == null) return EMPTY;
  return INDICADORES_IE_DEST.find((item) => item.valor === indicador)?.rotulo ?? EMPTY;
}

function iniciais(nome?: string | null) {
  const partes = String(nome ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

function joinParts(parts: Array<string | null | undefined>, separator = ", ") {
  return parts
    .map((part) => (part ?? "").toString().trim())
    .filter((part) => part.length > 0)
    .join(separator);
}

/* ========= BLOCOS ========= */

/**
 * Campo do formulário. Nunca some da folha: sem valor, imprime o traço em tom
 * apagado — a lacuna visível é informação (o cadastro está incompleto).
 */
function Campo({
  rotulo,
  valor,
  span = 4,
}: {
  rotulo: string;
  valor: string;
  span?: 3 | 4 | 6 | 8 | 12;
}) {
  const vazio = valor === EMPTY;

  return (
    <div className={`campo campo-${span}`}>
      <div className="campo-rotulo">{rotulo}</div>
      <div className={`campo-valor${vazio ? " campo-vazio" : ""}`}>{valor}</div>
    </div>
  );
}

const rotuloClassificacao: Record<ResumoFinanceiroCliente["classificacao"], string> = {
  EXCELENTE: "Excelente",
  BOM: "Bom",
  ATENCAO: "Atenção",
  CRITICO: "Crítico",
  SEM_HISTORICO: "Sem histórico",
};

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

/** Célula do painel financeiro: rótulo, valor e um detalhe opcional embaixo. */
function FinItem({
  rotulo,
  valor,
  detalhe,
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  alerta?: boolean;
}) {
  return (
    <div className="fin-item">
      <div className="fin-rotulo">{rotulo}</div>
      <div className={`fin-valor${alerta ? " fin-valor-alerta" : ""}`}>{valor}</div>
      <div className="fin-detalhe">{detalhe ?? " "}</div>
    </div>
  );
}

function Secao({
  numero,
  titulo,
  icone,
  children,
}: {
  numero: string;
  titulo: string;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="secao">
      <div className="secao-titulo">
        <span className="secao-numero">{numero}</span>
        {icone}
        {titulo}
      </div>
      <div className="campos">{children}</div>
    </section>
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
  return { title: `Ficha Cadastral - Cliente #${id}` };
}

export default async function ClientePrintPage({ params }: PageProps) {
  const { id: idStr } = await params;
  const clienteId = Number(idStr);

  if (!Number.isInteger(clienteId)) notFound();

  const { data: cliente, error: clienteError } = await supabaseAdmin
    .from("cliente")
    .select(CLIENTE_FIELDS)
    .eq("id", clienteId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (clienteError || !cliente) {
    console.error("Erro ao carregar cliente:", clienteError);
    notFound();
  }

  const empresa = await fetchEmpresa();
  const printColors = await fetchPrintColors();

  // Mesmo Score da aba Financeiro e da folha de histórico: uma única regra de
  // cálculo, em `calcularScoreCliente`.
  const financeiro = calcularScoreCliente(await carregarTitulosDoCliente(clienteId));

  const juridica = cliente.tipopessoa === "JURIDICA";
  // A empresa saiu do cabeçalho; sobra como assinatura discreta no rodapé.
  const empresaNome = empresa?.nomefantasia || empresa?.razaosocial || "Oficina Mecânica";

  const nomeCliente = fmtText(cliente.nomerazaosocial);
  const statusTexto = fmtEnum(cliente.status);
  // Sem a seção fiscal, "Registro no Sistema" sobe de 05 para 04.
  const numeroRegistro = juridica ? "05" : "04";
  const enderecoResumo = joinParts(
    [
      cliente.endereco,
      cliente.endereconumero ? `Nº ${cliente.endereconumero}` : null,
      cliente.enderecocomplemento,
      cliente.bairro,
      joinParts([cliente.cidade, cliente.estado], "/"),
    ],
    " • ",
  );

  return (
    <div className="cliente-print-root">
      {/* Auto-scale do A4 no preview (a impressão sempre volta para escala 1) */}
      <Script id="cliente-a4-autoscale" strategy="afterInteractive">{`
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
    --brand-header-text:${printColors.text};

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
    gap: 8px;
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

  /* ===== CABEÇALHO DA EMPRESA ===== */

  .header{
    background: linear-gradient(135deg, var(--brand-primary), var(--brand-secondary));
    padding: 14px 16px;
    color:var(--brand-header-text, #ffffff);
    display:grid;
    grid-template-columns: auto 1fr auto;
    gap: 16px;
    align-items:center;
  }

  .titular-foto{
    width:70px;
    height:70px;
    background:#fff;
    border-radius:10px;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:hidden;
    font-weight:800;
    font-size:22px;
    color: var(--brand-primary);
    box-shadow: 0 4px 12px rgba(0,0,0,.15);
  }
  .titular-foto img{ width:100%; height:100%; object-fit:cover; }

  .titular-nome{
    font-size:18px;
    font-weight:700;
    margin-bottom:4px;
    line-height:1.15;
    overflow-wrap:anywhere;
  }
  .titular-details{ font-size:9px; opacity:.95; line-height:1.4; overflow-wrap:anywhere; }

  .doc-box{
    background: color-mix(in srgb, var(--brand-header-text, #ffffff) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--brand-header-text, #ffffff) 30%, transparent);
    border-radius:10px;
    padding: 10px 14px;
    text-align:right;
    min-width: 150px;
  }
  .doc-label{
    font-size:8px;
    text-transform:uppercase;
    letter-spacing:.2em;
    font-weight:800;
    opacity:.9;
  }
  .doc-numero{
    font-size:28px;
    font-weight:900;
    line-height:1;
    margin:4px 0 2px;
    letter-spacing:-.02em;
  }
  .doc-data{ font-size:8px; opacity:.9; font-weight:600; }

  /* ===== FAIXA DE SITUAÇÃO ===== */

  /* Nome, documento e foto vivem no cabeçalho; aqui ficam só os chips que
     classificam o cliente. */
  .identidade{
    display:flex;
    flex-flow:row wrap;
    gap: 5px;
    align-items:center;
    border:1px solid color-mix(in srgb, var(--brand-primary) 30%, var(--border));
    border-radius: var(--radius);
    background: linear-gradient(135deg, var(--primary-soft), var(--secondary-soft));
    padding: 10px 12px;
  }

  .chips{ display:flex; flex-flow:row wrap; gap:5px; align-items:center; }

  /* ===== PAINEL FINANCEIRO ===== */

  .financeiro-card{
    display:flex;
    gap:12px;
    align-items:center;
    border:1px solid var(--border);
    border-radius:10px;
    background:#fff;
    padding:8px 12px;
  }

  .score-bloco{
    width:86px;
    flex:none;
    text-align:center;
    border-right:1px solid var(--border);
    padding-right:12px;
  }

  /* O card ocupa a largura da folha, então os seis números cabem em 3x2. */
  .fin-grid{
    flex:1;
    display:grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 18px;
  }

  .fin-item{ min-width:0; }
  .fin-rotulo{
    font-size:7px;
    text-transform:uppercase;
    letter-spacing:.12em;
    font-weight:800;
    color: var(--faint);
  }
  .fin-valor{
    font-size:11px;
    font-weight:800;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    line-height:1.25;
  }
  .fin-valor-alerta{ color:#b91c1c; }
  .fin-detalhe{ font-size:7px; color: var(--muted); line-height:1.2; }

  .score-rotulo{
    font-size:7.5px;
    text-transform:uppercase;
    letter-spacing:.14em;
    font-weight:800;
    color: var(--faint);
    margin-bottom:2px;
  }
  .score-donut{ width:100%; height:auto; display:block; }
  .score-numero{ font-size:26px; font-weight:800; fill: var(--ink); }
  .score-de{ font-size:8px; fill: var(--muted); }
  .score-classificacao{
    margin-top:3px;
    font-size:8px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.08em;
    color: var(--brand-primary);
  }

  .chip{
    border:1px solid var(--border);
    background:#fff;
    border-radius:999px;
    padding: 3px 10px;
    font-size:8px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.1em;
    color: var(--muted);
    white-space:nowrap;
  }
  .chip-forte{
    border-color: var(--brand-primary);
    color: var(--brand-primary);
    background: var(--primary-soft);
  }

  /* ===== SEÇÕES / CAMPOS ===== */

  .secao{
    border:1px solid var(--border);
    border-radius: var(--radius);
    background:#fff;
    padding: 10px 12px 12px;
  }

  .secao-titulo{
    display:flex;
    align-items:center;
    gap:8px;
    padding-bottom:6px;
    margin-bottom:10px;
    border-bottom: 2px solid var(--border);
    font-size:10px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.1em;
    color: var(--brand-primary);
  }

  .secao-numero{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    min-width:18px;
    height:18px;
    padding:0 4px;
    border-radius:5px;
    background: var(--brand-primary);
    color:#fff;
    font-size:9px;
    font-weight:900;
    letter-spacing:.06em;
  }

  .campos{
    display:grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 10px 12px;
  }

  .campo-3{ grid-column: span 3; }
  .campo-4{ grid-column: span 4; }
  .campo-6{ grid-column: span 6; }
  .campo-8{ grid-column: span 8; }
  .campo-12{ grid-column: span 12; }

  .campo{ min-width:0; }

  .campo-rotulo{
    font-size:7.5px;
    text-transform:uppercase;
    letter-spacing:.14em;
    font-weight:800;
    color: var(--faint);
    margin-bottom:3px;
  }

  .campo-valor{
    font-size:11px;
    font-weight:600;
    line-height:1.3;
    min-height:17px;
    padding-bottom:3px;
    border-bottom:1px dashed var(--border);
    overflow-wrap:anywhere;
  }

  .campo-vazio{ color: var(--faint); font-weight:500; }

  /* ===== RODAPÉ ===== */

  .rodape{
    margin-top:auto;
    padding-top: 10px;
    display:flex;
    flex-direction:column;
    gap: 12px;
  }

  .creditos{
    display:flex;
    justify-content:space-between;
    gap:8px;
    font-size:7.5px;
    color: var(--faint);
    letter-spacing:.04em;
    border-top:1px solid var(--border);
    padding-top:6px;
  }

  /* ===== IMPRESSÃO ===== */

  @media print{
    @page{ size:A4; margin: 10mm 0 8mm; }
    @page :first{ margin-top: 8mm; }

    html, body{
      margin:0 !important;
      padding:0 !important;
      background:#fff !important;
      height:auto !important;
      max-height:none !important;
      overflow:visible !important;
    }

    .no-print{ display:none !important; }

    .cliente-print-root{
      padding:0 !important;
      background:none !important;
      min-height:auto !important;
      overflow:visible !important;
    }

    .folha-scaler{
      position:static !important;
      width:auto !important;
      min-height:auto !important;
      height:auto !important;
      margin:0 !important;
    }

    .folha{
      width:210mm !important;
      min-height:auto !important;
      height:auto !important;
      max-height:none !important;
      margin:0 !important;
      border:0 !important;
      border-radius:0 !important;
      box-shadow:none !important;
      overflow:visible !important;
      background:#fff !important;
      position:static !important;
      transform:none !important;
      zoom:1 !important;
      inset:auto !important;
      display:block !important;
    }

    .conteudo{
      padding: 8mm !important;
      height:auto !important;
      min-height:auto !important;
      max-height:none !important;
      display:block !important;
      overflow:visible !important;
    }

    .conteudo > * + *{ margin-top: 10px; }

    .header,
    .identidade,
    .secao,
    .financeiro-card,
    .creditos{
      break-inside: avoid;
      page-break-inside: avoid;
    }

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
            Ficha Cadastral
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
            className={PRINT_ACTION_BUTTON_CLASS}
          >
            <Link href="/clientes">
              <Power className="w-3 h-3" />
              Sair
            </Link>
          </Button>

          <PrintShareMenu documentId={cliente.id} filenamePrefix="cliente" />
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
                  {juridica ? "CNPJ" : "CPF"}: {fmtDoc(cliente.cpfcnpj)}
                </div>
                <div>
                  Tel: {fmtPhone(cliente.telefone)} • {fmtText(cliente.email)}
                </div>
                <div>{enderecoResumo || EMPTY}</div>
              </div>
            </div>

            <div className="doc-box">
              <div className="doc-label">Ficha Cadastral</div>
              <div className="doc-numero">#{cliente.id}</div>
              <div className="doc-data">Emitida em {fmtDateTime(new Date())}</div>
            </div>
          </div>

          <div className="conteudo">
            <div className="identidade">
              <div className="chips">
                <span className="chip chip-forte">{juridica ? "Pessoa Jurídica" : "Pessoa Física"}</span>
                <span className="chip">Status: {statusTexto}</span>
                <span className="chip">Classificação: {fmtEnum(cliente.rank)}</span>
              </div>
            </div>

            <Secao numero="01" titulo="Identificação" icone={<IdCard className="w-3.5 h-3.5" />}>
              <Campo rotulo="Código do cliente" valor={`#${cliente.id}`} span={3} />
              <Campo
                rotulo="Tipo de pessoa"
                valor={juridica ? "Pessoa Jurídica" : "Pessoa Física"}
                span={3}
              />
              <Campo rotulo="Status" valor={statusTexto} span={3} />
              <Campo rotulo="Classificação" valor={fmtEnum(cliente.rank)} span={3} />
              <Campo
                rotulo={juridica ? "Razão social" : "Nome completo"}
                valor={nomeCliente}
                span={8}
              />
              <Campo rotulo={juridica ? "CNPJ" : "CPF"} valor={fmtDoc(cliente.cpfcnpj)} span={4} />
            </Secao>

            <Secao numero="02" titulo="Contato" icone={<Phone className="w-3.5 h-3.5" />}>
              <Campo rotulo="Telefone" valor={fmtPhone(cliente.telefone)} span={4} />
              <Campo rotulo="E-mail" valor={fmtText(cliente.email)} span={8} />
            </Secao>

            <Secao numero="03" titulo="Endereço" icone={<MapPin className="w-3.5 h-3.5" />}>
              <Campo rotulo="CEP" valor={fmtCep(cliente.cep)} span={3} />
              <Campo rotulo="Logradouro" valor={fmtText(cliente.endereco)} span={6} />
              <Campo rotulo="Número" valor={fmtText(cliente.endereconumero)} span={3} />
              <Campo rotulo="Complemento" valor={fmtText(cliente.enderecocomplemento)} span={6} />
              <Campo rotulo="Bairro" valor={fmtText(cliente.bairro)} span={6} />
              <Campo rotulo="Cidade" valor={fmtText(cliente.cidade)} span={4} />
              <Campo rotulo="UF" valor={fmtText(cliente.estado)} span={4} />
              <Campo
                rotulo="Código do município (IBGE)"
                valor={fmtText(cliente.codigomunicipio)}
                span={4}
              />
            </Secao>

            {/* IE e inscrição municipal são de contribuinte: em pessoa física
                a seção inteira não se aplica e sai da folha. */}
            {juridica ? (
              <Secao numero="04" titulo="Dados Fiscais" icone={<FileText className="w-3.5 h-3.5" />}>
                <Campo
                  rotulo="Indicador de IE do destinatário"
                  valor={fmtIndicadorIe(cliente.ind_ie_dest)}
                  span={6}
                />
                <Campo
                  rotulo="Inscrição estadual"
                  valor={fmtText(cliente.inscricaoestadual)}
                  span={3}
                />
                <Campo
                  rotulo="Inscrição municipal"
                  valor={fmtText(cliente.inscricaomunicipal)}
                  span={3}
                />
              </Secao>
            ) : null}

            <Secao
              numero={numeroRegistro}
              titulo="Registro no Sistema"
              icone={<User className="w-3.5 h-3.5" />}
            >
              <Campo rotulo="Cadastrado em" valor={fmtDate(cliente.createdat)} span={4} />
              <Campo rotulo="Última atualização" valor={fmtDateTime(cliente.updatedat)} span={4} />
              <Campo rotulo="Emissão desta ficha" valor={fmtDateTime(new Date())} span={4} />
            </Secao>

            <div className="financeiro-card">
              <div className="score-bloco">
                <div className="score-rotulo">Score</div>
                <ScoreDonut score={financeiro.score} />
                <div className="score-classificacao">
                  {rotuloClassificacao[financeiro.classificacao]}
                </div>
              </div>

              <div className="fin-grid">
                <FinItem
                  rotulo="Em aberto"
                  valor={fmtMoney(financeiro.totalEmAberto)}
                  detalhe={`${financeiro.quantidadeEmAberto} título(s)`}
                />
                <FinItem
                  rotulo="Vencido"
                  valor={fmtMoney(financeiro.totalVencido)}
                  detalhe={`${financeiro.quantidadeVencida} em atraso`}
                  alerta={financeiro.totalVencido > 0}
                />
                <FinItem
                  rotulo="A vencer"
                  valor={fmtMoney(financeiro.totalAVencer)}
                  detalhe="Compromissos futuros"
                />
                <FinItem
                  rotulo="Total recebido"
                  valor={fmtMoney(financeiro.totalRecebido)}
                  detalhe="Receitas de OS e vendas"
                />
                <FinItem
                  rotulo="Pagamentos em dia"
                  valor={
                    financeiro.percentualPagoEmDia == null
                      ? EMPTY
                      : `${financeiro.percentualPagoEmDia}%`
                  }
                  detalhe={`${financeiro.quantidadeAvaliada} avaliado(s)`}
                />
                <FinItem
                  rotulo="Média de atraso"
                  valor={
                    financeiro.mediaDiasAtraso == null
                      ? EMPTY
                      : `${financeiro.mediaDiasAtraso} dia(s)`
                  }
                  detalhe="Sobre os títulos pagos"
                />
              </div>
            </div>

            <div className="rodape">
              <div className="creditos">
                <span>
                  {empresaNome} — Ficha cadastral do cliente #{cliente.id}
                </span>
                <span>Emitida em {fmtDateTime(new Date())}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
