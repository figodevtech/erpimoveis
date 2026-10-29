import type { Metadata } from "next";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  alturaLinha,
  paginar,
  type Celula,
  type Fatia,
  type Linha,
  type Secao,
  type Tom,
} from "./report-model";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Relatório consolidado — impressão" };

type Params = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Params> };

const OFFSET = "-03:00";
/** Teto por seção: sem ele um mês movimentado vira um PDF de centenas de folhas. */
const LIMITE_POR_SECAO = 300;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }).format(date);
}
function dayOnly(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short" }).format(date);
}
function br(value: string) {
  return value ? value.split("-").reverse().join("/") : "";
}
function dayStart(value: string) {
  return new Date(`${value}T00:00:00${OFFSET}`).toISOString();
}
function nextDay(value: string) {
  return new Date(new Date(`${value}T00:00:00${OFFSET}`).getTime() + 86_400_000).toISOString();
}
function joinParts(...parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? "").trim()).filter(Boolean).join(" · ");
}
function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
function texto(value: unknown, fallback = "—") {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

export default async function RelatorioDiarioPrintPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, one(value)]));

  const dateFrom = params.dateFrom ?? "";
  const dateTo = params.dateTo ?? "";

  /** Aplica o recorte do período sobre a coluna de data de cada entidade. */
  const noPeriodo = (query: any, coluna: string) => {
    let escopo = query;
    if (dateFrom) escopo = escopo.gte(coluna, dayStart(dateFrom));
    if (dateTo) escopo = escopo.lt(coluna, nextDay(dateTo));
    return escopo;
  };

  const [
    vendasRes,
    transacoesRes,
    entradasRes,
    produtosRes,
    usuariosRes,
    clientesRes,
    nfeRes,
    nfseRes,
  ] = await Promise.all([
    noPeriodo(
      supabaseAdmin
        .from("venda")
        .select("id, status, valortotal, datavenda, forma_pagamento, canal, cliente:clienteid ( nomerazaosocial ), vendedor_rel:vendedor ( nome )")
        .order("datavenda", { ascending: true })
        .limit(LIMITE_POR_SECAO),
      "datavenda",
    ),
    noPeriodo(
      supabaseAdmin
        .from("transacao")
        .select('id, descricao, valor, "valorLiquido", data, metodopagamento, categoria, tipo, pendente')
        .eq("is_deleted", false)
        .order("data", { ascending: true })
        .limit(LIMITE_POR_SECAO),
      "data",
    ),
    noPeriodo(
      supabaseAdmin
        .from("entrada")
        .select("id, tipo, status, fiscal, notachave, created_at, fornecedor:fornecedorid ( nomerazaosocial )")
        .order("created_at", { ascending: true })
        .limit(LIMITE_POR_SECAO),
      "created_at",
    ),
    noPeriodo(
      supabaseAdmin
        .from("produto")
        .select("id, titulo, referencia, estoque, estoqueminimo, status_estoque, createdat")
        .eq("is_deleted", false)
        .order("createdat", { ascending: true })
        .limit(LIMITE_POR_SECAO),
      "createdat",
    ),
    noPeriodo(
      supabaseAdmin
        .from("usuario")
        .select("id, nome, email, ativo, createdat, perfil:perfilid ( nome ), setor:setorid ( nome )")
        .order("createdat", { ascending: true })
        .limit(LIMITE_POR_SECAO),
      "createdat",
    ),
    noPeriodo(
      supabaseAdmin
        .from("cliente")
        .select("id, nomerazaosocial, cidade, estado, status, createdat")
        .eq("is_deleted", false)
        .order("createdat", { ascending: true })
        .limit(LIMITE_POR_SECAO),
      "createdat",
    ),

    noPeriodo(
      supabaseAdmin
        .from("nfe")
        .select("id, status, numero, total_nfe, dataemissao, vendaid")
        .eq("is_deleted", false)
        .order("dataemissao", { ascending: true })
        .limit(LIMITE_POR_SECAO),
      "dataemissao",
    ),
    noPeriodo(
      supabaseAdmin
        .from("nfse")
        .select("id, status, numero, valor_total, dataemissao")
        .order("dataemissao", { ascending: true })
        .limit(LIMITE_POR_SECAO),
      "dataemissao",
    ),
  ]);

  const erro = [
    vendasRes, transacoesRes, entradasRes,
    produtosRes, usuariosRes, clientesRes, nfeRes, nfseRes,
  ].find((resultado) => resultado.error)?.error;
  if (erro) throw new Error(`Não foi possível gerar o relatório: ${erro.message}`);

  const vendas = vendasRes.data ?? [];
  const transacoes = transacoesRes.data ?? [];
  const entradas = entradasRes.data ?? [];
  const produtos = produtosRes.data ?? [];
  const usuarios = usuariosRes.data ?? [];
  const clientes = clientesRes.data ?? [];
  const nfes = nfeRes.data ?? [];
  const nfses = nfseRes.data ?? [];

  const isEntrada = (row: any) => row.tipo === "RECEITA" || row.tipo === "DEPOSITO";
  const valorEfetivo = (row: any) => toNumber(row.valorLiquido ?? row.valor);
  const realizadas = transacoes.filter((row: any) => row.pendente !== true);
  const receitas = realizadas.filter(isEntrada).reduce((soma: number, row: any) => soma + valorEfetivo(row), 0);
  const despesas = realizadas
    .filter((row: any) => !isEntrada(row))
    .reduce((soma: number, row: any) => soma + valorEfetivo(row), 0);

  const movimentacoes =
    vendas.length + transacoes.length + entradas.length +
    produtos.length + usuarios.length + clientes.length + nfes.length + nfses.length;

  const cortada = (linhas: unknown[]) =>
    linhas.length >= LIMITE_POR_SECAO
      ? `Mostrando as primeiras ${LIMITE_POR_SECAO} linhas do período. Reduza o período para ver o restante.`
      : undefined;

  const valor = (numero: number, tom: Tom = "neutro"): Celula => ({
    principal: money(numero),
    tom,
    forte: true,
  });

  const secoes: Secao[] = [
    {
      id: "vendas",
      titulo: "Vendas",
      vazio: "Nenhuma venda no período.",
      aviso: cortada(vendas),
      colunas: [
        { titulo: "Venda", largura: "16mm" },
        { titulo: "Data", largura: "22mm" },
        { titulo: "Cliente / vendedor" },
        { titulo: "Status", largura: "28mm" },
        { titulo: "Valor", largura: "28mm", direita: true },
      ],
      linhas: vendas.map((row: any) => ({
        chave: `venda-${row.id}`,
        celulas: [
          { principal: `#${row.id}` },
          { principal: dayOnly(row.datavenda) },
          {
            principal: texto(relationOne<any>(row.cliente)?.nomerazaosocial, "Sem cliente"),
            apoio: joinParts(relationOne<any>(row.vendedor_rel)?.nome, row.forma_pagamento, row.canal),
          },
          { principal: texto(row.status) },
          { principal: money(row.valortotal), tom: "positivo", forte: true },
        ],
      })),
      rodape: [
        { principal: "Total", forte: true },
        { principal: "" },
        { principal: `${vendas.length} venda(s)` },
        { principal: "" },
        valor(vendas.reduce((soma: number, row: any) => soma + toNumber(row.valortotal), 0), "positivo"),
      ],
    },
    {
      id: "transacoes",
      titulo: "Transações financeiras",
      vazio: "Nenhuma transação no período.",
      aviso: cortada(transacoes),
      colunas: [
        { titulo: "ID", largura: "14mm" },
        { titulo: "Data", largura: "22mm" },
        { titulo: "Descrição" },
        { titulo: "Situação", largura: "24mm" },
        { titulo: "Valor", largura: "30mm", direita: true },
      ],
      linhas: transacoes.map((row: any) => {
        const entrada = isEntrada(row);
        return {
          chave: `tx-${row.id}`,
          celulas: [
            { principal: `#${row.id}` },
            { principal: dayOnly(row.data) },
            { principal: texto(row.descricao), apoio: joinParts(row.categoria, row.metodopagamento) },
            { principal: row.pendente ? "Pendente" : "Realizada", apoio: texto(row.tipo, "") },
            {
              principal: `${entrada ? "+ " : "- "}${money(valorEfetivo(row))}`,
              tom: entrada ? "positivo" : "negativo",
              forte: true,
            },
          ],
        } satisfies Linha;
      }),
      rodape: [
        { principal: "Realizadas", forte: true },
        { principal: "" },
        {
          principal: `${realizadas.length} de ${transacoes.length} lançamento(s)`,
          apoio: `Receitas + ${money(receitas)} · Despesas - ${money(despesas)}`,
        },
        { principal: "Saldo" },
        { principal: money(receitas - despesas), tom: receitas - despesas >= 0 ? "destaque" : "negativo", forte: true },
      ],
    },
    {
      id: "compras",
      titulo: "Compras e entradas de estoque",
      vazio: "Nenhuma entrada registrada no período.",
      aviso: cortada(entradas),
      colunas: [
        { titulo: "Entrada", largura: "16mm" },
        { titulo: "Data", largura: "22mm" },
        { titulo: "Fornecedor" },
        { titulo: "Tipo", largura: "30mm" },
        { titulo: "Situação", largura: "26mm", direita: true },
      ],
      linhas: entradas.map((row: any) => ({
        chave: `entrada-${row.id}`,
        celulas: [
          { principal: `#${row.id}` },
          { principal: dayOnly(row.created_at) },
          {
            principal: texto(relationOne<any>(row.fornecedor)?.nomerazaosocial, "Sem fornecedor"),
            apoio: row.notachave ? `NF ${row.notachave}` : "",
          },
          { principal: texto(row.tipo), apoio: row.fiscal ? "Fiscal" : "Sem nota" },
          { principal: texto(row.status) },
        ],
      })),
      rodape: [
        { principal: "Total", forte: true },
        { principal: "" },
        { principal: `${entradas.length} entrada(s)` },
        { principal: "" },
        { principal: "" },
      ],
    },
    {
      id: "produtos",
      titulo: "Produtos cadastrados",
      vazio: "Nenhum produto cadastrado no período.",
      aviso: cortada(produtos),
      colunas: [
        { titulo: "Código", largura: "16mm" },
        { titulo: "Data", largura: "22mm" },
        { titulo: "Produto" },
        { titulo: "Estoque", largura: "24mm", direita: true },
        { titulo: "Mínimo", largura: "24mm", direita: true },
      ],
      linhas: produtos.map((row: any) => ({
        chave: `prod-${row.id}`,
        celulas: [
          { principal: `#${row.id}` },
          { principal: dayOnly(row.createdat) },
          { principal: texto(row.titulo), apoio: joinParts(row.referencia, row.status_estoque) },
          { principal: String(toNumber(row.estoque)), forte: true },
          { principal: String(toNumber(row.estoqueminimo)) },
        ],
      })),
      rodape: [
        { principal: "Total", forte: true },
        { principal: "" },
        { principal: `${produtos.length} produto(s)` },
        { principal: "" },
        { principal: "" },
      ],
    },
    {
      id: "usuarios",
      titulo: "Usuários cadastrados",
      vazio: "Nenhum usuário cadastrado no período.",
      aviso: cortada(usuarios),
      colunas: [
        { titulo: "Data", largura: "22mm" },
        { titulo: "Usuário" },
        { titulo: "Perfil", largura: "30mm" },
        { titulo: "Setor", largura: "30mm" },
        { titulo: "Situação", largura: "22mm", direita: true },
      ],
      linhas: usuarios.map((row: any) => ({
        chave: `user-${row.id}`,
        celulas: [
          { principal: dayOnly(row.createdat) },
          { principal: texto(row.nome), apoio: texto(row.email, "") },
          { principal: texto(relationOne<any>(row.perfil)?.nome, "Sem perfil") },
          { principal: texto(relationOne<any>(row.setor)?.nome, "Sem setor") },
          { principal: row.ativo === false ? "Inativo" : "Ativo" },
        ],
      })),
      rodape: [
        { principal: "Total", forte: true },
        { principal: `${usuarios.length} usuário(s)` },
        { principal: "" },
        { principal: "" },
        { principal: "" },
      ],
    },
    {
      id: "clientes",
      titulo: "Clientes cadastrados",
      vazio: "Nenhum cliente cadastrado no período.",
      aviso: cortada(clientes),
      colunas: [
        { titulo: "Código", largura: "16mm" },
        { titulo: "Data", largura: "22mm" },
        { titulo: "Cliente" },
        { titulo: "Cidade", largura: "36mm" },
        { titulo: "Situação", largura: "22mm", direita: true },
      ],
      linhas: clientes.map((row: any) => ({
        chave: `cli-${row.id}`,
        celulas: [
          { principal: `#${row.id}` },
          { principal: dayOnly(row.createdat) },
          { principal: texto(row.nomerazaosocial) },
          { principal: joinParts(row.cidade, row.estado) || "—" },
          { principal: texto(row.status) },
        ],
      })),
      rodape: [
        { principal: "Total", forte: true },
        { principal: "" },
        { principal: `${clientes.length} cliente(s)` },
        { principal: "" },
        { principal: "" },
      ],
    },

    {
      id: "fiscal",
      titulo: "Documentos fiscais emitidos",
      vazio: "Nenhum documento fiscal emitido no período.",
      colunas: [
        { titulo: "Documento", largura: "20mm" },
        { titulo: "Data", largura: "22mm" },
        { titulo: "Número / origem" },
        { titulo: "Status", largura: "28mm" },
        { titulo: "Valor", largura: "28mm", direita: true },
      ],
      linhas: [
        ...nfes.map((row: any) => ({
          chave: `nfe-${row.id}`,
          celulas: [
            { principal: "NFe" },
            { principal: dayOnly(row.dataemissao) },
            {
              principal: `Nº ${texto(row.numero)}`,
              apoio: row.vendaid ? `Venda #${row.vendaid}` : "",
            },
            { principal: texto(row.status) },
            { principal: money(row.total_nfe), tom: "destaque", forte: true },
          ],
        })),
        ...nfses.map((row: any) => ({
          chave: `nfse-${row.id}`,
          celulas: [
            { principal: "NFSe" },
            { principal: dayOnly(row.dataemissao) },
            { principal: `Nº ${texto(row.numero)}` },
            { principal: texto(row.status) },
            { principal: money(row.valor_total), tom: "destaque", forte: true },
          ],
        })),
      ],
      rodape: [
        { principal: "Total", forte: true },
        { principal: "" },
        { principal: `${nfes.length} NFe · ${nfses.length} NFSe` },
        { principal: "" },
        valor(
          nfes.reduce((soma: number, row: any) => soma + toNumber(row.total_nfe), 0) +
            nfses.reduce((soma: number, row: any) => soma + toNumber(row.valor_total), 0),
          "destaque",
        ),
      ],
    },
  ];

  const folhas = paginar(secoes);
  const periodo =
    dateFrom && dateTo
      ? `${br(dateFrom)} a ${br(dateTo)}`
      : dateFrom
        ? `A partir de ${br(dateFrom)}`
        : dateTo
          ? `Até ${br(dateTo)}`
          : "Todo o histórico";

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { width: 210mm !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .report-shell { width: 210mm !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .report-sheet {
            box-sizing: border-box !important;
            width: 208mm !important;
            height: 295mm !important;
            min-height: 295mm !important;
            max-height: 295mm !important;
            margin: 0 !important;
            padding: 8mm !important;
            overflow: hidden !important;
            border: 0 !important;
            box-shadow: none !important;
            break-after: page !important;
            page-break-after: always !important;
          }
          .report-sheet:last-child { break-after: auto !important; page-break-after: auto !important; }
          /* Sem isto o navegador descarta os fundos e as faixas somem no papel. */
          .report-sheet, .report-sheet * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <main className="report-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[210mm] justify-end">
          <A4PdfActions filename="relatorio-consolidado.pdf" backHref="/relatorios" />
        </div>
        <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
          {folhas.map((fatias, indiceFolha) => (
            <section key={indiceFolha} className="report-sheet h-[297mm] w-[210mm] overflow-hidden border border-neutral-300 bg-white p-[10mm] shadow-xl">
              {indiceFolha === 0 ? (
                <>
                  <header className="mb-3 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                    <div className="min-w-0">
                      <h1 className="text-lg font-bold uppercase">Relatório consolidado do período</h1>
                      <p className="text-[9px] text-neutral-500">Tudo que foi executado e registrado no intervalo</p>
                    </div>
                    <div className="shrink-0 text-right text-[9px] text-neutral-500">
                      <p className="uppercase">Período</p>
                      <p className="text-[10px] font-bold tabular-nums text-black">{periodo}</p>
                      <p>Gerado em {dateTime(new Date().toISOString())}</p>
                      <p>Página 1 de {folhas.length}</p>
                    </div>
                  </header>

                  <div className="mb-3 grid grid-cols-4 gap-3 rounded border border-neutral-300 bg-neutral-100 px-3 py-2 text-[8px]">
                    <Kpi label="Movimentações" value={String(movimentacoes)} tone="text-black" />
                    <Kpi label="Receitas" value={money(receitas)} tone="text-emerald-700" />
                    <Kpi label="Despesas" value={money(despesas)} tone="text-red-700" />
                    <Kpi label="Saldo" value={money(receitas - despesas)} tone={receitas - despesas >= 0 ? "text-blue-700" : "text-red-700"} />
                  </div>
                </>
              ) : (
                <p className="mb-2 text-right text-[8px] text-neutral-500">
                  Página {indiceFolha + 1} de {folhas.length}
                </p>
              )}

              <div className="space-y-[3mm]">
                {fatias.map((fatia, indice) => (
                  <TabelaSecao key={`${fatia.secao.id}-${indice}`} fatia={fatia} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

function TabelaSecao({ fatia }: { fatia: Fatia }) {
  const { secao, linhas, continuacao, fechaSecao } = fatia;

  return (
    <table className="w-full table-fixed border-collapse text-[7px]">
      {/* O colgroup é quem fixa a largura sob table-fixed; classe no <th>
          perde para o conteúdo quando o rótulo é maior que a coluna. */}
      <colgroup>
        {secao.colunas.map((coluna) => (
          <col key={coluna.titulo} style={coluna.largura ? { width: coluna.largura } : undefined} />
        ))}
      </colgroup>
      {/* Escala de cinza: faixa da seção > cabeçalho > linha ímpar > branco.
          O título é uma linha de colSpan, e não um <caption>: caption estilizado
          sai do fluxo da tabela e encolhe para a largura da primeira coluna. */}
      <thead>
        <tr className="bg-neutral-200 text-left uppercase text-neutral-700">
          <th colSpan={secao.colunas.length} className="px-2 py-1 font-bold tracking-wide">
            <div className="flex items-baseline justify-between gap-2">
              <span>
                {secao.titulo}
                {continuacao && <span className="font-normal normal-case text-neutral-500"> (continuação)</span>}
              </span>
              {secao.aviso && !continuacao && (
                <span className="font-normal normal-case text-neutral-500">{secao.aviso}</span>
              )}
            </div>
          </th>
        </tr>
        <tr className="bg-neutral-100 text-left uppercase">
          {secao.colunas.map((coluna) => (
            <th
              key={coluna.titulo}
              className={`truncate border-x border-neutral-200 px-2 py-1 ${coluna.direita ? "text-right" : ""}`}
            >
              {coluna.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.length ? linhas.map((linha, indice) => (
          <tr
            key={linha.chave}
            style={{ height: `${alturaLinha(linha)}mm` }}
            className={`border-t border-neutral-300 ${indice % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}
          >
            {linha.celulas.map((celula, coluna) => (
              <CelulaTd key={coluna} celula={celula} direita={secao.colunas[coluna]?.direita} />
            ))}
          </tr>
        )) : (
          <tr className="h-[6mm] border-t border-neutral-300">
            <td colSpan={secao.colunas.length} className="border-x border-neutral-200 px-2 py-1 text-center text-neutral-500">
              {secao.vazio}
            </td>
          </tr>
        )}
      </tbody>

      {fechaSecao && secao.rodape && linhas.length > 0 && (
        <tfoot>
          <tr className="h-[7mm] border-t-2 border-neutral-400 bg-neutral-100">
            {secao.rodape.map((celula, coluna) => (
              <CelulaTd key={coluna} celula={celula} direita={secao.colunas[coluna]?.direita} />
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

const TONS: Record<Tom, string> = {
  neutro: "",
  positivo: "text-emerald-700",
  negativo: "text-red-700",
  destaque: "text-blue-700",
};

function CelulaTd({ celula, direita }: { celula: Celula; direita?: boolean }) {
  return (
    <td className={`border-x border-neutral-200 px-2 py-1 align-middle ${direita ? "text-right" : ""}`}>
      <div className={`truncate tabular-nums ${celula.forte ? "font-semibold" : ""} ${TONS[celula.tom ?? "neutro"]}`}>
        {celula.principal}
      </div>
      {celula.apoio && <div className="truncate text-[6px] text-neutral-500">{celula.apoio}</div>}
    </td>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p className="uppercase text-neutral-500">{label}</p>
      <p className={`text-[11px] font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
