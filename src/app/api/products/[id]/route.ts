// src/app/api/products/[id]/route.ts
export const runtime = "nodejs";

import { after, NextResponse, NextRequest } from "next/server";
import { carregarAutores } from "@/lib/movement-authors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireEstoqueAccess, requireEstoqueDelete, requireEstoqueEdit } from "@/app/api/_authz/perms";
import {
  enqueueMercadoLivreProductSync,
  syncPendingMercadoLivreStock,
} from "@/lib/integrations/mercadolivre-stock-sync";

type Params = { id: string };

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const PRODUTO_FIELDS = `
  id, descricao, precovenda, precocompra, ultimovalordecompra, estoque, estoqueminimo, ncm, cfop, origem_mercadoria, unidade,
  cest, csosn, cst, aliquotaicms, cst_pis, aliquota_pis, modo_pis, aliquota_por_unidade_pis,
  cst_cofins, aliquota_cofins, modo_cofins, aliquota_por_unidade_cofins,
  rtc_habilitado, cst_ibscbs, cclass_trib, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs,
  codigobarras, etiqueta, local, imgUrl, createdat, updatedat, referencia,
  titulo, status_estoque, fabricante, grupo_produto_id, grupo: produtogrupo(id, nome, descricao, ativo), exibirPdv,
  tituloMarketplace, descricaoMarketplace, conservacao
`;
const GET_PRODUTO_FIELDS = `
  ${PRODUTO_FIELDS},
  entrada: entradaitens (id, quantidade, created_at, entradainfo: entrada(id, tipo, status, origem, fiscal, fornecedorid, created_by, fornecedor: fornecedor(id, nomerazaosocial, cpfcnpj))),
  saidas: estoque_saida_item (id, quantidade, saldo_anterior, saldo_resultante, created_at, saida: estoque_saida(id, motivo, observacao, status, created_at, created_by)),
  vendasdoproduto: vendaproduto (
  id, venda_id, produtoid, sub_total, valor_total, valor_desconto, tipo_desconto, quantidade, venda (id, valortotal, status, datavenda, desconto_valor, sub_total, cliente: cliente(nomerazaosocial))
  ),
  ordensdoproduto: osproduto (quantidade, precounitario, subtotal, ordem: ordemservico (id, descricao, status, createdat, dataentrada, orcamentototal, cliente: cliente(nomerazaosocial), veiculo: veiculo(placa, placa_formatada, modelo)))
`;

const WRITABLE_FIELDS = new Set([
  "descricao",
  "precovenda",
  "precocompra",
  "ultimovalordecompra",
  // "estoque" nao entra aqui de proposito: saldo so muda por entrada, saida,
  // venda ou OS, que registram o movimento no razao de estoque. Gravar o campo
  // direto criaria saldo sem movimento correspondente.
  "estoqueminimo",
  "ncm",
  "cfop",
  "origem_mercadoria",
  "unidade",
  "cest",
  "csosn",
  "cst",
  "aliquotaicms",
  "cst_pis",
  "aliquota_pis",
  "modo_pis",
  "aliquota_por_unidade_pis",
  "cst_cofins",
  "aliquota_cofins",
  "modo_cofins",
  "aliquota_por_unidade_cofins",
  "rtc_habilitado",
  "cst_ibscbs",
  "cclass_trib",
  "aliquota_ibs_uf",
  "aliquota_ibs_municipio",
  "aliquota_cbs",
  "codigobarras",
  "etiqueta",
  "local",
  "referencia",
  "titulo",
  "fabricante",
  "grupo_produto_id",
  "exibirPdv",
  "tituloMarketplace",
  "descricaoMarketplace",
  "conservacao",
]);

function toNullIfEmpty(v: unknown) {
  return typeof v === "string" && v.trim() === "" ? null : v;
}

