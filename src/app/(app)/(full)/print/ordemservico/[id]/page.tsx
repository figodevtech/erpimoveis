import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Script from "next/script";
import { Car, ClipboardList, Cog, Tag, User, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatCep } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ObservacoesToggle } from "../../../components/ObservacoesToggle";
import { PrintFilterToggles } from "../../../components/PrintFilterToggles";
import { PrintShareMenu } from "../../../components/PrintShareMenu";
import { fetchPrimeiroLogoEmpresa } from "@/lib/empresa-logo";
import { fetchPrintColors } from "@/lib/print-config";
import { getTermoAceiteOS, type AceiteAlvo } from "@/lib/print-aceite";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
};

const EMPTY = "-";

type TipoDesconto = "FIXO" | "PORCENTAGEM" | null;

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

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getTipoDesconto(value: unknown): TipoDesconto {
  return value === "FIXO" || value === "PORCENTAGEM" ? value : null;
}

function calcularDescontoAplicado(base: number, tipoValue: unknown, descontoValue: unknown) {
  const tipo = getTipoDesconto(tipoValue);
  const baseSegura = Math.max(0, toNumber(base));
  const desconto = Math.max(0, toNumber(descontoValue));

  if (!tipo || baseSegura <= 0 || desconto <= 0) return 0;
  if (tipo === "PORCENTAGEM") {
    return roundMoney(baseSegura * (Math.min(desconto, 100) / 100));
  }

  return roundMoney(Math.min(desconto, baseSegura));
}

