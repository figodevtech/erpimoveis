// Impressão do orçamento avulso.
//
// Versão enxuta da folha da OS: mesmo cabeçalho de documento, mesma escala A4 e
// mesmas cores de marca, sem o que só existe numa OS (alvo, checklist, garantia,
// realizadores, assinatura de responsável técnico). Um orçamento é proposta
// comercial — o que precisa ficar legível é quem, o quê e quanto.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import { FileText, User } from "lucide-react";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Button } from "@/components/ui/button";
import { PrintShareMenu } from "../../../components/PrintShareMenu";
import {
  PRINT_DOCUMENT_HEADER_CSS,
  PrintDocumentHeader,
} from "../../../components/PrintDocumentHeader";
import { fetchPrimeiroLogoEmpresa } from "@/lib/empresa-logo";
import { fetchPrintColors } from "@/lib/print-config";

export const runtime = "nodejs";

type PageProps = { params: Promise<{ id: string }> };

const EMPTY = "-";

function toNumber(value: unknown) {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : 0;
}

function fmtMoney(value: unknown) {
  return toNumber(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtQtd(value: unknown) {
  const numero = toNumber(value);
  return Number.isInteger(numero)
    ? String(numero)
    : numero.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function fmtPercent(value: unknown) {
  return toNumber(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function fmtDateTime(value?: string | null) {
  if (!value) return EMPTY;
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return EMPTY;
  return data.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  });
}

function fmtText(value?: string | number | null) {
  if (value == null) return EMPTY;
  const texto = String(value).trim();
  return texto || EMPTY;
}

function fmtDoc(cpfCnpj: unknown) {
  const digitos = String(cpfCnpj ?? "").replace(/\D/g, "");
  if (!digitos) return EMPTY;
  if (digitos.length === 11) return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digitos.length === 14)
    return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return digitos;
}

function fmtPhone(value?: string | null) {
  const digitos = String(value ?? "").replace(/\D/g, "");
  if (digitos.length === 11) return digitos.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (digitos.length === 10) return digitos.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value || EMPTY;
}

function joinParts(parts: Array<string | null | undefined>, separador = ", ") {
  return parts
    .map((parte) => (parte ?? "").toString().trim())
    .filter((parte) => parte.length > 0)
    .join(separador);
}

function descontoEmReais(base: number, tipo: unknown, desconto: unknown) {
  const valor = Math.max(0, toNumber(desconto));
  const baseSegura = Math.max(0, base);
  if (!valor || !baseSegura) return 0;
  if (tipo === "PORCENTAGEM") return Math.round(baseSegura * (Math.min(valor, 100) / 100) * 100) / 100;
  if (tipo === "FIXO") return Math.round(Math.min(valor, baseSegura) * 100) / 100;
  return 0;
}

async function fetchEmpresa() {
  const { data, error } = await supabaseAdmin.from("empresa").select("*").single();
  if (error) {
    console.error("Erro ao buscar empresa:", error);
    return null;
  }
  return data ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Orçamento #${id}` };
}

export default async function OrcamentoPrintPage({ params }: PageProps) {
  const { id: idTexto } = await params;
  const orcamentoId = Number(idTexto);
  if (!Number.isInteger(orcamentoId) || orcamentoId <= 0) notFound();

  const { data: orcamento, error } = await supabaseAdmin
    .from("orcamento")
    .select(
      `
      *,
      cliente:clienteid (*),
      veiculo:veiculoid (*),
      criador:usuariocriadorid ( id, nome ),
      produtos:orcamento_produto (*, produto:produtoid (*)),
      produtosAvulsos:orcamento_produto_avulso (*),
      servicos:orcamento_servico (*, servico:servicoid (*))
    `,
    )
    .eq("id", orcamentoId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error || !orcamento) {
    if (error) console.error("Erro ao carregar orçamento:", error);
    notFound();
  }

  const empresa = await fetchEmpresa();
  const logo = await fetchPrimeiroLogoEmpresa();
  const printColors = await fetchPrintColors();

  // Uma linha por item, produtos antes de serviços — a mesma ordem da tela.
  const itens = [
    ...(orcamento.produtos ?? []).map((item: any) => ({
      tipo: "PEÇA" as const,
      descricao: String(item.produto?.titulo || item.produto?.descricao || "Produto"),
      identificador: item.produto?.referencia || item.produto?.etiqueta || null,
      quantidade: toNumber(item.quantidade),
      unitario: toNumber(item.precounitario),
      descontoTipo: item.desconto_tipo,
      desconto: toNumber(item.desconto),
      subtotal: toNumber(item.subtotal),
    })),
    ...(orcamento.produtosAvulsos ?? []).map((item: any) => ({
      tipo: "PEÇA" as const,
      descricao: String(item.titulo || "Produto avulso"),
      identificador: null,
      quantidade: toNumber(item.quantidade),
      unitario: toNumber(item.precounitario),
      descontoTipo: item.desconto_tipo,
      desconto: toNumber(item.desconto),
      subtotal: toNumber(item.subtotal),
    })),
    ...(orcamento.servicos ?? []).map((item: any) => ({
      tipo: "SERVIÇO" as const,
      descricao: String(item.servico?.descricao || "Serviço"),
      identificador: item.servico?.codigo || null,
      subdescricao: item.descricao ? String(item.descricao) : null,
      quantidade: toNumber(item.quantidade),
      unitario: toNumber(item.precounitario),
      descontoTipo: item.desconto_tipo,
      desconto: toNumber(item.desconto),
      subtotal: toNumber(item.subtotal),
    })),
  ];

  const totalProdutos =
    (orcamento.produtos ?? []).reduce((acc: number, i: any) => acc + toNumber(i.subtotal), 0) +
    (orcamento.produtosAvulsos ?? []).reduce((acc: number, i: any) => acc + toNumber(i.subtotal), 0);
  const totalServicos = (orcamento.servicos ?? []).reduce(
    (acc: number, i: any) => acc + toNumber(i.subtotal),
    0,
  );

  const subtotal = toNumber(orcamento.subtotal);
  const descontoAplicado = descontoEmReais(subtotal, orcamento.desconto_tipo, orcamento.desconto);
  const valorFrete = toNumber(orcamento.valor_frete);
  const total = toNumber(orcamento.total);

  const empresaNome = empresa?.nomefantasia || empresa?.razaosocial || "Oficina Mecânica";
  const empresaEndereco = joinParts([
    empresa?.endereco,
    empresa?.endereconumero,
    empresa?.enderecocomplemento,
  ]);
  const empresaLocal = joinParts([empresa?.bairro, empresa?.cidade, empresa?.estado], " • ");

  const veiculo = orcamento.veiculo;
  const veiculoTexto = veiculo
    ? joinParts([veiculo.marca, veiculo.modelo, veiculo.placa], " • ")
    : null;

  const situacao = orcamento.status === "CONVERTIDO" ? "Convertido em OS" : "Em aberto";

  const meta = [
    { k: "Emitido em", v: fmtDateTime(orcamento.created_at) },
    { k: "Situação", v: situacao },
    { k: "Responsável", v: fmtText(orcamento.criador?.nome) },
    { k: "Itens", v: String(itens.length) },
  ];

  return (
    <div className="orc-print-root">
      <Script id="orc-print-scale" strategy="afterInteractive">{`
        (function () {
          function aplicarEscala() {
            var a4w = 794;
            var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            var disponivel = Math.max(320, vw - 16);
            var escala = Math.min(1, disponivel / a4w);
            document.documentElement.style.setProperty('--orc-scale', String(escala));
          }
          aplicarEscala();
          window.addEventListener('resize', aplicarEscala, { passive: true });
          window.addEventListener('orientationchange', aplicarEscala);
          window.addEventListener('beforeprint', function () {
            document.documentElement.style.setProperty('--orc-scale', '1');
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
          --border:#cbd5e1;
          --paper:#ffffff;
          --soft-bg:#f8fafc;
          --primary-soft: color-mix(in srgb, var(--brand-primary) 8%, transparent);
          --radius: 12px;
          --a4w: 794px;
          --a4h: 1123px;
          --orc-scale: 1;
        }

        ${PRINT_DOCUMENT_HEADER_CSS}

        *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        @page{ size:A4; margin:0; }

        .orc-print-root{
          min-height:100vh;
          padding:20px 0;
          background:linear-gradient(135deg,#f1f5f9,#e2e8f0);
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
          color:var(--ink);
        }

        .barra-acoes{
          width:min(var(--a4w), calc(100vw - 16px));
          margin:0 auto 12px;
          display:flex;
          gap:8px;
          justify-content:flex-end;
          flex-wrap:wrap;
        }

        .folha-scaler{
          width:calc(var(--a4w) * var(--orc-scale));
          height:calc(var(--a4h) * var(--orc-scale));
          margin:0 auto;
        }

        .folha{
          width:var(--a4w);
          height:var(--a4h);
          transform:scale(var(--orc-scale));
          transform-origin:top left;
          background:var(--paper);
          box-shadow:0 10px 30px rgba(15,23,42,.15);
          display:flex;
          flex-direction:column;
          overflow:hidden;
        }

        .conteudo{
          flex:1;
          min-height:0;
          padding:18px 26px 22px;
          display:flex;
          flex-direction:column;
          gap:14px;
        }

        .meta-grid{
          display:grid;
          grid-template-columns:repeat(4,1fr);
          gap:8px;
        }
        .meta-badge{
          border:1px solid var(--border);
          border-radius:8px;
          padding:6px 9px;
          background:var(--soft-bg);
        }
        .meta-badge .label{ font-size:8px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
        .meta-badge .valor{ font-size:11px; font-weight:600; }

        .cartao{
          border:1px solid var(--border);
          border-radius:var(--radius);
          padding:10px 12px;
          background:var(--paper);
        }
        .cartao-destaque{ background:var(--primary-soft); border-color:color-mix(in srgb, var(--brand-primary) 30%, var(--border)); }
        .titulo-secao{
          display:flex; align-items:center; gap:6px;
          font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
          color:var(--brand-primary); margin-bottom:6px;
        }
        .nome-cliente{ font-size:14px; font-weight:700; line-height:1.2; }
        .linha-dado{ font-size:10px; color:var(--muted); }
        .linha-dado strong{ color:var(--ink); font-weight:600; }

        .tabela-container{ flex:1; min-height:0; overflow:hidden; border:1px solid var(--border); border-radius:var(--radius); }
        table{ width:100%; border-collapse:collapse; font-size:10px; }
        thead th{
          background:var(--brand-primary); color:#fff;
          text-align:left; padding:6px 8px; font-size:9px;
          text-transform:uppercase; letter-spacing:.04em; font-weight:600;
        }
        tbody td{ padding:5px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
        tbody tr:nth-child(even){ background:var(--soft-bg); }
        .col-num{ width:26px; text-align:center; color:var(--muted); }
        .col-tipo{ width:64px; }
        .col-qtd{ width:44px; text-align:center; }
        .col-valor{ width:78px; text-align:right; }
        .col-desconto{ width:76px; text-align:right; }
        .tipo-peca, .tipo-servico{
          display:inline-block; padding:1px 6px; border-radius:999px;
          font-size:8px; font-weight:700; letter-spacing:.04em;
        }
        .tipo-peca{ background:color-mix(in srgb, var(--brand-secondary) 18%, transparent); color:var(--brand-secondary); }
        .tipo-servico{ background:color-mix(in srgb, var(--brand-primary) 15%, transparent); color:var(--brand-primary); }
        .item-identificador{ margin-left:6px; font-size:8px; color:var(--muted); }
        .item-subdescricao{ margin-top:2px; font-size:8px; color:var(--muted); line-height:1.35; }
        .desconto-percentual{ font-size:8px; color:var(--muted); }

        .rodape{ display:grid; grid-template-columns:1fr 250px; gap:14px; align-items:end; }
        .observacoes-box{
          border:1px solid var(--border); border-radius:8px;
          padding:8px 10px; background:var(--soft-bg); margin-bottom:8px;
        }
        .obs-titulo{ font-size:8px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:2px; }
        .obs-texto{ font-size:10px; line-height:1.4; white-space:pre-wrap; }

        .totais-box{ border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
        .linha-total{
          display:flex; justify-content:space-between; gap:10px;
          padding:5px 10px; font-size:10px; border-bottom:1px solid #e2e8f0;
        }
        .linha-total .label{ color:var(--muted); }
        .linha-total .valor{ font-weight:600; font-variant-numeric:tabular-nums; }
        .linha-total-final{
          background:var(--brand-primary); color:#fff;
          padding:8px 10px; display:flex; justify-content:space-between;
          font-size:13px; font-weight:700; border-bottom:none;
        }

        .assinatura{ margin-top:14px; border-top:1px solid var(--ink); padding-top:4px; width:230px; }
        .assin-label{ font-size:9px; color:var(--muted); }

        .aviso-validade{
          font-size:8.5px; color:var(--muted); line-height:1.4;
          border-top:1px dashed var(--border); padding-top:6px; margin-top:2px;
        }

        @media print{
          :root{ --a4w:210mm; --a4h:297mm; --orc-scale:1; }
          .orc-print-root{ padding:0; background:#fff; }
          .barra-acoes{ display:none !important; }
          .folha-scaler{ width:auto; height:auto; }
          .folha{ box-shadow:none; transform:none; }
        }
      `}</style>

      <div className="barra-acoes">
        <Link href="/orcamentos">
          <Button variant="outline" size="sm">
            Voltar
          </Button>
        </Link>
        <PrintShareMenu documentId={String(orcamento.id)} filenamePrefix="orcamento" />
      </div>

      <div className="folha-scaler">
        <div className="folha" data-print-export-target>
          <PrintDocumentHeader
            logoUrl={logo}
            logoFallback="ORC"
            companyName={empresaNome}
            documentLabel="Orçamento"
            documentNumber={orcamento.id}
            status={situacao}
            companyDetails={
              <>
                {empresaEndereco && <div>{empresaEndereco}</div>}
                {empresaLocal && <div>{empresaLocal}</div>}
                <div>
                  {empresa?.telefone && <span>Tel: {fmtPhone(empresa.telefone)}</span>}
                  {empresa?.cnpj && <span> • CNPJ: {fmtDoc(empresa.cnpj)}</span>}
                </div>
              </>
            }
          />

          <div className="conteudo">
            <div className="meta-grid">
              {meta.map((item) => (
                <div key={item.k} className="meta-badge">
                  <div className="label">{item.k}</div>
                  <div className="valor">{item.v}</div>
                </div>
              ))}
            </div>

            <div className="cartao cartao-destaque">
              <div className="titulo-secao">
                <User className="w-3 h-3" aria-hidden="true" />
                Cliente
              </div>

              {orcamento.cliente ? (
                <>
                  <div className="nome-cliente">
                    {String(orcamento.cliente.nomerazaosocial ?? "").toUpperCase() || EMPTY}
                  </div>
                  <div className="linha-dado">
                    {orcamento.cliente.cpfcnpj ? (
                      <span>
                        <strong>Doc:</strong> {fmtDoc(orcamento.cliente.cpfcnpj)}
                      </span>
                    ) : null}
                    {orcamento.cliente.telefone ? (
                      <span>
                        {" • "}
                        <strong>Tel:</strong> {fmtPhone(orcamento.cliente.telefone)}
                      </span>
                    ) : null}
                    {orcamento.cliente.email ? (
                      <span>
                        {" • "}
                        {orcamento.cliente.email}
                      </span>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="nome-cliente">CONSUMIDOR NÃO IDENTIFICADO</div>
              )}

              {veiculoTexto ? (
                <div className="linha-dado" style={{ marginTop: 4 }}>
                  <strong>Veículo:</strong> {veiculoTexto}
                </div>
              ) : null}

              {orcamento.descricao ? (
                <div className="linha-dado" style={{ marginTop: 4 }}>
                  <strong>Referente a:</strong> {orcamento.descricao}
                </div>
              ) : null}
            </div>

            {itens.length > 0 ? (
              <div className="tabela-container">
                <table>
                  <thead>
                    <tr>
                      <th className="col-num">#</th>
                      <th className="col-tipo">Tipo</th>
                      <th>Descrição</th>
                      <th className="col-qtd">Qtd</th>
                      <th className="col-valor">Unit.</th>
                      <th className="col-desconto">Desconto</th>
                      <th className="col-valor">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item, indice) => {
                      const abatido = descontoEmReais(
                        item.quantidade * item.unitario,
                        item.descontoTipo,
                        item.desconto,
                      );

                      return (
                        <tr key={`${item.tipo}-${indice}`}>
                          <td className="col-num">{indice + 1}</td>
                          <td className="col-tipo">
                            <span className={item.tipo === "SERVIÇO" ? "tipo-servico" : "tipo-peca"}>
                              {item.tipo}
                            </span>
                          </td>
                          <td>
                            <div>
                              {item.descricao}
                              {item.identificador ? (
                                <span className="item-identificador">{item.identificador}</span>
                              ) : null}
                            </div>
                            {"subdescricao" in item && item.subdescricao ? (
                              <div className="item-subdescricao">{item.subdescricao}</div>
                            ) : null}
                          </td>
                          <td className="col-qtd">{fmtQtd(item.quantidade)}</td>
                          <td className="col-valor">{fmtMoney(item.unitario)}</td>
                          <td className="col-desconto">
                            {abatido > 0 ? (
                              <>
                                <div>- {fmtMoney(abatido)}</div>
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
                          <td className="col-valor">{fmtMoney(item.subtotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="cartao" style={{ textAlign: "center", color: "var(--muted)" }}>
                <FileText className="w-4 h-4" style={{ margin: "0 auto 4px" }} aria-hidden="true" />
                Orçamento sem itens.
              </div>
            )}

            <div className="rodape">
              <div>
                {orcamento.observacoes ? (
                  <div className="observacoes-box">
                    <div className="obs-titulo">Observações</div>
                    <div className="obs-texto">{orcamento.observacoes}</div>
                  </div>
                ) : null}

                <div className="aviso-validade">
                  Este documento é uma proposta comercial e não autoriza a execução do serviço nem
                  reserva peças em estoque. A disponibilidade dos itens é confirmada na abertura da
                  ordem de serviço.
                </div>

                <div className="assinatura">
                  <div className="assin-label">Aceite do cliente</div>
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
                <div className="linha-total">
                  <span className="label">Subtotal</span>
                  <span className="valor">{fmtMoney(subtotal)}</span>
                </div>
                {descontoAplicado > 0 ? (
                  <div className="linha-total">
                    <span className="label">
                      Desconto
                      {orcamento.desconto_tipo === "PORCENTAGEM"
                        ? ` (${fmtPercent(orcamento.desconto)}%)`
                        : ""}
                    </span>
                    <span className="valor">- {fmtMoney(descontoAplicado)}</span>
                  </div>
                ) : null}
                {valorFrete > 0 ? (
                  <div className="linha-total">
                    <span className="label">Frete</span>
                    <span className="valor">{fmtMoney(valorFrete)}</span>
                  </div>
                ) : null}
                <div className="linha-total-final">
                  <span>Total</span>
                  <span>{fmtMoney(total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
