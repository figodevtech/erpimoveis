import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Script from "next/script";
import { Car, ClipboardList, Cog, User, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatCep } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ObservacoesToggle } from "../../../components/ObservacoesToggle";
import { PrintShareMenu } from "../../../components/PrintShareMenu";
import { fetchPrimeiroLogoEmpresa } from "@/lib/empresa-logo";
import { fetchPrintColors } from "@/lib/print-config";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
};

const EMPTY = "-";

/* ========= HELPERS DE FORMATAÇÃO ========= */

function fmtMoney(v: number | string | null | undefined) {
  if (v == null) return "R$ 0,00";
  const n = Number(v);
  if (isNaN(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function fmtDate(s?: string | Date | null) {
  if (!s) return EMPTY;
  const d = s instanceof Date ? s : new Date(s);
  if (isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
}

function fmtDateTime(s?: string | Date | null) {
  if (!s) return EMPTY;
  const d = s instanceof Date ? s : new Date(s);
  if (isNaN(d.getTime())) return EMPTY;
  return d.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  });
}

function fmtText(value?: string | number | null) {
  if (value == null) return EMPTY;
  const s = String(value).trim();
  return s ? s : EMPTY;
}

function joinParts(parts: Array<string | null | undefined>, separator = ", ") {
  return parts
    .map((part) => (part ?? "").toString().trim())
    .filter((part) => part.length > 0)
    .join(separator);
}

function fmtDoc(cpfCnpj: unknown) {
  if (cpfCnpj == null) return EMPTY;
  const s = String(cpfCnpj).replace(/\D/g, "");
  if (!s) return EMPTY;
  if (s.length === 11)
    return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (s.length === 14)
    return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return s;
}

function fmtPhone(value?: string | null) {
  if (!value) return EMPTY;
  const s = String(value).replace(/\D/g, "");
  if (s.length === 11) return s.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (s.length === 10) return s.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value;
}

function fmtEnum(value?: string | null) {
  if (!value) return EMPTY;
  return String(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

async function fetchEmpresa() {
  const { data, error } = await supabaseAdmin
    .from("empresa")
    .select("*")
    .single();

  if (error) {
    console.error("Erro ao buscar empresa no Supabase:", error);
    return null;
  }

  return data ?? null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Ordem de Serviço #${id}` };
}

export default async function OSFullPage({ params }: PageProps) {
  const { id: idStr } = await params;
  const osId = Number(idStr);

  if (isNaN(osId)) notFound();

  const { data: os, error: osError } = await supabaseAdmin
    .from("ordemservico")
    .select(
      `
      *,
      cliente:clienteid (*),
      veiculo:veiculoid (*),
      peca:pecaid (*),
      servicos:osservico (*, servico:servicoid (*)),
      produtos:osproduto (*, produto:produtoid (*))
    `
    )
    .eq("id", osId)
    .maybeSingle();

  if (osError || !os) {
    console.error("Erro ao carregar OS:", osError);
    notFound();
  }

  const empresa = await fetchEmpresa();
  const finalLogo = await fetchPrimeiroLogoEmpresa();
  const printColors = await fetchPrintColors();

  const totalProdutos =
    os.produtos?.reduce((acc: number, p: any) => acc + Number(p.subtotal), 0) ||
    0;
  const totalServicos =
    os.servicos?.reduce((acc: number, s: any) => acc + Number(s.subtotal), 0) ||
    0;
  const totalGeral = totalProdutos + totalServicos;

  const empresaNome =
    empresa?.nomefantasia || empresa?.razaosocial || "Oficina Mecânica";

  const empresaEndereco = joinParts(
    [
      empresa?.endereco,
      empresa?.numero ? `Nº ${empresa.numero}` : null,
      empresa?.complemento,
    ],
    ", "
  );
  const empresaLocal = joinParts(
    [empresa?.bairro, empresa?.uf, empresa?.cep ? `CEP ${empresa.cep}` : null],
    " • "
  );

  const clienteEndereco = joinParts(
    [
      os.cliente?.endereco,
      os.cliente?.endereconumero ? `Nº ${os.cliente.endereconumero}` : null,
      os.cliente?.enderecocomplemento,
    ],
    ", "
  );
  const clienteLocal = joinParts(
    [
      os.cliente?.bairro,
      os.cliente?.cidade,
      os.cliente?.estado,
      os.cliente?.cep ? `CEP ${formatCep(os.cliente.cep)}` : null,
    ],
    " • "
  );

  const veiculoNome = joinParts([os.veiculo?.marca, os.veiculo?.modelo], " ");
  const veiculoPlaca = os.veiculo?.placa_formatada || os.veiculo?.placa;
  const alvoTipo = os.alvo_tipo === "PECA" ? "Peça" : "Veículo";

  const itens: Array<{
    tipo: "SERVIÇO" | "PEÇA";
    descricao: string;
    qtd: number;
    unitario: number | string | null | undefined;
    subtotal: number | string | null | undefined;
  }> = [
    ...(os.servicos ?? []).map((s: any) => ({
      tipo: "SERVIÇO" as const,
      descricao: s.servico?.descricao || "Serviço",
      qtd: Number(s.quantidade ?? 1),
      unitario: s.precounitario,
      subtotal: s.subtotal,
    })),
    ...(os.produtos ?? []).map((p: any) => ({
      tipo: "PEÇA" as const,
      descricao: p.produto?.titulo || p.produto?.descricao || "Peça",
      qtd: Number(p.quantidade ?? 1),
      unitario: p.precounitario,
      subtotal: p.subtotal,
    })),
  ];

  const metaOS = [
    {
      k: "Status",
      v: (
        <Badge className="text-[9px] font-bold text-black" variant={"outline"}>
          {fmtEnum(os.status)}
        </Badge>
      ),
    },
    { k: "Prioridade", v: fmtEnum(os.prioridade) },
    { k: "Impressão", v: fmtDateTime(new Date()) },
    { k: "Entrada", v: fmtDate(os.dataentrada) },
    { k: "Saída", v: fmtDate(os.datasaida) },
    { k: "Alvo", v: alvoTipo },
  ];

  return (
    <div className="os-print-root">
      {/* ✅ Auto-scale REAL do A4 no SCREEN (sem mexer no PRINT) */}
      <Script id="os-a4-autoscale" strategy="afterInteractive">{`
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
            // Largura "real" do A4 no SCREEN (definida no CSS como --a4w)
            var a4w = lerVarNumericaPx('--a4w', 794); // fallback 794px (210mm @ 96dpi)
            var margem = 16; // mesma ideia do calc(100vw - 16px)
            var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            var disponivel = Math.max(320, vw - margem); // evita scale bizarro em vw muito pequeno
            var scale = Math.min(1, disponivel / a4w);

            // aplica no :root (inline) -> ganha das regras do CSS
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
    --brand-accent:#8b5cf6;
    
    --ink:#0f172a;
    --muted:#64748b;
    --border:#cbd5e1;
    --paper:#ffffff;
    --soft-bg:#f8fafc;

    --primary-soft: color-mix(in srgb, var(--brand-primary) 8%, transparent);
    --secondary-soft: color-mix(in srgb, var(--brand-secondary) 10%, transparent);

    --radius: 12px;

    /* ✅ Dimensões A4 "lógicas":
       - SCREEN: px (mais estável no mobile)
       - PRINT: mm (mantém A4 real)
    */
    --a4w: 794px;
    --a4h: 1123px;

    /* ✅ escala usada no preview */
    --os-scale: 1;
  }

  @media print {
    .os-observacoes { display: block !important; }

    :root{
      --a4w: 210mm;
      --a4h: 297mm;
    }
  }

  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  @page{ size:A4; margin: 0; }

  .os-print-root{
    min-height:100vh;
    padding:20px 0;
    background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color:var(--ink);

    /* ✅ evita “quebrar” a tela no mobile antes da escala aplicar */
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .toolbar{
    width: min(var(--a4w), calc(100vw - 16px));
    margin: 0 auto 16px;
    display:flex;
    align-items:flex-end;
    justify-content:space-between;
    padding: 0 8px;
  }

  /* ✅ wrapper que reserva exatamente o tamanho VISUAL do A4 escalado */
  .folha-scaler{
    position: relative;
    width: calc(var(--a4w) * var(--os-scale));
    height: calc(var(--a4h) * var(--os-scale));
    margin: 0 auto;
  }

  .folha{
    width: var(--a4w);
    height: var(--a4h);
    background: var(--paper);
    border: 1px solid var(--border);
    box-shadow: 0 20px 60px rgba(15,23,42,.15);
    overflow:hidden;
    display:flex;
    flex-direction:column;

    /* ✅ fica fora do flow e escala sem causar “layout quebrado” */
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    transform: scale(var(--os-scale));
    will-change: transform;
  }

  .conteudo{
    padding: 9mm;
    height: 100%;
    display:flex;
    flex-direction:column;
    gap: 7px;
  }

  @media print{
    html, body{
      margin:0 !important;
      padding:0 !important;
      background:#fff !important;
    }

    .no-print{ display:none !important; }

    .os-print-root{
      padding:0 !important;
      background:none !important;
      min-height:auto !important;
      overflow: visible !important;
    }

    /* ✅ PRINT: anula o scaler/transform e mantém A4 real */
    .folha-scaler{
      position: static !important;
      width: auto !important;
      height: auto !important;
      margin: 0 !important;
    }

    .folha{
      width: 210mm !important;
      min-height: 297mm !important;
      height: auto !important;
      margin: 0 !important;

      border:0 !important;
      border-radius:0 !important;
      box-shadow:none !important;
      overflow:visible !important;
      background:#fff !important;

      position: static !important;
      transform: none !important;
      inset: auto !important;
    }

    .conteudo{
      padding: 8mm !important;
      height: auto !important;
    }

    *{
      box-shadow:none !important;
      text-shadow:none !important;
      outline:0 !important;
    }

    body{ zoom: 1 !important; }
  }

  .t-micro{ font-size:9px; line-height:1.2; }
  .t-xs{ font-size:10px; line-height:1.3; }
  .t-sm{ font-size:11px; line-height:1.3; }

  .h1{ font-size:20px; line-height:1.1; font-weight:600; letter-spacing:-.01em; }
  .h2{ font-size:12px; line-height:1.1; font-weight:500; }

  .muted{ color: var(--muted); }

  .header-os{
    background: linear-gradient(135deg, var(--brand-primary), var(--brand-secondary));
    padding: 14px 16px;
    color: white;
    display:grid;
    grid-template-columns: auto 1fr auto;
    gap: 16px;
    align-items: center;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--brand-primary) 20%, transparent);
  }

  .logo-container{
    width: 70px;
    height: 70px;
    background: white;
    border-radius: 10px;
    display:flex;
    align-items:center;
    justify-content:center;
    padding: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,.15);
  }

  .logo-img{
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .logo-placeholder{
    width: 70px;
    height: 70px;
    background: white;
    border-radius: 10px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-weight:700;
    font-size: 24px;
    color: var(--brand-primary);
    box-shadow: 0 4px 12px rgba(0,0,0,.15);
  }

  .empresa-info{
    flex: 1;
  }

  .empresa-nome{ font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .empresa-details{ font-size: 9px; opacity: 0.95; line-height: 1.4; }

  .os-header-box{
    background: rgba(255,255,255,.15);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,.3);
    border-radius: 10px;
    padding: 10px 14px;
    text-align: right;
    min-width: 140px;
  }

  .os-label{
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: .2em;
    opacity: 0.9;
    font-weight: 800;
  }

  .os-numero{
    font-size: 28px;
    font-weight: 900;
    line-height: 1;
    margin: 4px 0;
    letter-spacing: -.02em;
  }

  .cartao{
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: #fff;
    padding: 10px;
  }

  .cartao-destaque{
    background: linear-gradient(135deg, var(--primary-soft), var(--secondary-soft));
    border-color: color-mix(in srgb, var(--brand-primary) 30%, var(--border));
  }

  .titulo-secao{
    display:flex;
    align-items:center;
    gap: 8px;
    padding-bottom: 6px;
    margin-bottom: 8px;
    border-bottom: 2px solid var(--border);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--brand-primary);
  }

  .grid-info{
    display:grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 8px;
  }

  .kv{
    display:grid;
    grid-template-columns: 85px 1fr;
    gap: 6px;
    font-size: 10px;
    line-height:1.3;
    margin-bottom: 4px;
  }
  .kv .k{ color: var(--muted); font-weight:700; }
  .kv .v{ font-weight:600; }

  /* ✅ wrap do email quando passar da borda */
  .kv .v{
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: normal;
  }

  .meta-grid{
    display:grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
    margin-top: 8px;
  }

  .meta-badge{
    background: var(--soft-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    text-align: center;
  }
  .meta-badge .label{ 
    font-size: 8px; 
    text-transform: uppercase; 
    letter-spacing: .14em; 
    color: var(--muted); 
    font-weight:500; 
    margin-bottom: 3px;
  }
  .meta-badge .valor{ 
    font-size: 10px; 
    font-weight:700; 
    color: var(--ink);
  }

  .tabela-container{
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: white;
  }

  table{ 
    width:100%; 
    border-collapse:collapse; 
  }
  
  thead th{
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: .12em;
    font-weight: 900;
    color: white;
    padding: 8px 8px;
    background: linear-gradient(135deg, var(--brand-primary), var(--brand-primary));
    text-align: left;
  }
  
  tbody td{
    font-size: 10px;
    padding: 7px 8px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align:middle;
  }
  
  tbody tr:last-child td{
    border-bottom: none;
  }

  .col-num{ width:38px; font-weight:700; text-align:center; }
  .col-tipo{ width:70px; font-weight:800; font-size:8px; text-transform:uppercase; letter-spacing:.08em; }
  .tipo-servico{ 
    color: white;
    background: var(--brand-secondary);
    padding: 3px 8px;
    border-radius: 6px;
    display: inline-block;
  }
  .tipo-peca{ 
    color: white;
    background: var(--brand-accent);
    padding: 3px 8px;
    border-radius: 6px;
    display: inline-block;
  }

  .col-qtd{ width:50px; text-align:center; font-weight:700; }
  .col-unit{ width:90px; text-align:right; font-weight:600; }
  .col-sub{ width:100px; text-align:right; font-weight:700; color: var(--brand-primary); }

  .rodape{
    margin-top:auto;
    display:grid;
    grid-template-columns: 1fr 320px;
    gap: 10px;
    padding-top: 8px;
  }

  .observacoes-box{ border: 1px solid var(--border); background: var(--soft-bg); border-radius: var(--radius); padding: 10px; }

  .os-observacoes { display: none; }
  html[data-os-observacoes="1"] .os-observacoes { display: block; }


  .obs-titulo{ font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: var(--brand-primary); margin-bottom: 6px; } .obs-texto{ font-size: 10px; line-height: 1.4; color: var(--muted); max-height: 60px; overflow: hidden; }
  .totais-box{
    border: 1px solid var(--brand-primary);
    background: linear-gradient(135deg, var(--primary-soft), white);
    border-radius: var(--radius);
    padding: 12px;
  }

  .linha-total{
    display:flex;
    justify-content:space-between;
    font-size: 11px;
    padding: 4px 0;
    color: var(--muted);
  }

  .linha-total-final{
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--brand-primary);
    display:flex;
    justify-content:space-between;
    align-items:center;
  }

  .total-label{
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--brand-primary);
  }

  .total-valor{
    font-size: 16px;
    font-weight: 700;
    color: var(--brand-primary);
    letter-spacing: -.02em;
  }

  .assinaturas{
    margin-top: 35px;
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .assinatura{
    border-top: 2px solid var(--border);
    padding-top: 8px;
    text-align:center;
  }

  .assin-label{
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing:.12em;
    color: var(--muted);
    font-weight:700;
  }

  .clamp-3{
    display:-webkit-box;
    -webkit-line-clamp:3;
    -webkit-box-orient:vertical;
    overflow:hidden;
  }
`}</style>

      <div className="toolbar no-print">
        <div>
          <div
            className="t-micro muted"
            style={{
              textTransform: "uppercase",
              letterSpacing: ".32em",
              fontWeight: 800,
            }}
          >
            Ordem de Serviço
          </div>
          <div className="text-[10px] md:text-xs" style={{ fontWeight: 700 }}>
            Visualização de Impressão (1 página)
          </div>
        </div>

        <div className="flex flex-row items-center gap-2">
          <Button
            asChild
            size={"sm"}
            variant={"outline"}
            className="hover:cursor-pointer hover:text-black"
          >
            <Link href="/ordens">
              <Power className="w-3 h-3" />
              Sair
            </Link>
          </Button>

          <PrintShareMenu
            documentId={os.id}
            filenamePrefix="ordem-servico"
            fixedHeight={1123}
          />
        </div>
      </div>
      <div className="toolbar no-print">
        <div className="flex flex-row items-center gap-1">
          <ObservacoesToggle />
        </div>
      </div>

      <div className="folha-scaler">
        <div className="folha" data-print-export-target>
          <div className="header-os">
            {finalLogo ? (
              <div className="logo-container">
                <Image
                  src={finalLogo || "/placeholder.svg"}
                  alt="Logo da empresa"
                  width={70}
                  height={70}
                  className="logo-img"
                  priority
                />
              </div>
            ) : (
              <div className="logo-placeholder">OS</div>
            )}

            <div className="empresa-info">
              <div className="empresa-nome">{empresaNome}</div>
              <div className="empresa-details">
                {empresaEndereco && <div>{empresaEndereco}</div>}
                {empresaLocal && <div>{empresaLocal}</div>}
                <div>
                  {empresa?.telefone && (
                    <span>Tel: {fmtPhone(empresa.telefone)}</span>
                  )}
                  {empresa?.cnpj && (
                    <span> • CNPJ: {fmtDoc(empresa.cnpj)}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="os-header-box">
              <div className="os-label">Ordem de Serviço</div>
              <div className="os-numero">#{os.id}</div>
              <div className="t-xs" style={{ opacity: 1, fontWeight: 700 }}>
                <Badge className="text-xs text-white" variant={"outline"}>
                  {fmtEnum(os.status)}
                </Badge>
              </div>
            </div>
          </div>

          <div className="conteudo">
            <div className="meta-grid">
              {metaOS.map((m) => (
                <div key={m.k} className="meta-badge">
                  <div className="label">{m.k}</div>
                  <div className="valor">{m.v}</div>
                </div>
              ))}
            </div>

            <div className="grid-info">
              <div className="cartao cartao-destaque col-span-3">
                <div className="titulo-secao">
                  <User className="w-4 h-4" />
                  Cliente
                </div>
                {os.cliente ? (
                  <>
                  <div className="h2">
                  {fmtText(os.cliente?.nomerazaosocial).toUpperCase()}
                </div>
                
                <div style={{ marginTop: 8 }}>
                  <div className="kv">
                    <span className="k">Documento</span>
                    <span className="v">{fmtDoc(os.cliente?.cpfcnpj)}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Telefone</span>
                    <span className="v">{fmtPhone(os.cliente?.telefone)}</span>
                  </div>
                  <div className="kv text-wrap">
                    <span className="k">E-mail</span>
                    <span className="v">
                      {fmtText(os.cliente?.email).toUpperCase()}
                    </span>
                  </div>
                </div>
                {(clienteEndereco || clienteLocal) && (
                  <div className="t-xs muted" style={{ marginTop: 8 }}>
                    {clienteEndereco && <div>{clienteEndereco}</div>}
                    {clienteLocal && <div>{clienteLocal}</div>}
                  </div>
                )}
                  </>
                ): <span className="text-xs font-mono text-gray-700">CLIENTE AVULSO</span>}
                
              </div>

              <div className="cartao cartao-destaque col-span-2">
                <div className="titulo-secao">
                  {alvoTipo === "Peça" ? (
                    <Cog className="w-4 h-4" />
                  ) : (
                    <Car className="w-4 h-4" />
                  )}
                  {alvoTipo === "Peça" ? "Peça / Componente" : "Veículo"}
                </div>
                {alvoTipo === "Peça" ? (
                  <div className="h2">
                    {fmtText(
                      os.peca?.titulo?.toUpperCase?.() ?? os.peca?.titulo
                    )}
                  </div>
                ) : (
                  <>
                  {os.veiculo ? (
                    <>
                    <div className="h2">{fmtText(veiculoNome)}</div>
                    <div style={{ marginTop: 8 }}>
                      <div className="kv">
                        <span className="k">Placa</span>
                        <span className="v">{fmtText(veiculoPlaca)}</span>
                      </div>
                      <div className="kv">
                        <span className="k">Ano</span>
                        <span className="v">{fmtText(os.veiculo?.ano)}</span>
                      </div>
                      <div className="kv">
                        <span className="k">KM</span>
                        <span className="v">{fmtText(os.veiculo?.km)}</span>
                      </div>
                    </div></>
                  ):
                  
                  (<span className="text-xs font-mono text-gray-700">NÃO DEFINIDO</span>)}
                    
                  </>
                )}
              </div>

              <div className="cartao cartao-destaque col-span-2">
                <div className="titulo-secao">
                  <ClipboardList className="w-4 h-4" />
                  Detalhes
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="flex flex-col gap-2 text-[9px]">
                    <span className="whitespace-pre-wrap muted">
                      {String(os.descricao ?? "").toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {itens.length > 0 && (
              <div className="tabela-container">
                <table>
                  <thead>
                    <tr>
                      <th className="col-num">#</th>
                      <th className="col-tipo">Tipo</th>
                      <th>Descrição</th>
                      <th className="col-qtd">Qtd</th>
                      <th className="col-unit">Unit.</th>
                      <th className="col-unit">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item, idx) => (
                      <tr key={idx}>
                        <td className="col-num">{idx + 1}</td>
                        <td className="col-tipo">
                          <span
                            className={
                              item.tipo === "SERVIÇO"
                                ? "tipo-servico"
                                : "tipo-peca"
                            }
                          >
                            {item.tipo}
                          </span>
                        </td>
                        <td>{item.descricao}</td>
                        <td className="col-qtd">{item.qtd}</td>
                        <td className="col-unit">{fmtMoney(item.unitario)}</td>
                        <td className="col-sub">{fmtMoney(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rodape">
              <div>
                {(os.observacoes || os.defeitorelatado) && (
                  <div className="observacoes-box os-observacoes">
                    {" "}
                    <div className="obs-titulo">Observações:</div>{" "}
                    <div className="obs-texto text-sm font-bold clamp-3">
                      {os.observacoes || os.defeitorelatado || EMPTY}
                    </div>{" "}
                  </div>
                )}
                <div className="assinaturas">
                  <div className="assinatura">
                    <div className="assin-label">Responsável Técnico</div>
                  </div>
                  <div className="assinatura">
                    <div className="assin-label">Cliente</div>
                  </div>
                </div>
              </div>

              <div className="totais-box">
                <div className="linha-total">
                  <span className="label">Produtos/Peças</span>
                  <span className="valor">{fmtMoney(totalProdutos)}</span>
                </div>
                <div className="linha-total">
                  <span className="label">Serviços</span>
                  <span className="valor">{fmtMoney(totalServicos)}</span>
                </div>

                <div className="linha-total-final">
                  <span className="total-label">Total</span>
                  <span className="total-valor">{fmtMoney(totalGeral)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
