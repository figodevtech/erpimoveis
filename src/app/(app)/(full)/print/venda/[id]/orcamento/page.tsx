import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ObservacoesToggle } from "../../../../components/ObservacoesToggle";
import { PrintShareMenu } from "../../../../components/PrintShareMenu";
import { FileText, Power, ShoppingCart, User } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatCep } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/utils";
import { fetchPrimeiroLogoEmpresa } from "@/lib/empresa-logo";
import { fetchPrintColors } from "@/lib/print-config";

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
  if (s.length === 11)
    return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (s.length === 14)
    return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value;
}

function joinParts(parts: Array<string | null | undefined>, separator = ", ") {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(separator);
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
      sub_total,
      observacoes,
      valortotal,
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
        produto:produtoid (
          id,
          titulo,
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
  const finalLogo = await fetchPrimeiroLogoEmpresa();
  const printColors = await fetchPrintColors();
  const cliente = Array.isArray(venda.cliente)
    ? venda.cliente[0]
    : venda.cliente;
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

  return (
    <div className="os-print-root">
      <style>{`
        :root{
          --brand-primary:${printColors.primary};
          --brand-secondary:${printColors.secondary};
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
          .venda-observacoes{ display:block !important; }
          html, body{ margin:0 !important; padding:0 !important; background:#fff !important; }
          .no-print{ display:none !important; }
          .os-print-root{ padding:0 !important; background:none !important; min-height:auto !important; }
          .folha{ width:210mm !important; min-height:297mm !important; margin:0 !important; border:0 !important; box-shadow:none !important; }
          .conteudo{ min-height:auto !important; padding:8mm !important; }
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
        .logo-img{ width:100%; height:100%; object-fit:contain; }
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
        .os-label{ font-size:8px; text-transform:uppercase; letter-spacing:.2em; font-weight:800; }
        .os-numero{ font-size:22px; font-weight:900; margin:4px 0; }
        .meta-grid{ display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; }
        .meta-badge{ background:var(--soft-bg); border:1px solid var(--border); border-radius:8px; padding:8px; text-align:center; }
        .meta-badge .label{ font-size:8px; text-transform:uppercase; letter-spacing:.14em; color:var(--muted); font-weight:700; margin-bottom:4px; }
        .meta-badge .valor{ font-size:10px; font-weight:700; }
        .grid-info{ display:grid; grid-template-columns:1.4fr 1fr; gap:10px; }
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
        .col-num{ width:38px; text-align:center; font-weight:700; }
        .col-qtd{ width:52px; text-align:center; font-weight:700; }
        .col-unit, .col-sub{ width:110px; text-align:right; font-weight:700; }
        .rodape{ margin-top:auto; display:grid; grid-template-columns:1fr 320px; gap:10px; padding-top:8px; }
        .observacoes-box{ border:1px solid var(--border); background:var(--soft-bg); border-radius:var(--radius); padding:10px; }
        .venda-observacoes{ display:none; }
        html[data-os-observacoes="1"] .venda-observacoes{ display:block; }
        .obs-titulo{ font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--brand-primary); margin-bottom:6px; }
        .obs-texto{ font-size:10px; line-height:1.45; color:var(--muted); }
        .totais-box{ border:1px solid var(--brand-primary); background:linear-gradient(135deg, var(--primary-soft), #fff); border-radius:var(--radius); padding:12px; }
        .linha-total{ display:flex; justify-content:space-between; font-size:11px; padding:4px 0; color:var(--muted); }
        .linha-total-final{ margin-top:8px; padding-top:8px; border-top:1px solid var(--brand-primary); display:flex; justify-content:space-between; align-items:center; }
        .total-label{ font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--brand-primary); }
        .total-valor{ font-size:16px; font-weight:800; color:var(--brand-primary); }
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
              <Power className="w-3 h-3" />
              Sair
            </Link>
          </Button>
          <PrintShareMenu
            documentId={venda.id}
            filenamePrefix="orcamento-venda"
          />
        </div>
      </div>

      {Boolean(venda.observacoes) && (
        <div className="toolbar no-print">
          <div className="flex flex-row items-center gap-1">
            <ObservacoesToggle />
          </div>
        </div>
      )}

      <div className="folha" data-print-export-target>
        <div className="header-os">
          <div className="logo-box">
            {finalLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={finalLogo}
                alt="Logo da empresa"
                className="logo-img"
              />
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
                {empresa?.telefone && (
                  <span>Tel: {fmtPhone(empresa.telefone)}</span>
                )}
                {empresa?.cnpj && <span> • CNPJ: {fmtDoc(empresa.cnpj)}</span>}
              </div>
            </div>
          </div>

          <div className="os-header-box">
            <div className="os-label ">Venda</div>
            <div className="os-numero">#{venda.id}</div>
            <Badge className="text-xs text-white" variant="outline">
              {String(venda.status) === "PAGAMENTO"
                ? "PEDIDO DE VENDA"
                : String(venda.status)}
            </Badge>
          </div>
        </div>

        <div className="conteudo">
          <div className="meta-grid">
            <div className="meta-badge">
              <div className="label">Emitido em</div>
              <div className="valor">
                {fmtDateTime(venda.datavenda || venda.createdat)}
              </div>
            </div>
            <div className="meta-badge">
              <div className="label">Itens</div>
              <div className="valor">{venda.itens?.length ?? 0}</div>
            </div>
            <div className="meta-badge">
              <div className="label">Tipo desconto</div>
              <div className="valor">{venda.desconto_tipo || EMPTY}</div>
            </div>
            <div className="meta-badge">
              <div className="label">Desconto</div>
              <div className="valor">{fmtMoney(venda.desconto_valor)}</div>
            </div>
          </div>

          <div className="grid-info">
            <div className="cartao cartao-destaque">
              <div className="titulo-secao">
                <User className="w-4 h-4" />
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

            <div className="cartao cartao-destaque">
              <div className="titulo-secao">
                <ShoppingCart className="w-4 h-4" />
                Resumo
              </div>
              <div className="kv">
                <span className="k">Subtotal</span>
                <span className="v">{fmtMoney(venda.sub_total)}</span>
              </div>
              <div className="kv">
                <span className="k">Desconto</span>
                <span className="v">{fmtMoney(venda.desconto_valor)}</span>
              </div>
              <div className="kv">
                <span className="k">Total final</span>
                <span className="v">{fmtMoney(venda.valortotal)}</span>
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
                {(venda.itens || []).map((item: any, index: number) => (
                  <tr key={`${item.id}-${index}`}>
                    <td className="col-num">{index + 1}</td>
                    <td>{item.produto?.titulo || EMPTY}</td>
                    <td>{item.produto?.grupo?.nome || EMPTY}</td>
                    <td className="col-qtd">{item.quantidade}</td>
                    <td className="col-unit">
                      {fmtMoney(
                        Number(item.sub_total || 0) /
                          Math.max(Number(item.quantidade || 1), 1),
                      )}
                    </td>
                    <td className="col-sub">{fmtMoney(item.sub_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rodape">
            <div>
              {venda.observacoes ? (
                <div className="observacoes-box venda-observacoes">
                  <div className="obs-titulo">
                    <FileText className="w-4 h-4 inline mr-1" />
                    Observações
                  </div>
                  <div className="obs-texto">{venda.observacoes}</div>
                </div>
              ) : null}
            </div>

            <div className="totais-box">
              <div className="linha-total">
                <span>Subtotal</span>
                <span>{fmtMoney(venda.sub_total)}</span>
              </div>
              <div className="linha-total">
                <span>Desconto aplicado</span>
                <span>- {fmtMoney(venda.desconto_valor)}</span>
              </div>
              <div className="linha-total-final">
                <span className="total-label">Total</span>
                <span className="total-valor">
                  {fmtMoney(venda.valortotal)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

