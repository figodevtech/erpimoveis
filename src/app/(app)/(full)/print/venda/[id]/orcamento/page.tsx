import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ObservacoesToggle } from "../../../../components/ObservacoesToggle";
import { PrintFilterToggles } from "../../../../components/PrintFilterToggles";
import { PrintShareMenu } from "../../../../components/PrintShareMenu";
import { PrintA4Paginator } from "../../../../components/PrintA4Paginator";
import {
  PRINT_DOCUMENT_HEADER_CSS,
  PrintDocumentHeader,
} from "../../../../components/PrintDocumentHeader";
import { FileText, Power, Tag, User } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatCep } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/utils";
import { fetchLogoEmpresaDataUrl } from "@/lib/empresa-logo";
import { fetchPrintColors } from "@/lib/print-config";
import { getTermoAceiteVenda } from "@/lib/print-aceite";
import { loadPrintPaymentSummary } from "@/lib/print-payment-display-server";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
};

const EMPTY = "-";

function fmtMoney(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function itemDiscountApplied(item: {
  sub_total?: number | string | null;
  valor_desconto?: number | string | null;
  tipo_desconto?: string | null;
}) {
  const subtotal = Math.max(0, Number(item.sub_total ?? 0));
  const discount = Math.max(0, Number(item.valor_desconto ?? 0));
  if (item.tipo_desconto === "PORCENTAGEM") {
    return roundMoney(subtotal * (Math.min(discount, 100) / 100));
  }
  return item.tipo_desconto === "FIXO"
    ? Math.min(subtotal, roundMoney(discount))
    : 0;
}

function fmtDateTime(v?: string | null) {
  if (!v) return EMPTY;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleString("pt-BR", {
    dateStyle: "short",

    timeZone: "America/Fortaleza",
  });
}

function fmtPhone(value?: string | null) {
  if (!value) return EMPTY;
  const s = String(value).replace(/\D/g, "");
  if (s.length === 11) return s.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (s.length === 10) return s.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value;
}

function fmtDoc(value?: string | null) {
  if (!value) return EMPTY;
  const s = String(value).replace(/\D/g, "");
  if (s.length === 11)
    return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (s.length === 14)
    return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value;
}

function fmtText(value?: string | number | null) {
  if (value == null) return EMPTY;
  const s = String(value).trim();
  return s ? s : EMPTY;
}

function joinParts(parts: Array<string | null | undefined>, separator = ", ") {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
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
          <Tag className="item-etiqueta-icone" aria-hidden="true" />
          {etiquetaTexto}
        </span>
      ) : null}
    </span>
  );
}

async function fetchEmpresa() {
  const { data, error } = await supabaseAdmin
    .from("empresa")
    .select(
      "nomefantasia, razaosocial, telefone, endereco, numero, complemento, bairro, uf, cep, cnpj",
    )
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Erro ao buscar empresa para impressão do orçamento:", error);
    return null;
  }

  return data ?? null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Orçamento de venda #${id}` };
}