function fmtPercent(value: unknown) {
  return toNumber(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
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

function CodigoProduto({ id, etiqueta }: { id?: unknown; etiqueta?: unknown }) {
  const idTexto = id != null ? `#${id}` : null;
  const etiquetaTexto = String(etiqueta ?? "").trim() || null;

  if (!idTexto && !etiquetaTexto) return null;

  return (
    <span className="item-codigo">
      {idTexto}
      {etiquetaTexto ? (
        <span className="item-etiqueta">
          <Tag className="item-etiqueta-icone" />
          {etiquetaTexto}
        </span>
      ) : null}
    </span>
  );
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

/** Quilometragem com separador de milhar, igual ao dialog de detalhes da OS. */
function fmtKm(value?: number | string | null) {
  if (value == null || value === "") return EMPTY;
  const numero = Number(value);
  if (!Number.isFinite(numero)) return EMPTY;
  return `${numero.toLocaleString("pt-BR")} km`;
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
      criador:usuariocriadorid ( id, nome ),
      servicos:osservico (*, servico:servicoid (*)),
      produtos:osproduto (*, produto:produtoid (*)),
      produtosAvulsos:osproduto_avulso (*)
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
    (os.produtos?.reduce((acc: number, p: any) => acc + toNumber(p.subtotal), 0) || 0) +
    (os.produtosAvulsos?.reduce((acc: number, p: any) => acc + toNumber(p.subtotal), 0) || 0);
  const totalServicos =
    os.servicos?.reduce((acc: number, s: any) => acc + toNumber(s.subtotal), 0) ||
    0;
  const subtotalOS = roundMoney(totalProdutos + totalServicos);
  const descontoGeralTipo = getTipoDesconto(os.desconto_tipo);
  const descontoGeralAplicado = calcularDescontoAplicado(
    subtotalOS,
    descontoGeralTipo,
    os.desconto
  );
  const valorFrete = roundMoney(Math.max(0, toNumber(os.valor_frete)));
  const totalGeral = roundMoney(Math.max(0, subtotalOS - descontoGeralAplicado) + valorFrete);

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
  // A placa impressa e a cadastrada — e a que esta no carro e no CRLV.
  // `placa_formatada` e uma coluna gerada que converte placa antiga para o
  // equivalente Mercosul, entao so entra como referencia secundaria e apenas
  // quando difere da original (em placa ja no padrao novo as duas sao iguais).
  const veiculoPlaca = os.veiculo?.placa || os.veiculo?.placa_formatada;
  const veiculoPlacaMercosul =
    os.veiculo?.placa_formatada && os.veiculo.placa_formatada !== os.veiculo.placa
      ? os.veiculo.placa_formatada
      : null;
  const alvoTipo =
    os.alvo_tipo === "PECA"
      ? "Peça"
      : os.alvo_tipo === "EQUIPAMENTO"
        ? "Máquina/Equipamento"
        : "Veículo";
  const aceiteAlvo: AceiteAlvo =
    os.alvo_tipo === "PECA"
      ? "PECA"
      : os.alvo_tipo === "EQUIPAMENTO"
        ? "EQUIPAMENTO"
        : "VEICULO";
  const termoAceite = getTermoAceiteOS(os.status, aceiteAlvo);

  const criador = Array.isArray(os.criador) ? os.criador[0] : os.criador;
  const criadorNome = criador?.nome ?? null;

  const itens: Array<{
    tipo: "SERVIÇO" | "PEÇA";
    descricao: string;
    produtoId?: number | string | null;
    etiqueta?: string | null;
    subdescricao?: string | null;
    qtd: number;
    unitario: number | string | null | undefined;
    descontoTipo: TipoDesconto;
    desconto: number;
    descontoAplicado: number;
    subtotal: number | string | null | undefined;
  }> = [
    ...(os.servicos ?? []).map((s: any) => {
      const descricao = String(s.servico?.descricao || "Serviço").trim();
      const subdescricao = String(s.descricao ?? "").trim();
      const qtd = Number(s.quantidade ?? 1);
      const unitario = toNumber(s.precounitario);
      const descontoTipo = getTipoDesconto(s.desconto_tipo);
      const desconto = toNumber(s.desconto);
      return {
        tipo: "SERVIÇO" as const,
        descricao,
        subdescricao: subdescricao && subdescricao.toLocaleLowerCase("pt-BR") !== descricao.toLocaleLowerCase("pt-BR")
          ? subdescricao
          : null,
        qtd,
        unitario: s.precounitario,
        descontoTipo,
        desconto,
        descontoAplicado: calcularDescontoAplicado(qtd * unitario, descontoTipo, desconto),
        subtotal: s.subtotal,
      };
    }),
    ...(os.produtos ?? []).map((p: any) => {
      const qtd = Number(p.quantidade ?? 1);
      const unitario = toNumber(p.precounitario);
      const descontoTipo = getTipoDesconto(p.desconto_tipo);
      const desconto = toNumber(p.desconto);
      return {
        tipo: "PEÇA" as const,
        descricao: p.produto?.titulo || p.produto?.descricao || "Peça",
        produtoId: p.produto?.id ?? null,
        etiqueta: p.produto?.etiqueta ?? null,
        qtd,
        unitario: p.precounitario,
        descontoTipo,
        desconto,
        descontoAplicado: calcularDescontoAplicado(qtd * unitario, descontoTipo, desconto),
        subtotal: p.subtotal,
      };
    }),
    ...(os.produtosAvulsos ?? []).map((p: any) => {
      const qtd = Number(p.quantidade ?? 1);
      const unitario = toNumber(p.precounitario);
      const descontoTipo = getTipoDesconto(p.desconto_tipo);
      const desconto = toNumber(p.desconto);
      return {
        tipo: "PEÇA" as const,
        descricao: String(p.titulo || "Produto avulso"),
        produtoId: null,
        etiqueta: null,
        subdescricao: null,
        qtd,
        unitario: p.precounitario,
        descontoTipo,
        desconto,
        descontoAplicado: calcularDescontoAplicado(qtd * unitario, descontoTipo, desconto),
        subtotal: p.subtotal,
      };
    }),
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
    { k: "Impressão", v: fmtDateTime(new Date()) },
    { k: "Entrada", v: fmtDate(os.dataentrada) },
    { k: "Saída", v: fmtDate(os.datasaida) },
    { k: "Alvo", v: alvoTipo },
    { k: "Criado por", v: fmtText(criadorNome) },
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

  /* O preview usa zoom para a escala participar do layout. Assim a folha
     cresce com o conteúdo sem precisar calcular a altura via JavaScript. */
  .folha-scaler{
    position: relative;
    width: calc(var(--a4w) * var(--os-scale));
    min-height: calc(var(--a4h) * var(--os-scale));
    height: auto;
    margin: 0 auto;
  }

  .folha{
    width: var(--a4w);
    min-height: var(--a4h);
    height: auto;
    background: var(--paper);
    border: 1px solid var(--border);
    box-shadow: 0 20px 60px rgba(15,23,42,.15);
    overflow:visible;
    display:flex;
    flex-direction:column;

    position: static;
    zoom: var(--os-scale);
  }

  .conteudo{
    padding: 9mm;
    height: auto;
    flex: 1 0 auto;
    display:flex;
    flex-direction:column;
    gap: 7px;
  }

  @media print{
    @page{
      size: A4;
      margin: 14mm 0 8mm;
    }

    @page :first{
      margin-top: 8mm;
    }

    html, body{
      margin:0 !important;
      padding:0 !important;
      background:#fff !important;
      height:auto !important;
      max-height:none !important;
      overflow:visible !important;
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
      min-height: auto !important;
      height: auto !important;
      margin: 0 !important;
    }

    .folha{
      width: 210mm !important;
      min-height: auto !important;
      height: auto !important;
      max-height: none !important;
      margin: 0 !important;

      border:0 !important;
      border-radius:0 !important;
      box-shadow:none !important;
      overflow:visible !important;
      background:#fff !important;

      position: static !important;
      transform: none !important;
      zoom: 1 !important;
      inset: auto !important;
      display: block !important;
    }

    .conteudo{
      padding: 8mm !important;
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      display: block !important;
      overflow: visible !important;
    }

    .conteudo > * + *{
      margin-top: 7px;
    }

    .header-os,
    .meta-grid,
    .grid-info,
    .rodape,
    .observacoes-box,
    .totais-box,
    .assinaturas,
    .aceite-box{
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .tabela-container{
      overflow: visible !important;
      border-radius: 0 !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
    }

    table,
    tbody{
      break-inside: auto;
      page-break-inside: auto;
    }

    thead{
      display: table-header-group;
    }

    tbody{
      display: table-row-group;
    }

    tr{
      break-inside: avoid;
      page-break-inside: avoid;
    }

    td, th{
      orphans: 3;
      widows: 3;
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

  /* Equivalente Mercosul: referencia secundaria, nunca compete com a placa real. */
  .placa-equivalente{
    display:block;
    font-size:8px;
    font-weight:600;
    letter-spacing:.04em;
    color: var(--muted);
    margin-top:1px;
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

  .item-codigo{
    display:inline-flex;
    align-items:center;
    gap:5px;
    margin-left:6px;
    font-size:8px;
    font-weight:600;
    letter-spacing:.04em;
    color: color-mix(in srgb, var(--muted) 70%, #fff);
    white-space: nowrap;
    vertical-align: baseline;
  }

  .item-etiqueta{
    display:inline-flex;
    align-items:center;
    gap:2px;
  }

  .item-etiqueta-icone{
    width:8px;
    height:8px;
    flex-shrink:0;
    display:block;
  }

  .col-qtd{ width:50px; text-align:center; font-weight:700; }
  .col-unit{ width:90px; text-align:right; font-weight:600; }
  .col-desconto{ width:100px; text-align:right; font-weight:600; }
  .desconto-percentual{ color: var(--muted); font-size:8px; margin-top:2px; }
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

  /* ✅ Ocultar valores: colunas monetárias da tabela + caixa de totais */
  html[data-print-ocultar-valores] .col-unit,
  html[data-print-ocultar-valores] .col-desconto,
  html[data-print-ocultar-valores] .col-sub,
  html[data-print-ocultar-valores] .totais-box{ display:none !important; }
  html[data-print-ocultar-valores] .rodape{ grid-template-columns: 1fr !important; }

  /* ✅ Ocultar dados do cliente: some o cartão inteiro e as demais colunas ocupam a linha */
  html[data-print-ocultar-cliente] .bloco-cliente{ display:none !important; }
  html[data-print-ocultar-cliente] .grid-info{ grid-template-columns: repeat(4, 1fr) !important; }


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

  .aceite-box{
    margin-top: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--soft-bg);
    padding: 8px 10px;
  }

  .aceite-titulo{
    font-size: 8px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--brand-primary);
    margin-bottom: 4px;
  }

  .aceite-intro{
    font-size: 8px;
    font-weight: 700;
    line-height: 1.4;
    color: var(--ink);
    margin-bottom: 4px;
  }

  .aceite-item{
    font-size: 8px;
    line-height: 1.4;
    text-align: justify;
    color: var(--ink);
    margin-bottom: 3px;
  }

  .aceite-item:last-child{ margin-bottom: 0; }

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
            Visualização de Impressão
          </div>
        </div>

        <div className="flex flex-row items-center gap-2">
          <Button
            asChild
            size={"sm"}
            variant={"outline"}
            className="!border-slate-300 !bg-white !text-slate-900 hover:!bg-slate-100 hover:!text-slate-900 hover:cursor-pointer"
          >
            <Link href="/ordens">
              <Power className="w-3 h-3" />
              Sair
            </Link>
          </Button>

          <PrintShareMenu
            documentId={os.id}
            filenamePrefix="ordem-servico"
          />
        </div>
      </div>
      <div className="toolbar no-print">
        <div className="flex flex-row flex-wrap items-center gap-1">
          <ObservacoesToggle />
          <PrintFilterToggles />
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
              <div className="cartao cartao-destaque col-span-3 bloco-cliente">
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
                  {alvoTipo !== "Veículo" ? (
                    <Cog className="w-4 h-4" />
                  ) : (
                    <Car className="w-4 h-4" />
                  )}
                  {alvoTipo === "Peça" ? "Peça / Componente" : alvoTipo}
                </div>
                {alvoTipo === "Peça" ? (
                  <div>
                    <div className="h2">
                      {fmtText(
                        os.peca?.titulo?.toUpperCase?.() ?? os.peca?.titulo
                      )}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <div className="kv">
                        <span className="k">Fabricante</span>
                        <span className="v">{fmtText(os.peca?.fabricante)}</span>
                      </div>
                      <div className="kv">
                        <span className="k">Modelo</span>
                        <span className="v">{fmtText(os.peca?.modelo)}</span>
                      </div>
                      <div className="kv">
                        <span className="k">Código</span>
                        <span className="v">{fmtText(os.peca?.codigo)}</span>
                      </div>
                    </div>
                  </div>
                ) : alvoTipo === "Máquina/Equipamento" ? (
                  <div>
                    <div className="h2">{fmtText(os.equipamento_nome)}</div>
                    <div style={{ marginTop: 8 }}>
                      <div className="kv">
                        <span className="k">Patrimônio</span>
                        <span className="v">{fmtText(os.equipamento_patrimonio)}</span>
                      </div>
                      <div className="kv">
                        <span className="k">Ano</span>
                        <span className="v">{fmtText(os.equipamento_ano)}</span>
                      </div>
                      <div className="kv">
                        <span className="k">Horímetro</span>
                        <span className="v">
                          {os.equipamento_horimetro != null
                            ? `${Number(os.equipamento_horimetro).toLocaleString("pt-BR")} h`
                            : EMPTY}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                  {os.veiculo ? (
                    <>
                    <div className="h2">{fmtText(veiculoNome)}</div>
                    <div style={{ marginTop: 8 }}>
                      <div className="kv">
                        <span className="k">Placa</span>
                        <span className="v">
                          {fmtText(veiculoPlaca)}
                          {veiculoPlacaMercosul ? (
                            <span className="placa-equivalente">
                              Mercosul {veiculoPlacaMercosul}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="kv">
                        <span className="k">Cor</span>
                        <span className="v">{fmtText(os.veiculo?.cor)}</span>
                      </div>
                      <div className="kv">
                        <span className="k">Ano</span>
                        <span className="v">{fmtText(os.veiculo?.ano)}</span>
                      </div>
                      <div className="kv">
                        <span className="k">KM</span>
                        <span className="v">{fmtKm(os.veiculo?.kmatual)}</span>
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
                      <th className="col-desconto">Desconto</th>
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
                        <td>
                          <div>
                            {item.descricao}
                            <CodigoProduto
                              id={item.produtoId}
                              etiqueta={item.etiqueta}
                            />
                          </div>
                          {item.subdescricao ? (
                            <div className="mt-1 text-[9px] leading-snug text-slate-500">
                              {item.subdescricao}
                            </div>
                          ) : null}
                        </td>
                        <td className="col-qtd">{item.qtd}</td>
                        <td className="col-unit">{fmtMoney(item.unitario)}</td>
                        <td className="col-desconto">
                          {item.descontoAplicado > 0 ? (
                            <>
                              <div>- {fmtMoney(item.descontoAplicado)}</div>
                              {item.descontoTipo === "PORCENTAGEM" ? (
                                <div className="desconto-percentual">
                                  {fmtPercent(item.desconto)}%
                                </div>
                              ) : null}
                            </>
                          ) : (
                            EMPTY
                          )}
                        </td>
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
                {os.garantia && (
                  <div className="observacoes-box os-observacoes">
                    <div className="obs-titulo">Garantia:</div>
                    <div className="obs-texto text-sm font-bold clamp-3">
                      {os.garantia}
                    </div>
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

                {descontoGeralAplicado > 0 ? (
                  <>
                    <div className="linha-total">
                      <span className="label">Subtotal</span>
                      <span className="valor">{fmtMoney(subtotalOS)}</span>
                    </div>
                    <div className="linha-total">
                      <span className="label">
                        Desconto geral
                        {descontoGeralTipo === "PORCENTAGEM"
                          ? ` (${fmtPercent(os.desconto)}%)`
                          : ""}
                      </span>
                      <span className="valor">- {fmtMoney(descontoGeralAplicado)}</span>
                    </div>
                  </>
                ) : null}

                {valorFrete > 0 ? (
                  <div className="linha-total">
                    <span className="label">Frete</span>
                    <span className="valor">+ {fmtMoney(valorFrete)}</span>
                  </div>
                ) : null}

                <div className="linha-total-final">
                  <span className="total-label">Total</span>
                  <span className="total-valor">{fmtMoney(totalGeral)}</span>
                </div>
              </div>
            </div>

            {termoAceite && (
              <div className="aceite-box">
                <div className="aceite-titulo">{termoAceite.titulo}</div>
                <div className="aceite-intro">{termoAceite.intro}</div>
                {termoAceite.itens.map((item, idx) => (
                  <div key={idx} className="aceite-item">
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
