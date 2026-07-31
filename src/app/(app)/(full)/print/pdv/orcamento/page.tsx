"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PrintButton } from "../../../components/PrintButton";
import { FileText, Power, ShoppingCart, User } from "lucide-react";
import {
  PDV_ORCAMENTO_STORAGE_PREFIX,
  PdvOrcamentoPrintData,
} from "../../../pdv/components/pdv-orcamento-print";
import { formatCep } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/utils";
import { getTermoAceiteVenda } from "@/lib/print-aceite";

const TERMO_ACEITE_PDV = getTermoAceiteVenda("ORCAMENTO");

type EmpresaConfig = {
  nomefantasia?: string;
  razaosocial?: string;
  telefone?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  uf?: string;
  cep?: string;
  cnpj?: string;
};

const EMPTY = "-";
function fmtMoney(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDateTime(v?: string | null) {
  if (!v) return EMPTY;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
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
  if (s.length === 11) {
    return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (s.length === 14) {
    return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value;
}

function joinParts(parts: Array<string | null | undefined>, separator = ", ") {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(separator);
}

function PrintPdvOrcamentoContent() {
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<PdvOrcamentoPrintData | null>(null);
  const [empresa, setEmpresa] = useState<EmpresaConfig | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const printedRef = useRef(false);

  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId) {
      setLoading(false);
      return;
    }

    try {
      const stored = localStorage.getItem(`${PDV_ORCAMENTO_STORAGE_PREFIX}${draftId}`);
      if (stored) {
        setDraft(JSON.parse(stored) as PdvOrcamentoPrintData);
      }
    } catch (error) {
      console.error("Erro ao carregar orçamento do PDV:", error);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    const loadEmpresa = async () => {
      try {
        const [empresaResponse, logoResponse] = await Promise.all([
          fetch("/api/config/empresa", { cache: "no-store" }),
          fetch("/api/config/empresa/logo", { cache: "no-store" }),
        ]);

        const empresaData = await empresaResponse.json();
        const logoData = await logoResponse.json();

        setEmpresa(empresaData?.empresa ?? null);
        setLogoUrl(logoData?.logoUrl ?? null);
      } catch (error) {
        console.error("Erro ao carregar empresa para impressão do orçamento:", error);
      } finally {
        setConfigLoading(false);
      }
    };

    loadEmpresa();
  }, []);

  useEffect(() => {
    if (!draft || configLoading || printedRef.current) return;

    printedRef.current = true;
    const timeout = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(timeout);
  }, [configLoading, draft]);

  const empresaNome = empresa?.nomefantasia || empresa?.razaosocial || "Empresa";
  const empresaEndereco = joinParts(
    [empresa?.endereco, empresa?.numero ? `Nº ${empresa.numero}` : null, empresa?.complemento],
    ", "
  );
  const empresaLocal = joinParts(
    [empresa?.bairro, empresa?.uf, empresa?.cep ? `CEP ${formatCep(empresa.cep)}` : null],
    " • "
  );

  const clienteEndereco = useMemo(() => {
    if (!draft?.customer) return "";
    return joinParts(
      [
        draft.customer.endereco,
        draft.customer.endereconumero ? `Nº ${draft.customer.endereconumero}` : null,
        draft.customer.enderecocomplemento,
      ],
      ", "
    );
  }, [draft]);

  const clienteLocal = useMemo(() => {
    if (!draft?.customer) return "";
    return joinParts(
      [
        draft.customer.bairro,
        draft.customer.cidade,
        draft.customer.estado,
        draft.customer.cep ? `CEP ${formatCep(draft.customer.cep)}` : null,
      ],
      " • "
    );
  }, [draft]);

  if (loading || configLoading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando orçamento...</div>;
  }

  if (!draft) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center p-6">
        <p className="text-lg font-semibold">Orçamento do PDV não encontrado.</p>
        <Button asChild variant="outline">
          <Link href="/pdv">Voltar ao PDV</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="os-print-root">
      <style>{`
        :root{
          --brand-primary:#2563eb;
          --brand-secondary:#0891b2;
          --ink:#0f172a;
          --muted:#64748b;
          --border:#cbd5e1;
          --paper:#ffffff;
          --soft-bg:#f8fafc;
          --radius:12px;
          --a4w:794px;
          --a4h:1123px;
          --os-scale:1;
        }
        @media print {
          :root{
            --a4w:210mm;
            --a4h:297mm;
          }
        }
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
        }
        .conteudo{
          padding:9mm;
          display:flex;
          flex-direction:column;
          gap:8px;
          min-height:var(--a4h);
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
          }
          .folha{
            width:210mm !important;
            min-height:297mm !important;
            margin:0 !important;
            border:0 !important;
            box-shadow:none !important;
          }
          .conteudo{
            min-height:auto !important;
            padding:8mm !important;
          }
        }
        .header-os{
          background:linear-gradient(135deg, var(--brand-primary), var(--brand-secondary));
          padding:14px 16px;
          color:white;
          display:grid;
          grid-template-columns:auto 1fr auto;
          gap:16px;
          align-items:center;
        }
        .logo-box{
          width:70px;
          height:70px;
          background:#fff;
          border-radius:10px;
          display:flex;
          align-items:center;
          justify-content:center;
          overflow:hidden;
          color:var(--brand-primary);
          font-size:24px;
          font-weight:800;
        }
        .logo-img{
          width:100%;
          height:100%;
          object-fit:contain;
        }
        .empresa-nome{ font-size:18px; font-weight:700; margin-bottom:4px; }
        .empresa-details{ font-size:9px; line-height:1.45; opacity:.95; }
        .os-header-box{
          background:rgba(255,255,255,.15);
          border:1px solid rgba(255,255,255,.3);
          border-radius:10px;
          padding:10px 14px;
          text-align:right;
          min-width:170px;
        }
        .os-label{
          font-size:8px;
          text-transform:uppercase;
          letter-spacing:.2em;
          font-weight:800;
        }
        .os-numero{
          font-size:22px;
          font-weight:900;
          margin:4px 0;
        }
        .meta-grid{
          display:grid;
          grid-template-columns:repeat(4, 1fr);
          gap:8px;
        }
        .meta-badge{
          background:var(--soft-bg);
          border:1px solid var(--border);
          border-radius:8px;
          padding:8px;
          text-align:center;
        }
        .meta-badge .label{
          font-size:8px;
          text-transform:uppercase;
          letter-spacing:.14em;
          color:var(--muted);
          font-weight:700;
          margin-bottom:4px;
        }
        .meta-badge .valor{
          font-size:10px;
          font-weight:700;
        }
        .grid-info{
          display:grid;
          grid-template-columns:1.4fr 1fr;
          gap:10px;
        }
        .cartao{
          border:1px solid var(--border);
          border-radius:var(--radius);
          background:#fff;
          padding:10px;
        }
        .cartao-destaque{
          background:linear-gradient(135deg, rgba(37,99,235,.08), rgba(8,145,178,.06));
        }
        .titulo-secao{
          display:flex;
          align-items:center;
          gap:8px;
          padding-bottom:6px;
          margin-bottom:8px;
          border-bottom:2px solid var(--border);
          font-size:10px;
          font-weight:700;
          text-transform:uppercase;
          letter-spacing:.08em;
          color:var(--brand-primary);
        }
        .kv{
          display:grid;
          grid-template-columns:85px 1fr;
          gap:6px;
          font-size:10px;
          line-height:1.35;
          margin-bottom:4px;
        }
        .kv .k{ color:var(--muted); font-weight:700; }
        .kv .v{
          font-weight:600;
          overflow-wrap:anywhere;
          white-space:normal;
        }
        .tabela-container{
          border:1px solid var(--border);
          border-radius:var(--radius);
          overflow:hidden;
          background:#fff;
        }
        table{ width:100%; border-collapse:collapse; }
        thead th{
          font-size:9px;
          text-transform:uppercase;
          letter-spacing:.12em;
          font-weight:900;
          color:white;
          padding:8px;
          background:linear-gradient(135deg, var(--brand-primary), var(--brand-primary));
          text-align:left;
        }
        tbody td{
          font-size:10px;
          padding:7px 8px;
          border-bottom:1px solid #f1f5f9;
          vertical-align:middle;
        }
        tbody tr:last-child td{ border-bottom:none; }
        .col-num{ width:38px; text-align:center; font-weight:700; }
        .col-qtd{ width:52px; text-align:center; font-weight:700; }
        .col-unit, .col-sub{ width:110px; text-align:right; font-weight:700; }
        .rodape{
          margin-top:auto;
          display:grid;
          grid-template-columns:1fr 320px;
          gap:10px;
          padding-top:8px;
        }
        .observacoes-box{
          border:1px solid var(--border);
          background:var(--soft-bg);
          border-radius:var(--radius);
          padding:10px;
        }
        .obs-titulo{
          font-size:10px;
          font-weight:800;
          text-transform:uppercase;
          letter-spacing:.08em;
          color:var(--brand-primary);
          margin-bottom:6px;
        }
        .obs-texto{
          font-size:10px;
          line-height:1.45;
          color:var(--muted);
        }
        .totais-box{
          border:1px solid var(--brand-primary);
          background:linear-gradient(135deg, rgba(37,99,235,.08), #fff);
          border-radius:var(--radius);
          padding:12px;
        }
        .linha-total{
          display:flex;
          justify-content:space-between;
          font-size:11px;
          padding:4px 0;
          color:var(--muted);
        }
        .linha-total-final{
          margin-top:8px;
          padding-top:8px;
          border-top:1px solid var(--brand-primary);
          display:flex;
          justify-content:space-between;
          align-items:center;
        }
        .total-label{
          font-size:12px;
          font-weight:800;
          text-transform:uppercase;
          letter-spacing:.08em;
          color:var(--brand-primary);
        }
        .total-valor{
          font-size:16px;
          font-weight:800;
          color:var(--brand-primary);
        }
        .assinaturas{
          margin-top:35px;
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:12px;
        }
        .assinatura{
          border-top:2px solid var(--border);
          padding-top:8px;
          text-align:center;
        }
        .assin-label{
          font-size:9px;
          text-transform:uppercase;
          letter-spacing:.12em;
          color:var(--muted);
          font-weight:700;
        }
        .aceite-box{
          margin-top:10px;
          border:1px solid var(--border);
          background:var(--soft-bg);
          border-radius:var(--radius);
          padding:8px 10px;
        }
        .aceite-titulo{
          font-size:8px;
          font-weight:800;
          text-transform:uppercase;
          letter-spacing:.12em;
          color:var(--brand-primary);
          margin-bottom:4px;
        }
        .aceite-intro{
          font-size:8px;
          font-weight:700;
          line-height:1.4;
          color:var(--ink);
          margin-bottom:4px;
        }
        .aceite-item{
          font-size:8px;
          line-height:1.4;
          text-align:justify;
          color:var(--ink);
          margin-bottom:3px;
        }
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
          <Button asChild size="sm" variant="outline" className="hover:cursor-pointer hover:text-black">
            <Link href="/pdv">
              <Power className="w-3 h-3" />
              Sair
            </Link>
          </Button>
          <PrintButton />
        </div>
      </div>

      <div className="folha">
        <div className="header-os">
          <div className="logo-box">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo da empresa" className="logo-img" />
            ) : (
              "PDV"
            )}
          </div>

          <div>
            <div className="empresa-nome">{empresaNome}</div>
            <div className="empresa-details">
              {empresaEndereco && <div>{empresaEndereco}</div>}
              {empresaLocal && <div>{empresaLocal}</div>}
              <div>
                {empresa?.telefone && <span>Tel: {fmtPhone(empresa.telefone)}</span>}
                {empresa?.cnpj && <span> • CNPJ: {fmtDoc(empresa.cnpj)}</span>}
              </div>
            </div>
          </div>

          <div className="os-header-box">
            <div className="os-label">Orçamento PDV</div>
            <div className="os-numero">#{draft.customer?.id ?? "AVULSO"}</div>
            <Badge className="text-xs text-white" variant="outline">
              Não faturado
            </Badge>
          </div>
        </div>

        <div className="conteudo">
          <div className="meta-grid">
            <div className="meta-badge">
              <div className="label">Emitido em</div>
              <div className="valor">{fmtDateTime(draft.createdAt)}</div>
            </div>
            <div className="meta-badge">
              <div className="label">Itens</div>
              <div className="valor">{draft.items.length}</div>
            </div>
            <div className="meta-badge">
              <div className="label">Tipo desconto</div>
              <div className="valor">{draft.discountType ?? EMPTY}</div>
            </div>
            <div className="meta-badge">
              <div className="label">Desconto</div>
              <div className="valor">{fmtMoney(draft.discountAmount)}</div>
            </div>
          </div>

          <div className="grid-info">
            <div className="cartao cartao-destaque">
              <div className="titulo-secao">
                <User className="w-4 h-4" />
                Cliente
              </div>
              <div className="text-sm font-semibold">
                {draft.customer?.nomerazaosocial || "Consumidor não informado"}
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="kv">
                  <span className="k">Documento</span>
                  <span className="v">{fmtDoc(draft.customer?.cpfcnpj)}</span>
                </div>
                <div className="kv">
                  <span className="k">Telefone</span>
                  <span className="v">{fmtPhone(draft.customer?.telefone)}</span>
                </div>
                <div className="kv">
                  <span className="k">E-mail</span>
                  <span className="v">{draft.customer?.email || EMPTY}</span>
                </div>
              </div>
              {(clienteEndereco || clienteLocal) && (
                <div className="text-[10px] text-slate-500 mt-2">
                  {clienteEndereco && <div>{clienteEndereco}</div>}
                  {clienteLocal && <div>{clienteLocal}</div>}
                </div>
              )}
            </div>

            <div className="cartao cartao-destaque">
              <div className="titulo-secao">
                <ShoppingCart className="w-4 h-4" />
                Resumo
              </div>
              <div className="kv">
                <span className="k">Subtotal</span>
                <span className="v">{fmtMoney(draft.subtotal)}</span>
              </div>
              <div className="kv">
                <span className="k">Desconto</span>
                <span className="v">
                  {fmtMoney(draft.discountAmount)}
                  {draft.discountType === "PORCENTAGEM"
                    ? ` (${draft.discountInput.toFixed(2)}%)`
                    : draft.discountType === "FIXO"
                    ? ` (${fmtMoney(draft.discountInput)})`
                    : ""}
                </span>
              </div>
              <div className="kv">
                <span className="k">Total final</span>
                <span className="v">{fmtMoney(draft.total)}</span>
              </div>
            </div>
          </div>

          <div className="tabela-container">
            <table>
              <thead>
                <tr>
                  <th className="col-num">#</th>
                  <th>Descrição</th>
                  <th>Grupo</th>
                  <th className="col-qtd">Qtd</th>
                  <th className="col-unit">Unit.</th>
                  <th className="col-sub">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {draft.items.map((item, index) => (
                  <tr key={`${item.id}-${index}`}>
                    <td className="col-num">{index + 1}</td>
                    <td>{item.titulo}</td>
                    <td>{item.grupo || EMPTY}</td>
                    <td className="col-qtd">{item.quantity}</td>
                    <td className="col-unit">{fmtMoney(item.precovenda)}</td>
                    <td className="col-sub">{fmtMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rodape">
            <div>
              <div className="observacoes-box">
                <div className="obs-titulo">
                  <FileText className="w-4 h-4 inline mr-1" />
                  Observações
                </div>
                <div className="obs-texto">
                  Este orçamento foi gerado pelo PDV e não representa faturamento ou reserva definitiva de estoque.
                </div>
              </div>

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
                <span>{fmtMoney(draft.subtotal)}</span>
              </div>
              <div className="linha-total">
                <span>Desconto aplicado</span>
                <span>- {fmtMoney(draft.discountAmount)}</span>
              </div>
              <div className="linha-total-final">
                <span className="total-label">Total</span>
                <span className="total-valor">{fmtMoney(draft.total)}</span>
              </div>
            </div>
          </div>

          {TERMO_ACEITE_PDV && (
            <div className="aceite-box">
              <div className="aceite-titulo">{TERMO_ACEITE_PDV.titulo}</div>
              <div className="aceite-intro">{TERMO_ACEITE_PDV.intro}</div>
              {TERMO_ACEITE_PDV.itens.map((item, idx) => (
                <div key={idx} className="aceite-item">
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PrintPdvOrcamentoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Carregando orçamento...
        </div>
      }
    >
      <PrintPdvOrcamentoContent />
    </Suspense>
  );
}
