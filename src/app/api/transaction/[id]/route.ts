// src/app/api/transacoes/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFinanceiroDelete, requireFinanceiroEdit, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";

type Params = { params: Promise<{ id: string }> };

function toCents(value: unknown) {
  const number = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

async function revalidarStatusOrdem(osId: number) {
  const { data: ordem, error } = await supabaseAdmin
    .from("ordemservico")
    .select("id, orcamentototal, status, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
    .eq("id", osId)
    .maybeSingle();
  if (error || !ordem) throw error ?? new Error("OS não encontrada.");

  const { data: pagamentos, error: pagamentosError } = await supabaseAdmin
    .from("transacao")
    .select("valor")
    .eq("ordemservicoid", osId)
    .eq("tipo", "RECEITA")
    .is("evento_financeiro_id", null)
    .eq("is_deleted", false);
  if (pagamentosError) throw pagamentosError;

  const totalDevido = toCents(calculateFinancialTotal(
    ordem.orcamentototal,
    ordem.acrescimo_financeiro_tipo,
    ordem.acrescimo_financeiro_valor,
  ));
  const totalPago = (pagamentos ?? []).reduce((total, pagamento) => total + toCents(pagamento.valor), 0);
  const status = String(ordem.status ?? "").toUpperCase();

  if (["CONCLUIDO", "FINALIZADA"].includes(status) && totalPago < totalDevido) {
    const { error: updateError } = await supabaseAdmin
      .from("ordemservico")
      .update({ status: "PAGAMENTO", updatedat: new Date().toISOString() })
      .eq("id", osId);
    if (updateError) throw updateError;
  }
}

async function revalidarStatusVenda(vendaId: number) {
  const { data: venda, error } = await supabaseAdmin
    .from("venda")
    .select("id, valortotal, status, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
    .eq("id", vendaId)
    .maybeSingle();
  if (error || !venda) throw error ?? new Error("Venda não encontrada.");

  const { data: pagamentos, error: pagamentosError } = await supabaseAdmin
    .from("transacao")
    .select("valor")
    .eq("vendaid", vendaId)
    .eq("tipo", "RECEITA")
    .eq("is_deleted", false);
  if (pagamentosError) throw pagamentosError;

  const totalDevido = toCents(calculateFinancialTotal(
    venda.valortotal,
    venda.acrescimo_financeiro_tipo,
    venda.acrescimo_financeiro_valor,
  ));
  const totalPago = (pagamentos ?? []).reduce((total, pagamento) => total + toCents(pagamento.valor), 0);
  const status = String(venda.status ?? "").toUpperCase();

  if (["CONCLUIDO", "FINALIZADA"].includes(status) && totalPago < totalDevido) {
    const { error: updateError } = await supabaseAdmin
      .from("venda")
      .update({ status: "PAGAMENTO", updatedat: new Date().toISOString() })
      .eq("id", vendaId);
    if (updateError) throw updateError;
  }
}

const TRANSACAO_FIELDS = `
  id, descricao, valor, data, metodopagamento, categoria, categoria_id, plano_de_conta, plano_de_conta_id, centro_custo, centro_custo_id, tipo, cliente_id,
  banco_id, nomepagador, cpfcnpjpagador, pendente, ordemservicoid, valorLiquido, vendaid,
  created_at, updated_at
`;

/** Campos do banco (bancoconta) alinhados ao que você precisa no front */
const BANCO_FIELDS =
  "id, titulo, tipo, agencia, contanumero, proprietario, valorinicial, empresa_id, created_at, updated_at";

const WRITABLE_FIELDS = new Set([
  "descricao",
  "valor",
  "data",
  "metodopagamento",
  "categoria",
  "categoria_id",
  "plano_de_conta",
  "plano_de_conta_id",
  "centro_custo",
  "centro_custo_id",
  "tipo",
  "cliente_id",
  "banco_id",
  "nomepagador",
  "pendente",
  "cpfcnpjpagador",
  "ordemservicoid",
  "valorLiquido",
  "vendaid",
]);

/** Campos NOT NULL no banco (para validação local, principalmente no PATCH) */
const NOT_NULL_FIELDS = new Set([
  "descricao",
  "valor",
  "data",
  "categoria",
  "tipo",
  "nomepagador",
  "cpfcnpjpagador",
  "pendente",
]);

function isEmptyString(v: unknown) {
  return typeof v === "string" && v.trim() === "";
}

function toNullIfEmpty(v: unknown) {
  return isEmptyString(v) ? null : v;
}

/**
 * Para numeric: preferimos string para não forçar conversões/precisão no JS.
 * Aceita "1234.56", "1234,56", 1234.56
 */
function toNumericStringOrNull(v: any) {
  if (v == null || isEmptyString(v)) return null;

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return String(v);
  }

  if (typeof v === "string") {
    const s = v.trim().replace(",", ".");
    // aceita: 0, 10, 10.5, 10.50, 0001.20
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return s;
  }

  return null;
}

function toIntOrNull(v: any) {
  if (v == null || isEmptyString(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * bigint como string numérica (evita overflow de 2^53-1 no JS)
 */
function toBigIntStringOrNull(v: any) {
  if (v == null || isEmptyString(v)) return null;

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    const t = Math.trunc(v);
    return t > 0 ? String(t) : null;
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!/^\d+$/.test(s)) return null;
    if (s === "0") return null;
    return s;
  }

  return null;
}

function toTimestampOrNull(v: any) {
  if (v == null || isEmptyString(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toBooleanOrNull(v: any) {
  if (v == null || isEmptyString(v)) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return null;
  }
  return null;
}

/**
 * - Converte strings vazias para null
 * - Coerce numeric para string (ou null)
 * - Converte datas para ISO (ou null)
 * - No PUT (strict=true) exige campos obrigatórios
 * - No PATCH (strict=false) impede null/"" em campos NOT NULL (retorna 400)
 */
function sanitizePayload(body: any, { strict }: { strict: boolean }) {
  const out: Record<string, any> = {};
  const providedKeys = Object.keys(body ?? {});

  for (const key of providedKeys) {
    if (!WRITABLE_FIELDS.has(key)) continue;

    switch (key) {
      case "valor":
      case "valorLiquido":
        out[key] = toNumericStringOrNull(body[key]);
        break;

      case "cliente_id":
      case "categoria_id":
      case "plano_de_conta_id":
      case "centro_custo_id":
      case "ordemservicoid":
      case "vendaid":
        out[key] = toIntOrNull(body[key]);
        break;

      case "banco_id":
        out[key] = toBigIntStringOrNull(body[key]);
        break;

      case "data":
        out[key] = toTimestampOrNull(body[key]);
        break;

      case "pendente":
        out[key] = toBooleanOrNull(body[key]);
        break;

      default:
        // descricao, metodopagamento, categoria, tipo, nomepagador, cpfcnpjpagador
        out[key] = toNullIfEmpty(body[key]);
    }

    // PATCH: se o cliente tentou mandar ""/null em campo NOT NULL, rejeita aqui
    if (!strict && NOT_NULL_FIELDS.has(key) && out[key] == null) {
      throw new Error(`Campo "${key}" não pode ser vazio ou nulo.`);
    }
  }

  if (strict) {
    const required = [
      "descricao",
      "valor",
      "data",
      "categoria",
      "tipo",
      "nomepagador",
      "cpfcnpjpagador",
    ];
    const missing = required.filter((k) => out[k] == null);
    if (missing.length) {
      throw new Error(
        `Campos obrigatórios ausentes no PUT: ${missing.join(", ")}`
      );
    }

    // No PUT, pendente pode não vir (pois tem default no banco),
    // mas como é NOT NULL, se vier precisa ser boolean válido.
    if ("pendente" in out && out.pendente == null) {
      throw new Error(`Campo "pendente" inválido.`);
    }
  }

  out.updated_at = new Date().toISOString();
  return out;
}

/**
 * id da transacao é bigint: mantemos como string numérica para evitar overflow.
 */
async function parseId(ctx: Params) {
  const { id: idParam } = await ctx.params;
  const raw = String(idParam ?? "").trim();

  if (!/^\d+$/.test(raw) || raw === "0") {
    throw new Error("ID inválido.");
  }
  return raw;
}

/* ========================= GET ========================= */

export async function GET(_: Request, ctx: Params) {
  try {
    await requireFinanceirosAccess();
    const id = await parseId(ctx);

    const { data, error } = await supabaseAdmin
      .from("transacao")
      .select(
        `
        ${TRANSACAO_FIELDS},
        banco:bancoconta!transacao_banco_id_fkey ( ${BANCO_FIELDS} ),
        categoria_dados:categoriatransacao!transacao_categoria_id_fkey ( id, nome, icone ),
        plano_de_conta_dados:planosdeconta!transacao_plano_de_conta_id_fkey ( id, codigo, nome ),
        centro_custo_dados:centrosdecusto!transacao_centro_custo_id_fkey ( id, nome, descricao, ativo )
        `
      )
      .eq("id", id)
      .eq("is_deleted", false)
      .single();

    if (error) {
      if ((error as any).code === "PGRST116") {
        return NextResponse.json(
          { error: "Transação não encontrada." },
          { status: 404 }
        );
      }
      throw error;
    }

    return NextResponse.json({ data });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao buscar transação.";
    const authStatus = Number(e?.statusCode);
    const status = authStatus === 401 || authStatus === 403
      ? authStatus
      : msg.includes("ID inválido") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= PATCH ========================= */

async function validarEdicaoConfigurada(req: NextRequest) {
  if (req.headers.get("x-transaction-edit") !== "true") return null;

  const { data: config, error } = await supabaseAdmin
    .from("config_geral")
    .select("habilitar_edicao_transacoes")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "A configuração de edição de transações ainda não foi aplicada." }, { status: 409 });
  }
  if (config?.habilitar_edicao_transacoes !== true) {
    return NextResponse.json({ error: "A edição de transações está desativada nas configurações gerais." }, { status: 403 });
  }
  return null;
}

export async function PATCH(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const edicaoBloqueada = await validarEdicaoConfigurada(req);
    if (edicaoBloqueada) return edicaoBloqueada;
    const id = await parseId(ctx);
    const body = await req.json().catch(() => ({}));
    if (req.headers.get("x-transaction-edit") === "true" && (body.valor !== undefined || body.valorLiquido !== undefined)) {
      return NextResponse.json({ error: "O valor da transação não pode ser editado." }, { status: 400 });
    }
    const payload = sanitizePayload(body, { strict: false });

    if (Object.keys(payload).length === 1 && "updated_at" in payload) {
      return NextResponse.json(
        { error: "Nada para atualizar." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("transacao")
      .update(payload)
      .eq("id", id)
      .eq("is_deleted", false)
      .select(TRANSACAO_FIELDS)
      .single();

    if (error) {
      const code = (error as any).code;
      if (code === "PGRST116") {
        return NextResponse.json(
          { error: "Transação não encontrada." },
          { status: 404 }
        );
      }
      if (code === "23503") {
        return NextResponse.json(
          { error: "Chave estrangeira inválida (cliente_id/banco_id/etc.)." },
          { status: 422 }
        );
      }
      if (code === "23502") {
        return NextResponse.json(
          { error: "Um ou mais campos obrigatórios foram enviados como nulos." },
          { status: 400 }
        );
      }
      if (code === "22P02") {
        return NextResponse.json(
          { error: "Formato inválido em um ou mais campos." },
          { status: 400 }
        );
      }
      if (code === "23505") {
        return NextResponse.json(
          { error: "Violação de unicidade (já cadastrado)." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ data, id: data.id });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao atualizar transação.";
    const authStatus = Number(e?.statusCode);
    const status = authStatus === 401 || authStatus === 403
      ? authStatus
      : msg.includes("ID inválido") || msg.includes("não pode ser vazio")
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= PUT ========================= */

export async function PUT(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const edicaoBloqueada = await validarEdicaoConfigurada(req);
    if (edicaoBloqueada) return edicaoBloqueada;
    const id = await parseId(ctx);
    const body = await req.json().catch(() => ({}));
    if (req.headers.get("x-transaction-edit") === "true" && (body.valor !== undefined || body.valorLiquido !== undefined)) {
      return NextResponse.json({ error: "O valor da transação não pode ser editado." }, { status: 400 });
    }
    const payload = sanitizePayload(body, { strict: true });

    const { data, error } = await supabaseAdmin
      .from("transacao")
      .update(payload)
      .eq("id", id)
      .eq("is_deleted", false)
      .select(TRANSACAO_FIELDS)
      .single();

    if (error) {
      const code = (error as any).code;
      if (code === "PGRST116") {
        return NextResponse.json(
          { error: "Transação não encontrada." },
          { status: 404 }
        );
      }
      if (code === "23503") {
        return NextResponse.json(
          { error: "Chave estrangeira inválida (cliente_id/banco_id/etc.)." },
          { status: 422 }
        );
      }
      if (code === "23502") {
        return NextResponse.json(
          { error: "Um ou mais campos obrigatórios estão nulos." },
          { status: 400 }
        );
      }
      if (code === "22P02") {
        return NextResponse.json(
          { error: "Formato inválido em um ou mais campos." },
          { status: 400 }
        );
      }
      if (code === "23505") {
        return NextResponse.json(
          { error: "Violação de unicidade (já cadastrado)." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ data, id: data.id });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao atualizar transação.";
    const authStatus = Number(e?.statusCode);
    const status = authStatus === 401 || authStatus === 403
      ? authStatus
      : msg.includes("ID inválido") ||
        msg.includes("Campos obrigatórios") ||
        msg.includes("pendente inválido")
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/* ========================= DELETE ========================= */

export async function DELETE(_: Request, ctx: Params) {
  try {
    await requireFinanceiroDelete();
    const id = await parseId(ctx);

    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from("transacao")
      .select("id, tipo, ordemservicoid, vendaid, evento_financeiro_id")
      .eq("id", id)
      .maybeSingle();
    if (transactionError) throw transactionError;
    if (!transaction) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("transacao")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Transação não encontrada." },
        { status: 404 }
      );
    }

    const isPagamento = String(transaction.tipo ?? "").toUpperCase() === "RECEITA" &&
      transaction.evento_financeiro_id == null;

    if (isPagamento) {
      if (transaction.ordemservicoid != null) {
        await revalidarStatusOrdem(Number(transaction.ordemservicoid));
      }
      if (transaction.vendaid != null) {
        await revalidarStatusVenda(Number(transaction.vendaid));
      }
    }

    return new NextResponse(null, { status: 204 });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao deletar transação.";
    const authStatus = Number(e?.statusCode);
    const status = authStatus === 401 || authStatus === 403
      ? authStatus
      : msg.includes("ID inválido") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
