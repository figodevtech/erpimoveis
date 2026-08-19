export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { requireOSEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { levantarTitulosDaOs, titulosQueAcompanham } from "./_lib/titulos-da-os";

type Params = { params: Promise<{ id: string }> };

/**
 * Troca de titularidade da OS.
 *
 * O cliente da OS não é só um rótulo: os títulos da OS carregam `cliente_id` e
 * ainda repetem nome e documento do pagador. Trocar só a OS deixaria o
 * recebível cobrando quem não deve. Por isso a troca é uma operação própria,
 * disponível depois do orçamento — antes disso o caminho é editar a OS.
 */
const STATUS_BLOQUEADOS = new Set(["CANCELADO"]);

function idValido(valor: unknown) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

async function carregarOrdem(osId: number) {
  const { data, error } = await supabaseAdmin
    .from("ordemservico")
    .select("id, status, clienteid, alvo_tipo, pecaid, veiculoid, is_deleted")
    .eq("id", osId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_deleted) return null;
  return data;
}

export async function GET(_: Request, { params }: Params) {
  try {
    await requireOSEdit();
    const osId = idValido((await params).id);
    if (!osId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const ordem = await carregarOrdem(osId);
    if (!ordem) {
      return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    }

    const [titulos, veiculo, notasServico, notasProduto] = await Promise.all([
      levantarTitulosDaOs(osId),
      ordem.veiculoid
        ? supabaseAdmin
            .from("veiculo")
            .select("id, placa, modelo, marca, clienteid, cliente:clienteid ( id, nomerazaosocial )")
            .eq("id", ordem.veiculoid)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // Nota cancelada não é documento em pé: não vale como alerta de troca.
      supabaseAdmin
        .from("nfse")
        .select("id", { count: "exact", head: true })
        .eq("ordemservicoid", osId)
        .neq("status", "CANCELADA"),
      supabaseAdmin
        .from("nfe")
        .select("id", { count: "exact", head: true })
        .eq("ordemservicoid", osId)
        .neq("status", "CANCELADA"),
    ]);

    if (veiculo.error) throw veiculo.error;
    if (notasServico.error) throw notasServico.error;
    if (notasProduto.error) throw notasProduto.error;

    const acompanham = titulosQueAcompanham(titulos);
    const somar = (apenasPendentes: boolean) =>
      Math.round(
        acompanham
          .filter((titulo) => titulo.pendente === apenasPendentes)
          .reduce((total, titulo) => total + titulo.valorFace, 0) * 100,
      ) / 100;

    const veiculoDaOs = veiculo.data as any;
    const proprietario = Array.isArray(veiculoDaOs?.cliente)
      ? veiculoDaOs?.cliente[0]
      : veiculoDaOs?.cliente;

    return NextResponse.json(
      {
        osId,
        status: ordem.status,
        clienteAtualId: ordem.clienteid ?? null,
        titulos,
        resumo: {
          quantidade: acompanham.length,
          valorEmAberto: somar(true),
          valorBaixado: somar(false),
        },
        veiculo: veiculoDaOs
          ? {
              id: veiculoDaOs.id,
              placa: veiculoDaOs.placa ?? null,
              descricao: [veiculoDaOs.marca, veiculoDaOs.modelo].filter(Boolean).join(" ") || null,
              proprietarioId: veiculoDaOs.clienteid ?? null,
              proprietarioNome: proprietario?.nomerazaosocial ?? null,
            }
          : null,
        notasEmitidas: (notasServico.count ?? 0) + (notasProduto.count ?? 0),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    const status = statusCode === 401 || statusCode === 403 ? statusCode : 500;
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível verificar a titularidade da OS." },
      { status },
    );
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    await requireOSEdit();
    const osId = idValido((await params).id);
    if (!osId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}) as any);
    const clienteId = idValido(body?.clienteId);
    if (!clienteId) {
      return NextResponse.json({ error: "Selecione o novo cliente." }, { status: 400 });
    }

    const ordem = await carregarOrdem(osId);
    if (!ordem) {
      return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    }
    if (STATUS_BLOQUEADOS.has(String(ordem.status ?? "").toUpperCase())) {
      return NextResponse.json(
        { error: "Uma OS cancelada não muda de titularidade." },
        { status: 409 },
      );
    }
    if (ordem.clienteid === clienteId) {
      return NextResponse.json({ error: "A OS já está neste cliente." }, { status: 400 });
    }

    const [novo, anterior] = await Promise.all([
      supabaseAdmin
        .from("cliente")
        .select("id, nomerazaosocial, cpfcnpj, status")
        .eq("id", clienteId)
        .maybeSingle(),
      ordem.clienteid
        ? supabaseAdmin
            .from("cliente")
            .select("id, nomerazaosocial")
            .eq("id", ordem.clienteid)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (novo.error) throw novo.error;
    if (anterior.error) throw anterior.error;
    if (!novo.data?.id) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 400 });
    }

    const atualizacaoOs = await supabaseAdmin
      .from("ordemservico")
      .update({ clienteid: clienteId })
      .eq("id", osId);
    if (atualizacaoOs.error) throw atualizacaoOs.error;

    // A peça é do dono da OS: fica órfã no cliente antigo se não acompanhar.
    if (String(ordem.alvo_tipo ?? "").toUpperCase() === "PECA" && ordem.pecaid) {
      const atualizacaoPeca = await supabaseAdmin
        .from("peca")
        .update({ clienteid: clienteId })
        .eq("id", ordem.pecaid);
      if (atualizacaoPeca.error) throw atualizacaoPeca.error;
    }

    // Nome e documento do pagador são desnormalizados na transação: sem
    // reescrever os três campos o financeiro continua exibindo o cliente antigo.
    const todos = await levantarTitulosDaOs(osId);
    const acompanham = titulosQueAcompanham(todos);
    if (acompanham.length > 0) {
      /*
       * `updated_by` não é enfeite aqui: o gatilho
       * `transacao_contraparte_historico_trg` grava uma linha de histórico por
       * título que troca de pagador, e é deste campo que ele tira o autor. Sem
       * ele o rastro sai anônimo — e uma troca de titularidade é justamente o
       * que alguém vai querer saber quem fez.
       *
       * Fica de fora do payload quando não há sessão, em vez de ir nulo: apagar
       * o último autor conhecido seria pior do que manter o anterior.
       */
      const session = await auth().catch(() => null);
      const usuarioId = (session?.user as { id?: string } | undefined)?.id;

      const titulos = await supabaseAdmin
        .from("transacao")
        .update({
          cliente_id: clienteId,
          nomepagador: novo.data.nomerazaosocial ?? null,
          cpfcnpjpagador: novo.data.cpfcnpj ?? null,
          // A transação não tem gatilho de `updated_at`: quem escreve carimba.
          updated_at: new Date().toISOString(),
          ...(usuarioId ? { updated_by: usuarioId } : {}),
        })
        .in(
          "id",
          acompanham.map((titulo) => titulo.id),
        )
        .eq("is_deleted", false)
        .select("id");
      if (titulos.error) throw titulos.error;
    }

    return NextResponse.json({
      ok: true,
      osId,
      clienteAnterior: anterior.data
        ? { id: anterior.data.id, nome: anterior.data.nomerazaosocial }
        : null,
      clienteNovo: { id: novo.data.id, nome: novo.data.nomerazaosocial },
      titulosAtualizados: acompanham.length,
      titulosCompartilhadosMantidos: todos.length - acompanham.length,
    });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode ?? 500);
    const status =
      statusCode === 401 || statusCode === 403 || statusCode === 409 ? statusCode : 500;
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível trocar o cliente da OS." },
      { status },
    );
  }
}
