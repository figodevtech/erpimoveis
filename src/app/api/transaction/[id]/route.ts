// src/app/api/transacoes/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFinanceiroDelete, requireFinanceiroEdit, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { paraCentavos } from "@/lib/financeiro/rateio";
import { origemDaTransacao, rotuloDaOrigem, valorDeFace } from "@/lib/financeiro/transacao";
import {
  aplicarCamposDocumento,
  CAMPOS_DOCUMENTO,
  erroDeDocumento,
} from "@/app/api/transaction/_lib/documento";

type Params = { params: Promise<{ id: string }> };

function toCents(value: unknown) {
  const number = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

async function revalidarStatusOrdem(osId: number) {
  const { error } = await supabaseAdmin.rpc("recalcular_status_financeiro_os", {
    p_ordemservicoid: osId,
  });
  if (error) throw error;
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
    .select("valor, valor_acrescimos")
    .eq("vendaid", vendaId)
    .eq("tipo", "RECEITA")
    .eq("is_deleted", false);
  if (pagamentosError) throw pagamentosError;

  const totalDevido = toCents(calculateFinancialTotal(
    venda.valortotal,
    venda.acrescimo_financeiro_tipo,
    venda.acrescimo_financeiro_valor,
  ));
  // Mesma regra da OS: acrescimo e do pagamento, nao do documento.
  const totalPago = (pagamentos ?? []).reduce(
    (total, pagamento) => total + toCents(valorDeFace(pagamento)),
    0,
  );
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
  id, descricao, descricao_pagamento, valor, data, competencia_em, metodopagamento, categoria, categoria_id, plano_de_conta, plano_de_conta_id, centro_custo, centro_custo_id, tipo, cliente_id, fornecedor_id,
  banco_id, nomepagador, cpfcnpjpagador, pendente, ordemservicoid, valorLiquido, vendaid,
  valor_base, valor_acrescimos, valor_descontos, adiantamento_id, eh_adiantamento,
  entrada_id, usoconsumo_entrada_id,
  documento_tipo_id, documento_numero, documento_serie, documento_chave,
  documento_emitido_em, documento_valor, documento_observacao,
  created_at, updated_at
`;

/** Campos do banco (bancoconta) alinhados ao que você precisa no front */
const BANCO_FIELDS =
  "id, titulo, tipo, agencia, contanumero, proprietario, valorinicial, empresa_id, created_at, updated_at";

const WRITABLE_FIELDS = new Set([
  "descricao",
  "descricao_pagamento",
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
  "fornecedor_id",
  "banco_id",
  "nomepagador",
  "pendente",
  "cpfcnpjpagador",
  "ordemservicoid",
  "valorLiquido",
  "vendaid",
  "competencia_em",
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
      case "fornecedor_id":
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

  // Documento usa coerções próprias: data sem fuso, textos com teto e valor
  // monetário não negativo. Chaves ausentes continuam ausentes no PATCH.
  aplicarCamposDocumento(body, out);

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
 * Valida o estado final do documento, não apenas os campos que vieram no PATCH.
 * Assim é possível corrigir somente o número de uma nota já vinculada, mas não
 * apagar o tipo deixando os demais dados órfãos.
 */
async function respostaSeDocumentoInvalido(
  id: string,
  body: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const informouDocumento = CAMPOS_DOCUMENTO.some((campo) => campo in body);
  if (!informouDocumento) return null;

  const { data: atual, error } = await supabaseAdmin
    .from("transacao")
    .select(CAMPOS_DOCUMENTO.join(", "))
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw error;
  if (!atual) {
    return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
  }

  const mensagem = erroDeDocumento({
    ...(atual as unknown as Record<string, unknown>),
    ...payload,
  });
  return mensagem
    ? NextResponse.json({ error: mensagem }, { status: 400 })
    : null;
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

type TransacaoComOrigem = {
  competencia_em?: string | null;
  ordemservicoid?: number | string | null;
  vendaid?: number | string | null;
  entrada_id?: number | string | null;
  usoconsumo_entrada_id?: number | string | null;
};

/**
 * Competência efetiva de uma transação vinculada.
 *
 * O vínculo torna o campo não editável, portanto a tela precisa mostrar a data
 * do documento que realmente manda na competência — não uma cópia antiga (ou
 * nula) em `transacao`. Em OS sem execução finalizada, nulo é intencional: o
 * fato econômico ainda não foi reconhecido.
 */
async function competenciaEfetivaDaOrigem(transacao: TransacaoComOrigem) {
  if (transacao.ordemservicoid != null) {
    const { data, error } = await supabaseAdmin
      .from("ordemservico")
      .select("execucao_fim_em")
      .eq("id", transacao.ordemservicoid)
      .maybeSingle();
    if (error) throw error;
    return data ? data.execucao_fim_em ?? null : transacao.competencia_em ?? null;
  }

  if (transacao.vendaid != null) {
    const { data, error } = await supabaseAdmin
      .from("venda")
      .select("datavenda, createdat")
      .eq("id", transacao.vendaid)
      .maybeSingle();
    if (error) throw error;
    return data
      ? data.datavenda ?? data.createdat ?? null
      : transacao.competencia_em ?? null;
  }

  if (transacao.entrada_id != null) {
    const { data, error } = await supabaseAdmin
      .from("entrada")
      .select("data_emissao, created_at")
      .eq("id", transacao.entrada_id)
      .maybeSingle();
    if (error) throw error;
    return data
      ? data.data_emissao ?? data.created_at ?? null
      : transacao.competencia_em ?? null;
  }

  if (transacao.usoconsumo_entrada_id != null) {
    const { data, error } = await supabaseAdmin
      .from("usoconsumo_entrada")
      .select("data_emissao, created_at")
      .eq("id", transacao.usoconsumo_entrada_id)
      .maybeSingle();
    if (error) throw error;
    return data
      ? data.data_emissao ?? data.created_at ?? null
      : transacao.competencia_em ?? null;
  }

  return transacao.competencia_em ?? null;
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
        centro_custo_dados:centrosdecusto!transacao_centro_custo_id_fkey ( id, nome, descricao, ativo ),
        fornecedor:fornecedor!transacao_fornecedor_id_fkey ( id, nomerazaosocial, nomefantasia, cpfcnpj )
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

    const competenciaEfetiva = await competenciaEfetivaDaOrigem(data);

    return NextResponse.json({
      data: { ...data, competencia_em: competenciaEfetiva },
    });
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

/**
 * Guarda de PATCH/PUT. Vale para toda chamada, sem exceção.
 *
 * Até aqui as travas abaixo só rodavam quando a requisição trazia o header
 * `x-transaction-edit`, sob o argumento de que rotinas internas precisavam
 * passar por fora. Nenhuma rotina dessas existe — o dialog de edição era o único
 * emissor do header em todo o `src/`. Na prática, omitir um header que o próprio
 * cliente escolhe mandar desligava a trava de configuração, a do `valor`, a do
 * `pendente` e as de vínculo: dava para marcar um título como pago sem `pago_em`,
 * sem autor, sem histórico e sem revalidar a OS.
 *
 * As demais rotas de edição (`/ajustes`, `/ajustar-valores`) já chamavam
 * `respostaSeEdicaoBloqueada()` sem condição nenhuma. Esta passa a fazer igual.
 *
 * O `valor` (bruto) continua imutável por aqui: num pagamento de OS ou venda ele
 * é o que abate o documento, e mexer numa linha isolada quebraria o total.
 * Redistribuir o bruto entre as parcelas é feito em `/ajustar-valores`, que
 * valida a soma do grupo inteiro dentro de uma transação.
 *
 * O `valorLiquido` é livre: nenhuma soma que fecha OS/venda olha para ele — é só
 * quanto sobrou depois da taxa da maquineta, que costuma ser conhecida bem
 * depois de o pagamento ter sido registrado.
 */
async function validarEdicaoDeTransacao(id: string, body: any) {
  const bloqueio = await respostaSeEdicaoBloqueada();
  if (bloqueio) return bloqueio;

  if (body?.valor !== undefined) {
    return NextResponse.json(
      { error: "O valor bruto não pode ser alterado por aqui. Use o ajuste de valores." },
      { status: 400 },
    );
  }

  const precisaDaLinhaAtual =
    body?.competencia_em !== undefined ||
    body?.valorLiquido !== undefined ||
    body?.tipo !== undefined ||
    body?.pendente !== undefined ||
    body?.banco_id !== undefined ||
    body?.ordemservicoid !== undefined ||
    body?.vendaid !== undefined;

  if (!precisaDaLinhaAtual) return null;

  const { data: atual, error } = await supabaseAdmin
    .from("transacao")
    .select(
      "valor, tipo, pendente, ordemservicoid, vendaid, entrada_id, usoconsumo_entrada_id, adiantamento_id",
    )
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw error;
  if (!atual) {
    return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
  }

  /*
   * Título antecipado não tem banco, e isso não é campo esquecido.
   *
   * Quem trouxe o dinheiro foi a transação de antecipação — ela carrega o banco e
   * o valor. A parcela fica quitada e sem conta justamente para não aparecer no
   * fluxo de caixa ao lado dela, somando o mesmo dinheiro duas vezes. Como "sem
   * banco" parece erro para quem escolheu um banco no adiantamento, este era o
   * caminho fácil de dobrar o saldo sem nenhum aviso na tela.
   *
   * Limpar o banco continua livre: é o estado correto, e o conserto de uma linha
   * já gravada errada passa por aqui.
   */
  if (body?.banco_id !== undefined && atual.adiantamento_id != null) {
    if (toBigIntStringOrNull(body.banco_id) != null) {
      return NextResponse.json(
        {
          error: `Este título foi liquidado pela antecipação #${atual.adiantamento_id}: o dinheiro entrou por ela, e o banco fica nela. Dar banco ao título o faria aparecer no fluxo de caixa duas vezes.`,
        },
        { status: 400 },
      );
    }
  }

  /*
   * `pendente` decide se o dinheiro entrou. Trocar por PATCH pulava tudo que a
   * baixa garante — `pago_em`, `baixado_por`, a linha em `transacao_baixa_historico`
   * e a revalidação do status da OS/venda. Era um caminho de baixa sem auditoria.
   *
   * Dar baixa é `POST /[id]/baixar` (a ação "Pago"), que passa pela RPC.
   * Desfazer é `POST /[id]/estornar-baixa` ("Excluir do fluxo de caixa"), que
   * devolve o título para em aberto e registra o estorno no mesmo livro.
   */
  if (body?.pendente !== undefined) {
    const desejado = body.pendente === true || body.pendente === "true";
    const atualPendente = atual.pendente === true;

    if (desejado !== atualPendente) {
      return NextResponse.json(
        {
          error: atualPendente
            ? "Use a ação “Pago” para dar baixa: ela registra data, autor e histórico."
            : "Use “Excluir do fluxo de caixa” para reabrir o título: ela desfaz o pagamento e registra o estorno.",
        },
        { status: 400 },
      );
    }
  }

  const origem = origemDaTransacao(atual);

  if (origem) {
    /*
     * Competência de lançamento gerado por documento pertence ao documento.
     *
     * Uma receita de OS compete ao mês em que a ordem foi entregue, não ao mês
     * que alguém digitar aqui; mudar por fora faria a DRE divergir do que a OS
     * diz sobre si mesma. Em avulso não há documento a contradizer, e a
     * competência passa a ser editável — é o caso de uma conta de energia que
     * chega em agosto e pertence a julho.
     */
    if (body?.competencia_em !== undefined) {
      return NextResponse.json(
        {
          error: `Esta transação foi gerada por uma ${rotuloDaOrigem(origem)}; a competência acompanha o documento.`,
        },
        { status: 400 },
      );
    }

    const mudouTipo =
      body?.tipo !== undefined &&
      String(body.tipo).toUpperCase() !== String(atual.tipo ?? "").toUpperCase();

    if (mudouTipo) {
      return NextResponse.json(
        {
          error: `Esta transação foi gerada por uma ${rotuloDaOrigem(origem)}; o tipo não pode ser alterado.`,
        },
        { status: 400 },
      );
    }

    // Repontar o vínculo tem exatamente o mesmo efeito de trocar o tipo: o
    // documento antigo fica com o total errado e ninguém revalida o status.
    const mudouVinculo =
      (body?.ordemservicoid !== undefined &&
        Number(body.ordemservicoid ?? 0) !== Number(atual.ordemservicoid ?? 0)) ||
      (body?.vendaid !== undefined &&
        Number(body.vendaid ?? 0) !== Number(atual.vendaid ?? 0));

    if (mudouVinculo) {
      return NextResponse.json(
        {
          error: `Esta transação pertence a uma ${rotuloDaOrigem(origem)} e não pode ser vinculada a outro documento.`,
        },
        { status: 400 },
      );
    }
  }

  if (body?.valorLiquido !== undefined) {
    const liquidoEmCentavos = paraCentavos(body.valorLiquido);

    if (liquidoEmCentavos <= 0) {
      return NextResponse.json(
        { error: "O valor líquido deve ser maior que zero." },
        { status: 400 },
      );
    }

    if (liquidoEmCentavos > paraCentavos(atual.valor)) {
      return NextResponse.json(
        { error: "O valor líquido não pode ser maior que o valor bruto." },
        { status: 400 },
      );
    }
  }

  return null;
}