function toNumberOrNull(v: any) {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function precoMedioCompraValido(value: unknown) {
  const numero = Number(value);
  return Number.isFinite(numero) && numero > 0;
}

function getExpectedUpdatedAt(body: any, { required }: { required: boolean }) {
  const raw = body?.expectedUpdatedAt;
  if (raw == null || raw === "") {
    if (required) {
      throw new HttpError(
        "A versão original do produto não foi informada. Recarregue o produto antes de salvar.",
        409,
      );
    }
    return null;
  }

  if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
    throw new HttpError("Versão original do produto inválida.", 400);
  }

  return raw;
}

type ExpectedField = { field: string; original: unknown };

function parseFieldChanges(body: any) {
  if (body?.changes == null) return null;
  if (typeof body.changes !== "object" || Array.isArray(body.changes)) {
    throw new HttpError("Formato de alterações inválido.", 400);
  }

  const values: Record<string, unknown> = {};
  const expectedFields: ExpectedField[] = [];

  for (const [field, change] of Object.entries(body.changes)) {
    if (!WRITABLE_FIELDS.has(field)) {
      throw new HttpError(`Campo não permitido na atualização: ${field}.`, 400);
    }
    if (!change || typeof change !== "object" || Array.isArray(change) || !("value" in change) || !("original" in change)) {
      throw new HttpError(`Alteração inválida para o campo ${field}.`, 400);
    }

    const typedChange = change as { original: unknown; value: unknown };
    values[field] = typedChange.value;
    expectedFields.push({ field, original: typedChange.original });
  }

  if (expectedFields.length === 0) {
    throw new HttpError("Nenhuma alteração foi informada.", 400);
  }

  return { values, expectedFields };
}

async function updateProduto(
  id: number,
  payload: Record<string, any>,
  expectedUpdatedAt: string | null,
  expectedFields: ExpectedField[] = [],
) {
  let query = supabaseAdmin
    .from("produto")
    .update(payload)
    .eq("id", id)
    .eq("is_deleted", false);
  if (expectedUpdatedAt) query = query.eq("updatedat", expectedUpdatedAt);
  for (const { field, original } of expectedFields) {
    query = original == null ? query.is(field, null) : query.eq(field, original);
  }

  const { data, error } = await query.select(PRODUTO_FIELDS).maybeSingle();

  if (error) {
    if ((error as any).code === "23505") {
      const databaseMessage = String((error as any).message ?? "");
      throw new HttpError(
        /item de uso e consumo com esta etiqueta|produto com esta etiqueta/i.test(databaseMessage)
          ? databaseMessage
          : "Violação de unicidade (já cadastrado).",
        409,
      );
    }
    throw error;
  }

  if (data) return data;

  const { data: existente, error: lookupError } = await supabaseAdmin
    .from("produto")
    .select("id, is_deleted")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (!existente || existente.is_deleted) throw new HttpError("Produto não encontrado.", 404);

  throw new HttpError(
    "Este produto foi alterado por outro usuário. Recarregue os dados antes de salvar.",
    409,
  );
}

async function exigePrecoMedioCompra() {
  const { data, error } = await supabaseAdmin
    .from("config_geral")
    .select("produto_preco_medio_compra_obrigatorio")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if ((error as any).code === "42703") return false;
    throw error;
  }

  return data?.produto_preco_medio_compra_obrigatorio === true;
}

async function validarPrecoMedioCompra(id: number, payload: Record<string, any>) {
  if (!(await exigePrecoMedioCompra())) return;

  let valor = payload.precocompra;
  if (!("precocompra" in payload)) {
    const { data, error } = await supabaseAdmin
      .from("produto")
      .select("precocompra")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    valor = data?.precocompra;
  }

  if (!precoMedioCompraValido(valor)) {
    throw new Error("Informe um valor médio de compra maior que zero.");
  }
}

async function scheduleMercadoLivrePriceSync(productId: number) {
  try {
    const queued = await enqueueMercadoLivreProductSync(productId);
    if (queued === 0) return;

    after(async () => {
      try {
        const results = await syncPendingMercadoLivreStock({ productIds: [productId], limit: queued });
        const failures = results.filter((result) => result.ok === false);
        if (failures.length) {
          console.warn("Falha ao sincronizar preço do produto com o Mercado Livre:", failures);
        }
      } catch (error) {
        console.error("Falha ao processar sincronização de preço do Mercado Livre:", error);
      }
    });
  } catch (error) {
    // O produto permanece salvo; o gatilho no banco e o cron permitem uma nova tentativa.
    console.error("Falha ao enfileirar sincronização de preço do Mercado Livre:", error);
  }
}