export default async function PrintVendaOrcamentoPage({ params }: PageProps) {
  const { id } = await params;
  const vendaId = Number(id);

  if (Number.isNaN(vendaId)) notFound();

  const { data: venda, error } = await supabaseAdmin
    .from("venda")
    .select(
      `
      id,
      status,
      datavenda,
      createdat,
      desconto_tipo,
      desconto_valor,
      valor_frete,
      sub_total,
      descricao,
      observacoes,
      forma_pagamento,
      parcelas_pagamento,
      pagamentos_previstos,
      valortotal,
      criador:created_by (
        id,
        nome
      ),
      cliente:clienteid (
        id,
        nomerazaosocial,
        cpfcnpj,
        telefone,
        email,
        endereco,
        endereconumero,
        enderecocomplemento,
        bairro,
        cidade,
        estado,
        cep
      ),
      itens:vendaproduto (
        id,
        quantidade,
        sub_total,
        valor_total,
        tipo_desconto,
        valor_desconto,
        produto:produtoid (
          id,
          titulo,
          etiqueta,
          grupo:grupo_produto_id (
            nome
          )
        )
      )
    `,
    )
    .eq("id", vendaId)
    .single();

  if (error || !venda) {
    console.error("Erro ao buscar venda para impressão do orçamento:", error);
    notFound();
  }

  const empresa = await fetchEmpresa();
  const finalLogo = await fetchLogoEmpresaDataUrl();
  const printColors = await fetchPrintColors();
  const paymentSummary = await loadPrintPaymentSummary({
    type: "VENDA",
    documentId: vendaId,
    status: venda.status,
    pagamentosPrevistos: Array.isArray(venda.pagamentos_previstos)
      ? venda.pagamentos_previstos
      : null,
    formaPagamento: venda.forma_pagamento ?? null,
    parcelasPagamento: venda.parcelas_pagamento ?? null,
  });
  const cliente = Array.isArray(venda.cliente)
    ? venda.cliente[0]
    : venda.cliente;
  const criador = Array.isArray(venda.criador)
    ? venda.criador[0]
    : venda.criador;
  const criadorNome = criador?.nome ?? null;
  const empresaNome =
    empresa?.nomefantasia || empresa?.razaosocial || "Empresa";
  const empresaEndereco = joinParts(
    [
      empresa?.endereco,
      empresa?.numero ? `Nº ${empresa.numero}` : null,
      empresa?.complemento,
    ],
    ", ",
  );
  const empresaLocal = joinParts(
    [
      empresa?.bairro,
      empresa?.uf,
      empresa?.cep ? `CEP ${formatCep(empresa.cep)}` : null,
    ],
    " • ",
  );

  const clienteEndereco = joinParts(
    [
      cliente?.endereco,
      cliente?.endereconumero ? `Nº ${cliente.endereconumero}` : null,
      cliente?.enderecocomplemento,
    ],
    ", ",
  );
  const clienteLocal = joinParts(
    [
      cliente?.bairro,
      cliente?.cidade,
      cliente?.estado,
      cliente?.cep ? `CEP ${formatCep(cliente.cep)}` : null,
    ],
    " • ",
  );
  const itemDiscountTotal = roundMoney(
    (venda.itens ?? []).reduce(
      (total, item) => total + itemDiscountApplied(item),
      0,
    ),
  );
  const generalDiscountBase = Math.max(
    0,
    Number(venda.sub_total ?? 0) - itemDiscountTotal,
  );
  const generalDiscountApplied =
    venda.desconto_tipo === "PORCENTAGEM"
      ? roundMoney(
          generalDiscountBase *
            (Math.min(Math.max(Number(venda.desconto_valor ?? 0), 0), 100) /
              100),
        )
      : venda.desconto_tipo === "FIXO"
        ? Math.min(
            generalDiscountBase,
            Math.max(0, Number(venda.desconto_valor ?? 0)),
          )
        : 0;
  const termoAceite = getTermoAceiteVenda(venda.status);

  return (
    <div className="os-print-root">
      <style>{`
        :root{
          --brand-primary:${printColors.primary};
          --brand-secondary:${printColors.secondary};
          --brand-header-text:${printColors.text};
          --ink:#0f172a;
          --muted:#64748b;
          --border:#cbd5e1;
          --paper:#ffffff;
          --soft-bg:#f8fafc;
          --primary-soft:color-mix(in srgb, var(--brand-primary) 8%, transparent);
          --secondary-soft:color-mix(in srgb, var(--brand-secondary) 6%, transparent);
          --radius:12px;
          --a4w:794px;
          --a4h:1123px;
        }
        ${PRINT_DOCUMENT_HEADER_CSS}
        *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        @page{ size:A4; margin:0; }
        .os-print-root{
          min-height:100vh;
          padding:20px 0;
          background:linear-gradient(135deg, #f1f5f9, #e2e8f0);
          color:var(--ink);
          overflow-x:auto;
          font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .toolbar{
          width:min(var(--a4w), calc(100vw - 16px));
          margin:0 auto 16px;
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          padding:0 8px;
        }
        .folha{
          width:var(--a4w);
          min-height:var(--a4h);
          background:var(--paper);
          border:1px solid var(--border);
          box-shadow:0 20px 60px rgba(15,23,42,.15);
          margin:0 auto;
          overflow:hidden;
          display:flex;
          flex-direction:column;
        }
        .conteudo{
          padding:9mm;
          flex:1 0 auto;
          display:flex;
          flex-direction:column;
          gap:8px;
          min-height:0;
        }
        @media print{
          html, body{
            margin:0 !important;
            padding:0 !important;
            height:auto !important;
            max-height:none !important;
            overflow:visible !important;
            background:#fff !important;
          }
          .no-print{ display:none !important; }
          .os-print-root{
            padding:0 !important;
            min-height:auto !important;
            overflow:visible !important;
            background:none !important;
          }
          .folha{
            width:210mm !important;
            min-height:297mm !important;
            height:auto !important;
            max-height:none !important;
            margin:0 !important;
            border:0 !important;
            box-shadow:none !important;
            overflow:visible !important;
            display:flex !important;
            flex-direction:column !important;
          }
          .conteudo{
            min-height:0 !important;
            height:auto !important;
            max-height:none !important;
            padding:8mm !important;
            flex:1 0 auto !important;
            display:flex !important;
            flex-direction:column !important;
            overflow:visible !important;
          }
          .header-os,
          .meta-grid,
          .grid-info,
          .rodape,
          .observacoes-box,
          .totais-box,
          .assinaturas,
          .aceite-box{
            break-inside:avoid;
            page-break-inside:avoid;
          }
          .tabela-container{
            overflow:visible !important;
            border-radius:0 !important;
            break-inside:auto !important;
            page-break-inside:auto !important;
          }
          table,
          tbody{
            break-inside:auto;
            page-break-inside:auto;
          }
          thead{ display:table-header-group; }
          tbody{ display:table-row-group; }
          tr{
            break-inside:avoid;
            page-break-inside:avoid;
          }
        }
        .meta-grid{ display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; }
        .meta-badge{ background:var(--soft-bg); border:1px solid var(--border); border-radius:8px; padding:8px; text-align:center; }
        .meta-badge .label{ font-size:8px; text-transform:uppercase; letter-spacing:.14em; color:var(--muted); font-weight:700; margin-bottom:4px; }
        .meta-badge .valor{ font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; }
        .grid-info{ display:grid; grid-template-columns:1fr; gap:10px; }
        .grid-info-com-detalhes{ grid-template-columns:1.4fr 1fr; }
        .cartao{ border:1px solid var(--border); border-radius:var(--radius); background:#fff; padding:10px; }
        .cartao-destaque{ background:linear-gradient(135deg, var(--primary-soft), var(--secondary-soft)); }
        .titulo-secao{ display:flex; align-items:center; gap:8px; padding-bottom:6px; margin-bottom:8px; border-bottom:2px solid var(--border); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--brand-primary); }
        .kv{ display:grid; grid-template-columns:85px 1fr; gap:6px; font-size:10px; line-height:1.35; margin-bottom:4px; }
        .kv .k{ color:var(--muted); font-weight:700; }
        .kv .v{ font-weight:600; overflow-wrap:anywhere; white-space:normal; }
        .tabela-container{ border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; background:#fff; }
        table{ width:100%; border-collapse:collapse; }
        thead th{ font-size:9px; text-transform:uppercase; letter-spacing:.12em; font-weight:900; color:white; padding:8px; background:linear-gradient(135deg, var(--brand-primary), var(--brand-primary)); text-align:left; }
        tbody td{ font-size:10px; padding:7px 8px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
        tbody tr:last-child td{ border-bottom:none; }
        .col-num{ width:38px; text-align:center; font-weight:700; font-variant-numeric:tabular-nums; }
        .item-codigo{ display:inline-flex; align-items:center; gap:5px; margin-left:6px; font-size:8px; font-weight:600; letter-spacing:.04em; color:color-mix(in srgb, var(--muted) 70%, #fff); white-space:nowrap; vertical-align:baseline; }
        .item-etiqueta{ display:inline-flex; align-items:center; gap:2px; }
        .item-etiqueta-icone{ width:8px; height:8px; flex-shrink:0; display:block; }
        .col-qtd{ width:52px; text-align:center; font-weight:700; font-variant-numeric:tabular-nums; }
        .col-unit, .col-sub{ width:110px; text-align:right; font-weight:700; font-variant-numeric:tabular-nums; }
        .rodape{ margin-top:auto; display:grid; grid-template-columns:1fr 320px; gap:10px; padding-top:8px; }
        .observacoes-box{ border:1px solid var(--border); background:var(--soft-bg); border-radius:var(--radius); padding:10px; }
        .pagamentos-resumo{ margin-top:8px; padding-top:8px; border-top:1px solid var(--brand-primary); }
        .pagamentos-titulo{ font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--brand-primary); margin-bottom:5px; }
        .pagamentos-lista{ display:grid; gap:4px; }
        .pagamento-linha{ display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:10px; line-height:1.35; }
        .pagamento-metodo{ font-weight:700; }
        .pagamento-valor{ color:var(--brand-primary); font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap; }
        .venda-observacoes{ display:none; }
        html[data-os-observacoes="1"] .venda-observacoes{ display:block; }
        html[data-print-ocultar-valores] .col-unit,
        html[data-print-ocultar-valores] .col-sub,
        html[data-print-ocultar-valores] .totais-box{ display:none !important; }
        html[data-print-ocultar-valores] .pagamento-valor{ display:none !important; }
        html[data-print-ocultar-valores] .rodape{ grid-template-columns:1fr !important; }
        html[data-print-ocultar-cliente] .bloco-cliente{ display:none !important; }
        html[data-print-ocultar-cliente] .grid-info{ grid-template-columns:1fr !important; }
        html[data-print-ocultar-cliente][data-print-ocultar-valores] .grid-info{ display:grid !important; }
        .obs-titulo{ font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--brand-primary); margin-bottom:6px; }
        .obs-texto{ font-size:10px; line-height:1.45; color:var(--muted); }
        .totais-box{ border:1px solid var(--brand-primary); background:linear-gradient(135deg, var(--primary-soft), #fff); border-radius:var(--radius); padding:12px; }
        .linha-total{ display:flex; justify-content:space-between; font-size:11px; font-variant-numeric:tabular-nums; padding:4px 0; color:var(--muted); }
        .linha-total-final{ margin-top:8px; padding-top:8px; border-top:1px solid var(--brand-primary); display:flex; justify-content:space-between; align-items:center; }
        .total-label{ font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--brand-primary); }
        .total-valor{ font-size:16px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--brand-primary); }
        .assinaturas{ margin-top:35px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .assinatura{ border-top:2px solid var(--border); padding-top:8px; text-align:center; }
        .assin-label{ font-size:9px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); font-weight:700; }
        .aceite-box{ margin-top:10px; border:1px solid var(--border); background:var(--soft-bg); border-radius:var(--radius); padding:8px 10px; }
        .aceite-titulo{ font-size:8px; font-weight:800; text-transform:uppercase; letter-spacing:.12em; color:var(--brand-primary); margin-bottom:4px; }
        .aceite-intro{ font-size:8px; font-weight:700; line-height:1.4; color:var(--ink); margin-bottom:4px; }
        .aceite-item{ font-size:8px; line-height:1.4; text-align:justify; color:var(--ink); margin-bottom:3px; }
        .aceite-item:last-child{ margin-bottom:0; }
      `}</style>

      <div className="toolbar no-print">
        <div>
          <div className="text-[9px] uppercase tracking-[0.32em] font-extrabold text-slate-500">
            PDV
          </div>
          <div className="text-xs font-bold">Visualização de orçamento</div>
        </div>
        <div className="flex flex-row items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="hover:cursor-pointer hover:text-black"
          >
            <Link href="/historicovendas">
              <Power className="w-3 h-3" aria-hidden="true" />
              Sair
            </Link>
          </Button>
          <PrintShareMenu
            documentId={venda.id}
            filenamePrefix="orcamento-venda"
          />
        </div>
      </div>

      <div className="toolbar no-print">
        <div className="flex flex-row flex-wrap items-center gap-1">
          {Boolean(venda.observacoes) && <ObservacoesToggle label="Incluir observações internas" />}
          <PrintFilterToggles />
        </div>
      </div>

      <div data-print-pagination-root data-print-export-target>
        <PrintA4Paginator />
        <div data-print-pagination-source-holder>
          <div className="folha" data-print-pagination-source>
            <PrintDocumentHeader
          logoUrl={finalLogo}
          logoFallback="PDV"
          companyName={empresaNome}
          documentLabel="Venda"
          documentNumber={venda.id}
          status={
            String(venda.status) === "PAGAMENTO"
              ? "PEDIDO DE VENDA"
              : String(venda.status)
          }
          companyDetails={
            <>
              {empresaEndereco && <div>{empresaEndereco}</div>}
              {empresaLocal && <div>{empresaLocal}</div>}
              <div>
                {empresa?.telefone && (
                  <span>Tel: {fmtPhone(empresa.telefone)}</span>
                )}
                {empresa?.cnpj && <span> • CNPJ: {fmtDoc(empresa.cnpj)}</span>}
              </div>
            </>
          }
        />

        <div className="conteudo">
          <div className="meta-grid">
            <div className="meta-badge">
              <div className="label">Data da Venda</div>
              <div className="valor">
                {fmtDateTime(venda.datavenda || venda.createdat)}
              </div>
            </div>
            <div className="meta-badge">
              <div className="label">Impressão</div>
              <div className="valor">
                {new Date().toLocaleString("pt-BR", {
                  timeZone: "America/Fortaleza",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
            <div className="meta-badge">
              <div className="label">Itens</div>
              <div className="valor">{venda.itens?.length ?? 0}</div>
            </div>
            
            <div className="meta-badge">
              <div className="label">Criado por</div>
              <div className="valor">{fmtText(criadorNome)}</div>
            </div>
          </div>

          <div className={`grid-info${venda.descricao ? " grid-info-com-detalhes" : ""}`}>
            <div className="cartao cartao-destaque bloco-cliente">
              <div className="titulo-secao">
                <User className="w-4 h-4" aria-hidden="true" />
                Cliente
              </div>
              <div className="text-sm font-semibold">
                {cliente?.nomerazaosocial || "Consumidor não informado"}
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="kv">
                  <span className="k">Documento</span>
                  <span className="v">{fmtDoc(cliente?.cpfcnpj)}</span>
                </div>
                <div className="kv">
                  <span className="k">Telefone</span>
                  <span className="v">{fmtPhone(cliente?.telefone)}</span>
                </div>
                <div className="kv">
                  <span className="k">E-mail</span>
                  <span className="v">{cliente?.email || EMPTY}</span>
                </div>
              </div>
              {(clienteEndereco || clienteLocal) && (
                <div className="text-[10px] text-slate-500 mt-2">
                  {clienteEndereco && <div>{clienteEndereco}</div>}
                  {clienteLocal && <div>{clienteLocal}</div>}
                </div>
              )}
            </div>

            {venda.descricao ? (
              <div className="cartao cartao-destaque bloco-detalhes">
                <div className="titulo-secao">
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  Detalhes
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="flex flex-col gap-2 text-[9px]">
                    <span className="whitespace-pre-wrap text-slate-500">
                      {String(venda.descricao).toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="tabela-container" data-print-items-table>
            <table>
              <thead>
                <tr>
                  <th className="col-num">#</th>
                  <th>Descrição</th>
                  <th>Grupo</th>
                  <th className="col-qtd">Qtd</th>
                  <th className="col-unit">Unit.</th>
                  <th className="col-sub">Desc.</th>
                  <th className="col-sub">Total</th>
                </tr>
              </thead>
              <tbody>
                {(venda.itens || []).map((item: any, index: number) => (
                  <tr key={`${item.id}-${index}`}>
                    <td className="col-num">{index + 1}</td>
                    <td>
                      {item.produto?.titulo || EMPTY}
                      <CodigoProduto
                        id={item.produto?.id}
                        etiqueta={item.produto?.etiqueta}
                      />
                    </td>
                    <td>{item.produto?.grupo?.nome || EMPTY}</td>
                    <td className="col-qtd">{item.quantidade}</td>
                    <td className="col-unit">
                      {fmtMoney(
                        Number(item.sub_total || 0) /
                          Math.max(Number(item.quantidade || 1), 1),
                      )}
                    </td>
                    <td className="col-sub">
                      {fmtMoney(itemDiscountApplied(item))}
                    </td>
                    <td className="col-sub">{fmtMoney(item.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div data-print-final-block>
            <div className="rodape">
            <div>
              {venda.observacoes ? (
                <div className="observacoes-box venda-observacoes">
                  <div className="obs-titulo">
                    <FileText className="w-4 h-4 inline mr-1" aria-hidden="true" />
                    Observações
                  </div>
                  <div className="obs-texto">{venda.observacoes}</div>
                </div>
              ) : null}

              <div className="assinaturas">
                <div className="assinatura">
                  <div className="assin-label">Responsável pela venda</div>
                </div>
                <div className="assinatura">
                  <div className="assin-label">Cliente</div>
                </div>
              </div>
            </div>

            <div className="totais-box">
              <div className="linha-total">
                <span>Subtotal</span>
                <span>{fmtMoney(venda.sub_total)}</span>
              </div>
              <div className="linha-total">
                <span>Desconto dos itens</span>
                <span>- {fmtMoney(itemDiscountTotal)}</span>
              </div>
              <div className="linha-total">
                <span>Desconto geral</span>
                <span>- {fmtMoney(generalDiscountApplied)}</span>
              </div>
              <div className="linha-total">
                <span>Frete</span>
                <span>+ {fmtMoney(venda.valor_frete)}</span>
              </div>
              <div className="linha-total-final">
                <span className="total-label">Total</span>
                <span className="total-valor">
                  {fmtMoney(venda.valortotal)}
                </span>
              </div>

              {paymentSummary ? (
                <div className="pagamentos-resumo">
                  <div className="pagamentos-titulo">
                    {paymentSummary.title}
                  </div>
                  <div className="pagamentos-lista">
                    {paymentSummary.entries.map((payment, index) => (
                      <div
                        className="pagamento-linha"
                        key={`${payment.metodo}-${index}`}
                      >
                        <span className="pagamento-metodo">
                          {payment.label}
                          {payment.parcelas ? ` em ${payment.parcelas}x` : ""}
                        </span>
                        {payment.valor != null ? (
                          <span className="pagamento-valor">
                            {fmtMoney(payment.valor)}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
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
      </div>
    </div>
  );
}
