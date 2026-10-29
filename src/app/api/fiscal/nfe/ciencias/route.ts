import { NextResponse, type NextRequest } from "next/server";

import {
  requireEstoqueAccess,
  requireFinanceirosAccess,
  requireVendasAccess,
} from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { MODELO_NFCE, MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import type { PedidoCiencia, ResultadoRegistroCiencia } from "@/services/fiscal/cienciaAvisoFiscal";
import { salvarNFeAvulsaDraft, type OpcoesSalvarNFe } from "@/services/fiscal/nfeAvulsaService";
import { salvarNFeDeOrigem } from "@/services/fiscal/nfeOrigemService";
import { salvarNFeDaSaida } from "@/services/fiscal/nfeSaidaService";

export const runtime = "nodejs";

// "Estou ciente" de um aviso fiscal da NF-e.
//
// Recebe o mesmo corpo que a rota de emissão receberia (`payload`), o alvo
// dessa rota e os avisos que o usuário confirmou. O serviço de emissão roda em
// modo registro: recalcula os avisos com o mesmo motor, grava em
// nfe_ciencia_aviso só os que estão pendentes de verdade, com o usuário da
// sessão, e não grava nada da NF-e. A permissão é a da rota de emissão do alvo.

type Alvo =
  | { tipo: "AVULSA"; id?: number | null }
  | { tipo: "VENDA"; id: number; modelo?: number }
  | { tipo: "ENTRADA" | "SAIDA"; id: number };

function lerPedidos(valor: unknown): PedidoCiencia[] | null {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > 500) return null;
  const pedidos: PedidoCiencia[] = [];
  for (const bruto of valor) {
    const pedido = bruto as Partial<PedidoCiencia> | null;
    const itemIndex = Number(pedido?.itemIndex);
    const code = String(pedido?.code ?? "").trim();
    const fingerprint = String(pedido?.fingerprint ?? "").trim();
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || !code || !fingerprint) return null;
    pedidos.push({ itemIndex, code, fingerprint });
  }
  return pedidos;
}

function idPositivo(valor: unknown) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function registrar(alvo: Alvo, payload: Record<string, any>, opcoes: OpcoesSalvarNFe) {
  switch (alvo.tipo) {
    case "AVULSA": {
      await requireFinanceirosAccess();
      const nfeId = alvo.id == null ? null : idPositivo(alvo.id);
      return salvarNFeAvulsaDraft({ ...(payload as any), nfeId }, opcoes);
    }
    case "VENDA": {
      await requireVendasAccess();
      const id = idPositivo(alvo.id);
      if (!id) return null;
      const modelo = Number(alvo.modelo) === MODELO_NFCE ? MODELO_NFCE : MODELO_NFE;
      return salvarNFeDeOrigem(alvo.tipo, id, payload as any, modelo, opcoes);
    }
    case "ENTRADA": {
      await requireEstoqueAccess();
      const id = idPositivo(alvo.id);
      return id ? salvarNFeDeOrigem("ENTRADA", id, payload as any, MODELO_NFE, opcoes) : null;
    }
    case "SAIDA": {
      await requireEstoqueAccess();
      const id = idPositivo(alvo.id);
      return id ? salvarNFeDaSaida(id, payload as any, opcoes) : null;
    }
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const atorId = (session?.user as { id?: string } | undefined)?.id;
    if (!atorId) {
      return NextResponse.json({ ok: false, message: "Não autenticado." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    const alvo = body?.alvo as Alvo | undefined;
    const payload = body?.payload;
    const pedidos = lerPedidos(body?.pedidos);
    if (!alvo || !payload || typeof payload !== "object" || Array.isArray(payload) || !pedidos) {
      return NextResponse.json(
        { ok: false, message: "Informe o alvo da emissão, o payload e os avisos confirmados." },
        { status: 400 },
      );
    }

    const resultado = await registrar(
      alvo,
      { ...payload, cienciaEscopo: body?.cienciaEscopo ?? payload.cienciaEscopo ?? null },
      { registrarCiencia: { atorId, pedidos } },
    );
    if (!resultado) {
      return NextResponse.json({ ok: false, message: "Alvo da emissão inválido." }, { status: 400 });
    }
    const ciencia = (resultado as { ciencia?: ResultadoRegistroCiencia }).ciencia;
    if (ciencia) return NextResponse.json({ ok: true, ...ciencia });
    // O motor parou antes dos avisos (bloqueio, dado incompleto): nada foi
    // registrado, e a tela mostra os mesmos erros que a emissão mostraria.
    return NextResponse.json({ ok: false, errors: resultado.errors ?? [] }, { status: 422 });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : error?.statusCode === 401 ? 401 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para emitir esta nota."
            : status === 401
              ? "Não autenticado."
              : "Erro ao registrar a ciência do aviso fiscal.",
        detalhe: error?.message ?? String(error),
      },
      { status },
    );
  }
}