/**
 * - Converte strings vazias para null (com exceções)
 * - Coerce campos numéricos para number
 * - No PUT (strict=true) exige campos obrigatórios de acordo com o schema
 * - Evita enviar `null` para colunas NOT NULL (ex.: unidade, tituloMarketplace, descricaoMarketplace)
 */
function sanitizePayload(body: any, { strict }: { strict: boolean }) {
  const out: Record<string, any> = {};

  const setOrOmit = (k: string, v: any) => {
    if (v === undefined) return;

    // NOT NULL com DEFAULT '' → nunca enviar null
    if (k === "tituloMarketplace" || k === "descricaoMarketplace") {
      if (typeof v === "string") {
        out[k] = v; // mantém '' se vier vazio
      } else {
        const t = toNullIfEmpty(v);
        if (t == null) return; // omite para preservar/usar default
        out[k] = t;
      }
      return;
    }

    // enum NOT NULL (unidade) → se vazio, omite (preserva valor atual)
    if (k === "unidade") {
      const t = toNullIfEmpty(v);
      if (t != null) out[k] = t;
      return;
    }

    // grupo possui DEFAULT 'OUTROS' → se vazio, omite
    if (k === "grupo") {
      const t = toNullIfEmpty(v);
      if (t != null) out[k] = t;
      return;
    }

    // boolean coerção
    if (k === "exibirPdv" || k === "rtc_habilitado") {
      out[k] = v === true || v === "true" || v === 1 || v === "1";
      return;
    }

    out[k] = toNullIfEmpty(v);
  };

  for (const key of Object.keys(body ?? {})) {
    if (!WRITABLE_FIELDS.has(key)) continue;

    switch (key) {
      case "precovenda":
      case "precocompra":
      case "ultimovalordecompra": {
        const n = toNumberOrNull(body[key]);
        if (n == null) {
          if (strict) out[key] = null; // PUT: validation pega adiante
          // PATCH: omite para não violar NOT NULL
        } else {
          out[key] = n;
        }
        break;
      }
      case "aliquotaicms":
      case "aliquota_pis":
      case "aliquota_por_unidade_pis":
      case "aliquota_cofins":
      case "aliquota_por_unidade_cofins":
      case "aliquota_ibs_uf":
      case "aliquota_ibs_municipio":
      case "aliquota_cbs": {
        // Campo nullable: pode enviar null
        out[key] = toNumberOrNull(body[key]);
        break;
      }
      case "estoqueminimo": {
        const n = toNumberOrNull(body[key]);
        if (n == null) {
          // PATCH/PUT: omite para não violar NOT NULL
        } else {
          out[key] = Math.max(0, Math.trunc(n));
        }
        break;
      }
      default: {
        setOrOmit(key, body[key]);
      }
    }
  }

  if (strict) {
    // Para PUT (substituição completa), alinhar com NOT NULL do schema
    // estoque saiu da lista: o PUT nao grava mais o saldo, entao exigi-lo no corpo
    // so faria o cliente enviar um valor que seria ignorado.
    const required = ["titulo", "precovenda", "estoqueminimo", "unidade"];
    const missing = required.filter((k) => body[k] == null || String(body[k]).trim() === "");
    if (missing.length) {
      throw new Error(`Campos obrigatórios ausentes no PUT: ${missing.join(", ")}`);
    }
  }

  out.updatedat = new Date().toISOString();
  return out;
}

