import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { requireVeiculosAccess, requireVeiculosDelete, requireVeiculosEdit } from "@/app/api/_authz/perms";
import { mapearItemHistorico } from "@/lib/ordens/itens-historicos";

// Evita cache no App Router
export const revalidate = 0;
export const dynamic = "force-dynamic";

function respostaJSON(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizarPlaca(valor: string) {
  return valor.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function idValido(raw: string) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

const TIPOS_VEICULO = new Set(["CARROS", "MOTOS", "CAMINHOES"]);

function tipoVeiculoValido(valor: string | undefined) {
  return !!valor && TIPOS_VEICULO.has(valor);
}

type Params = { id: string };
type Ctx = { params: Promise<Params> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requireVeiculosAccess();
    const { id: rawId } = await ctx.params;
    const id = idValido((rawId || "").trim());
    if (!id) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const { data, error } = await supabase
      .from("veiculo")
      .select(`
        id, clienteid, placa, placa_formatada, modelo, marca, ano, cor, kmatual, tipo, chassi, ano_modelo, versao, fipe, combustivel, transmissao, imgUrl,
        cliente:clienteid (
          id,
          nomerazaosocial,
          cpfcnpj,
          email,
          telefone
        ),
        ordens:ordemservico (
          id, clienteid, veiculoid, setorid,
          status, statusaprovacao, prioridade,
          descricao, observacoes,
          dataentrada, datasaida,
          orcamentototal,
          migracao_referencia, cliente_snapshot, veiculo_snapshot,
          cliente:cliente (
            nomerazaosocial
          ),
          produtos:osproduto (
            quantidade,
            precounitario,
            subtotal,
            produto:produtoid ( id, titulo )
          ),
          servicos:osservico (
            quantidade,
            precounitario,
            subtotal,
            servico:servicoid ( id, descricao )
          ),
          itens_historicos:ositem_historico (
            id, ordemservicoid, linha_origem, tipo, codigo_legado, descricao,
            unidade, quantidade, preco_unitario, subtotal
          ),
          createdat, updatedat,
          is_deleted, deleted_at
        )
      `)
      .eq("id", id)
      .eq("ordemservico.is_deleted", false)
      .order("dataentrada", { referencedTable: "ordemservico", ascending: false })
      .single();

    if (error) return respostaJSON({ error: "Veículo não encontrado." }, 404);

    const veiculo = {
      ...data,
      ordens: ((data as any).ordens ?? []).map((ordem: any) => ({
        ...ordem,
        migracaoReferencia: ordem.migracao_referencia ?? null,
        itensHistoricos: (ordem.itens_historicos ?? []).map(mapearItemHistorico),
      })),
    };

    return respostaJSON({ veiculo });
  } catch (err: any) {
    console.error("GET /api/veiculos/[id]", err);
    return respostaJSON({ error: "Falha ao buscar veículo" }, 500);
  }
}



export async function PUT(request: Request, ctx: Ctx) {
  try {
    await requireVeiculosEdit();
    const { id: rawId } = await ctx.params;
    const id = idValido((rawId || "").trim());
    if (!id) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const body = await request.json().catch(() => null);
    if (!body) return respostaJSON({ error: "JSON inválido no body." }, 400);

    // ✅ agora pegamos de body.selectedVeiculo
    const v = body?.selectedVeiculo;
    if (!v || typeof v !== "object") {
      return respostaJSON({ error: "Body deve conter 'selectedVeiculo'." }, 400);
    }

    const patch: any = {};
    const tipoRecebido = v.tipo === undefined || v.tipo === null ? undefined : String(v.tipo).trim();
    if (!tipoVeiculoValido(tipoRecebido)) {
      return respostaJSON({ error: "Campo 'tipo' é obrigatório." }, 400);
    }

    // placa
    if (v.placa !== undefined) {
      if (v.placa === null)
        return respostaJSON({ error: "Campo 'placa' não pode ser null." }, 400);

      const placaNorm = normalizarPlaca(String(v.placa));
      if (!placaNorm)
        return respostaJSON({ error: "Campo 'placa' inválido." }, 400);

      patch.placa = placaNorm;
    }

    // modelo
    if (v.modelo !== undefined) {
      if (v.modelo === null)
        return respostaJSON({ error: "Campo 'modelo' não pode ser null." }, 400);

      const modelo = String(v.modelo).trim();
      if (!modelo)
        return respostaJSON({ error: "Campo 'modelo' inválido." }, 400);

      patch.modelo = modelo;
    }

    // chassi
    if (v.chassi !== undefined) {
      patch.chassi = v.chassi === null ? null : String(v.chassi).trim().toUpperCase();
    }

    // marca
    if (v.marca !== undefined) {
      if (v.marca === null)
        return respostaJSON({ error: "Campo 'marca' não pode ser null." }, 400);

      const marca = String(v.marca).trim();
      if (!marca)
        return respostaJSON({ error: "Campo 'marca' inválido." }, 400);

      patch.marca = marca;
    }

    // ano
    if (v.ano !== undefined) {
      if (v.ano === null) patch.ano = null;
      else {
        const ano = Number(v.ano);
        if (!Number.isInteger(ano) || ano < 1900 || ano > 3000) {
          return respostaJSON({ error: "Campo 'ano' inválido." }, 400);
        }
        patch.ano = ano;
      }
    }

    // kmatual
    if (v.kmatual !== undefined) {
      if (v.kmatual === null) patch.kmatual = null;
      else {
        const km = Number(v.kmatual);
        if (!Number.isInteger(km) || km < 0) {
          return respostaJSON({ error: "Campo 'kmatual' inválido." }, 400);
        }
        patch.kmatual = km;
      }
    }

    // cor
    if (v.cor !== undefined) {
      patch.cor = v.cor === null ? null : String(v.cor).trim();
    }

    // tipo
    if (v.tipo !== undefined) {
      if (v.tipo === null)
        return respostaJSON({ error: "Campo 'tipo' não pode ser null." }, 400);

      patch.tipo = tipoRecebido;
    }

    // chassi
    if (v.chassi !== undefined) {
      patch.chassi = v.chassi === null ? null : String(v.chassi).trim();
    }

    // ano_modelo
    if (v.ano_modelo !== undefined) {
      if (v.ano_modelo === null) patch.ano_modelo = null;
      else {
        const ano_modelo = Number(v.ano_modelo);
        if (!Number.isInteger(ano_modelo) || ano_modelo < 1900 || ano_modelo > 3000) {
          return respostaJSON({ error: "Campo 'ano_modelo' inválido." }, 400);
        }
        patch.ano_modelo = ano_modelo;
      }
    }

    // versao
    if (v.versao !== undefined) {
      patch.versao = v.versao === null ? null : String(v.versao).trim();
    }

    // fipe
    if (v.fipe !== undefined) {
      if (v.fipe === null) patch.fipe = null;
      else {
        const fipe = Number(v.fipe);
        if (Number.isNaN(fipe) || fipe < 0) {
          return respostaJSON({ error: "Campo 'fipe' inválido." }, 400);
        }
        patch.fipe = fipe;
      }
    }

    // combustivel
    if (v.combustivel !== undefined) {
      patch.combustivel = v.combustivel === null ? null : String(v.combustivel).trim();
    }

    // transmissao
    if (v.transmissao !== undefined) {
      patch.transmissao = v.transmissao === null ? null : String(v.transmissao).trim();
    }

    // clienteId (aceita clienteId ou clienteid dentro do selectedVeiculo)
    const rawClienteId = v.clienteId ?? v.clienteid;
    if (rawClienteId !== undefined) {
      if (rawClienteId === null || rawClienteId === "") {
        patch.clienteid = null;
      } else {
        const clienteId = Number(rawClienteId);
        if (!Number.isInteger(clienteId) || clienteId <= 0) {
          return respostaJSON({ error: "Campo 'clienteId' inválido." }, 400);
        }
        patch.clienteid = clienteId;
      }
    }

    if (Object.keys(patch).length === 0) {
      return respostaJSON({ error: "Nenhum campo para atualizar." }, 400);
    }

    patch.updatedat = new Date().toISOString();

    const { data, error } = await supabase
      .from("veiculo")
      .update(patch)
      .eq("id", id)
      .select(
        "id, clienteid, placa, placa_formatada, modelo, marca, ano, cor, kmatual, tipo, chassi, ano_modelo, versao, fipe, combustivel, transmissao, imgUrl"
      )
      .single();

    if (error) {
      console.error("Supabase update error:", error);
      return respostaJSON({ error: "Falha ao atualizar veículo." }, 500);
    }

    return respostaJSON({ veiculo: data });
  } catch (err: any) {
    console.error("PUT /api/veiculos/[id]", err);
    return respostaJSON({ error: "Falha ao atualizar veículo" }, 500);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    await requireVeiculosDelete();
    const { id: rawId } = await ctx.params;
    const id = idValido((rawId || "").trim());
    if (!id) return respostaJSON({ error: "Parâmetro 'id' inválido." }, 400);

    const { error } = await supabase.from("veiculo").delete().eq("id", id);
    if (error) throw error;

    return respostaJSON({ ok: true });
  } catch (err: any) {
    console.error("DELETE /api/veiculos/[id]", err);
    return respostaJSON({ error: "Falha ao remover veículo" }, 500);
  }
}