export async function PATCH(req: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const id = await parseId(ctx);
    const body = await req.json().catch(() => ({}));
    const edicaoBloqueada = await validarEdicaoDeTransacao(id, body);
    if (edicaoBloqueada) return edicaoBloqueada;
    const payload = sanitizePayload(body, { strict: false });
    const documentoInvalido = await respostaSeDocumentoInvalido(id, body, payload);
    if (documentoInvalido) return documentoInvalido;

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
    const id = await parseId(ctx);
    const body = await req.json().catch(() => ({}));
    const edicaoBloqueada = await validarEdicaoDeTransacao(id, body);
    if (edicaoBloqueada) return edicaoBloqueada;
    const payload = sanitizePayload(body, { strict: true });
    const documentoInvalido = await respostaSeDocumentoInvalido(id, body, payload);
    if (documentoInvalido) return documentoInvalido;

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
      .select("id, tipo, pendente, ordemservicoid, vendaid, evento_financeiro_id, adiantamento_id, eh_adiantamento")
      .eq("id", id)
      .maybeSingle();
    if (transactionError) throw transactionError;
    if (!transaction) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    /*
     * Título liquidado não se exclui.
     *
     * A exclusão apaga o título, não a baixa. Num lançamento de OS ou venda isso
     * passava despercebido porque o documento regera o título; num avulso ou
     * migrado, some a dívida junto com o pagamento — e o saldo do banco sobe
     * sozinho, sem que nada tenha acontecido no mundo. Foi assim que a Demir
     * perdeu um título a pagar de R$ 311,36 já quitado.
     *
     * Tirar do fluxo de caixa é o passo que faltava: desfeito o pagamento, o
     * título volta a em aberto e aí já não há dinheiro para se perder junto.
     *
     * A antecipação é exceção porque ela não é baixa de si mesma: excluí-la é
     * justamente a operação que devolve os títulos, logo abaixo.
     */
    if (transaction.pendente === false && !transaction.eh_adiantamento) {
      return NextResponse.json(
        {
          error:
            "Esta transação está liquidada e aparece no fluxo de caixa. Tire-a do fluxo primeiro: o título volta a ficar em aberto, e aí pode ser excluído.",
        },
        { status: 409 },
      );
    }

    /*
     * Antecipação trava a exclusão nas duas pontas.
     *
     * A FK `adiantamento_id` é RESTRICT, então excluir o lançamento da
     * antecipação já falharia — só que com um erro cru de chave estrangeira, que
     * não diz nada a quem está usando. E excluir uma das parcelas passaria, mas
     * deixaria a antecipação cobrindo um valor que ninguém deve.
     *
     * Desfazer uma antecipação é outra operação, que ainda não existe. Até lá,
     * recusar com o motivo é melhor que quebrar a conta em silêncio.
     */
    if (transaction.eh_adiantamento) {
      const { count } = await supabaseAdmin
        .from("transacao")
        .select("id", { count: "exact", head: true })
        .eq("adiantamento_id", id)
        .eq("is_deleted", false);

      if ((count ?? 0) > 0) {
        // Excluir a antecipação e reabrir os títulos é uma coisa só: metade
        // gravada deixaria título quitado sem origem, ou dinheiro no caixa sem
        // contrapartida. Por isso a operação inteira vive no banco.
        const sessao = await auth().catch(() => null);
        const { data, error: desfazerError } = await supabaseAdmin.rpc(
          "desfazer_adiantamento",
          {
            p_id: id,
            p_deleted_by: (sessao?.user as { id?: string } | undefined)?.id ?? null,
          },
        );

        if (desfazerError) {
          const status = desfazerError.code === "P0002" ? 404 : 409;
          return NextResponse.json({ error: desfazerError.message }, { status });
        }

        return NextResponse.json({
          ok: true,
          desfezAdiantamento: true,
          titulosRevertidos: Number((data as any)?.titulos_revertidos ?? 0),
        });
      }
    }

    if (transaction.adiantamento_id != null) {
      return NextResponse.json(
        {
          error: `Este título foi liquidado pela antecipação #${transaction.adiantamento_id} e não pode ser excluído isoladamente.`,
        },
        { status: 409 },
      );
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