async function parseId(context: { params: Promise<Params> }) {
  const { id: idStr } = await context.params;
  const id = Number((idStr ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error("ID inválido.");
  return id;
}

/* ========================= GET ========================= */

export async function GET(_req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireEstoqueAccess();
    const id = await parseId(context);

    const { data, error } = await supabaseAdmin
      .from("produto")
      .select(GET_PRODUTO_FIELDS)
      .eq("id", id)
      .eq("is_deleted", false)
      .single();

    if (error) {
      if ((error as any).code === "PGRST116") {
        return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
      }
      throw error;
    }

    const entradaLinhas = (((data as any)?.entrada ?? []) as Array<Record<string, any>>);
    const saidaLinhas = (((data as any)?.saidas ?? []) as Array<Record<string, any>>);
    const autores = await carregarAutores([
      ...entradaLinhas.map((linha) => linha.entradainfo?.created_by),
      ...saidaLinhas.map((linha) => linha.saida?.created_by),
    ]);
    const comAutor = (movimento: Record<string, any> | null | undefined) =>
      movimento ? { ...movimento, criador: autores.get(String(movimento.created_by ?? "")) ?? null } : movimento;

    return NextResponse.json({
      data: {
        ...data,
        entrada: entradaLinhas.map((linha) => ({ ...linha, entradainfo: comAutor(linha.entradainfo) })),
        saidas: saidaLinhas.map((linha) => ({ ...linha, saida: comAutor(linha.saida) })),
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao buscar produto.";
    const status = msg.includes("ID inválido") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= PATCH ========================= */

export async function PATCH(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireEstoqueEdit();
    const id = await parseId(context);
    const body = await req.json().catch(() => ({}));
    const fieldChanges = parseFieldChanges(body);
    const expectedUpdatedAt = fieldChanges ? null : getExpectedUpdatedAt(body, { required: false });
    const payload = sanitizePayload(fieldChanges?.values ?? body, { strict: false });

    // PATCH também é usado por fluxos rápidos de etiqueta/localização. Neles,
    // a regra só se aplica se o custo estiver sendo alterado.
    if ("precocompra" in payload) {
      await validarPrecoMedioCompra(id, payload);
    }

    // Se só veio updatedat (porque tudo foi omitido), não há mudanças
    if (Object.keys(payload).length === 1 && "updatedat" in payload) {
      return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
    }

    const data = await updateProduto(id, payload, expectedUpdatedAt, fieldChanges?.expectedFields);
    if ("precovenda" in payload) await scheduleMercadoLivrePriceSync(id);

    return NextResponse.json({ data, id: data.id });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao atualizar produto.";
    const status = e instanceof HttpError
      ? e.status
      : msg.includes("ID inválido") || msg.includes("valor médio de compra")
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= PUT ========================= */

export async function PUT(req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireEstoqueEdit();
    const id = await parseId(context);
    const body = await req.json().catch(() => ({}));
    const expectedUpdatedAt = getExpectedUpdatedAt(body, { required: true });
    const payload = sanitizePayload(body, { strict: true });

    await validarPrecoMedioCompra(id, payload);

    const data = await updateProduto(id, payload, expectedUpdatedAt);
    if ("precovenda" in payload) await scheduleMercadoLivrePriceSync(id);

    return NextResponse.json({ data, id: data.id });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao atualizar produto.";
    const status = e instanceof HttpError
      ? e.status
      : msg.includes("ID inválido") || msg.includes("Campos obrigatórios") || msg.includes("valor médio de compra")
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= DELETE ========================= */

export async function DELETE(_req: NextRequest, context: { params: Promise<Params> }) {
  try {
    await requireEstoqueDelete();
    const id = await parseId(context);

    const { data, error } = await supabaseAdmin
      .from("produto")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        etiqueta: null,
        exibirPdv: false,
        updatedat: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("is_deleted", false)
      .select("id");

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }

    // 204: sem corpo
    return new NextResponse(null, { status: 204 });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao deletar produto.";
    const status = e instanceof HttpError
      ? e.status
      : msg.includes("ID inválido")
        ? 400
        : 500;
    return NextResponse.json({
      error: status === 500
        ? "Não foi possível excluir o produto. Tente novamente."
        : msg,
    }, { status });
  }
}
