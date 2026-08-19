// src/app/api/orcamentos/[id]/gerar-os/route.ts
//
// Converte um orcamento avulso em OS.
//
// Este e o unico ponto do modulo que encosta em estoque, e mesmo assim nao
// decide nada: entrega os itens para a OS e deixa config_geral.modo_baixa_estoque_os
// mandar, exatamente como numa OS aberta a mao.
//   - modo ORCAMENTO: reserva agora; se faltar saldo, 409 e a OS nao nasce.
//   - modo EXECUCAO:  nao mexe em saldo; a baixa espera o EM_ANDAMENTO.
//
// O orcamento tambem cobra aqui o que nao exigia antes — setor e alvo — porque
// sao obrigatorios para a OS existir.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOrcamentosEdit, requireOSCreate } from "@/app/api/_authz/perms";
import { buscarModoBaixaEstoqueOS } from "@/lib/ordens/estoque-os";
import { carregarItensDoOrcamento } from "@/lib/orcamentos/persistencia";

type AlvoTipo = "VEICULO" | "PECA" | "EQUIPAMENTO";
type StatusInicial = "AGUARDANDO_CHECKLIST" | "ORCAMENTO";

const PRIORIDADES = ["BAIXA", "NORMAL", "ALTA"] as const;

function normalizarPrioridade(valor: unknown) {
  const texto = String(valor ?? "").trim().toUpperCase();
  return (PRIORIDADES as readonly string[]).includes(texto) ? texto : "NORMAL";
}

// O alvo agora vem do proprio orcamento. O corpo continua podendo mandar o dele
// — e o que acontece quando o atendente troca o veiculo ou completa a peca na
// hora de gerar — mas o que ele omitir cai no que ja estava cotado.
function textoOuGuardado(doBody: unknown, guardado: unknown) {
  const enviado = String(doBody ?? "").trim();
  return enviado || String(guardado ?? "").trim();
}

function numeroOuGuardado(doBody: unknown, guardado: unknown) {
  const bruto =
    doBody === null || doBody === undefined || doBody === "" ? guardado : doBody;
  if (bruto === null || bruto === undefined || bruto === "") return null;
  return Number(bruto);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Rastreiam o que precisa ser desfeito: sem transacao no PostgREST, uma falha
  // no meio deixaria OS meia-criada e — pior — saldo reservado para uma OS que
  // nao existe mais.
  let osCriadaId: number | null = null;
  let veiculoCriadoId: number | null = null;
  let pecaCriadaId: number | null = null;
  const produtosReservados: number[] = [];

  try {
    await requireOrcamentosEdit();
    await requireOSCreate();

    const session = await auth();
    const usuariocriadorid = (session?.user as any)?.id as string | undefined;
    if (!usuariocriadorid) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const orcamentoId = Number(id);
    if (!Number.isInteger(orcamentoId) || orcamentoId <= 0) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const { data: orcamento, error: erroOrcamento } = await supabaseAdmin
      .from("orcamento")
      .select(
        "id, status, clienteid, veiculoid, descricao, observacoes, subtotal, desconto_tipo, desconto, valor_frete, total, alvo_tipo, peca_titulo, peca_descricao, peca_lacre, equipamento_nome, equipamento_patrimonio, equipamento_ano, equipamento_horimetro",
      )
      .eq("id", orcamentoId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (erroOrcamento) throw erroOrcamento;
    if (!orcamento) {
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }
    if (orcamento.status === "CONVERTIDO") {
      return NextResponse.json(
        { error: "Este orçamento já gerou uma OS." },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));

    const setorid = Number(body?.setorid);
    if (!Number.isInteger(setorid) || setorid <= 0) {
      return NextResponse.json({ error: "Selecione o setor da OS." }, { status: 400 });
    }

    const clienteid =
      body?.clienteid === null || body?.clienteid === undefined
        ? orcamento.clienteid ?? null
        : Number(body.clienteid);
    if (clienteid !== null && !Number.isInteger(clienteid)) {
      return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
    }

    const prioridade = normalizarPrioridade(body?.prioridade);
    const status: StatusInicial =
      body?.status === "AGUARDANDO_CHECKLIST" ? "AGUARDANDO_CHECKLIST" : "ORCAMENTO";

    const alvo = body?.alvo ?? {};
    const alvoTipo = String(
      alvo?.tipo ?? orcamento.alvo_tipo ?? "VEICULO",
    ).toUpperCase() as AlvoTipo;

    let veiculoid: number | null = null;
    let pecaid: number | null = null;
    let equipamentoNome: string | null = null;
    let equipamentoPatrimonio: string | null = null;
    let equipamentoAno: number | null = null;
    let equipamentoHorimetro: number | null = null;

    if (alvoTipo === "VEICULO") {
      veiculoid =
        body?.veiculoid ?? alvo?.veiculoid ?? orcamento.veiculoid ?? null;
      veiculoid = veiculoid === null ? null : Number(veiculoid);

      if (!veiculoid) {
        // Espelha /api/ordens/criar: sem veiculo cadastrado, a placa basta para
        // criar um; sem placa, a OS segue sem veiculo (o banco permite).
        const placa = String(alvo?.veiculo?.placa ?? "").trim();
        if (placa) {
          const { data: novoVeiculo, error: erroVeiculo } = await supabaseAdmin
            .from("veiculo")
            .insert({
              clienteid,
              placa,
              modelo: String(alvo?.veiculo?.modelo ?? "").trim() || "N/I",
              marca: String(alvo?.veiculo?.marca ?? "").trim() || "N/I",
              ano: alvo?.veiculo?.ano ?? null,
              cor: String(alvo?.veiculo?.cor ?? "").trim() || null,
              kmatual: alvo?.veiculo?.kmatual ?? null,
            })
            .select("id")
            .single();

          if (erroVeiculo) throw erroVeiculo;
          veiculoid = Number(novoVeiculo.id);
          veiculoCriadoId = veiculoid;
        } else {
          veiculoid = null;
        }
      }
    } else if (alvoTipo === "PECA") {
      const nome = textoOuGuardado(alvo?.peca?.nome, orcamento.peca_titulo);
      if (!nome) {
        return NextResponse.json(
          { error: "Para alvo PEÇA, informe o nome da peça." },
          { status: 400 },
        );
      }

      // So agora a peca entra no cadastro: enquanto era orcamento ela vivia nas
      // colunas soltas de public.orcamento, para proposta recusada nao deixar
      // registro orfao em public.peca.
      const { data: novaPeca, error: erroPeca } = await supabaseAdmin
        .from("peca")
        .insert({
          clienteid,
          veiculoid: null,
          titulo: nome,
          descricao: textoOuGuardado(alvo?.peca?.descricao, orcamento.peca_descricao) || null,
          lacre: textoOuGuardado(alvo?.peca?.lacre, orcamento.peca_lacre) || null,
        })
        .select("id")
        .single();

      if (erroPeca) throw erroPeca;
      pecaid = Number(novaPeca.id);
      pecaCriadaId = pecaid;
    } else if (alvoTipo === "EQUIPAMENTO") {
      equipamentoNome = textoOuGuardado(alvo?.equipamento?.nome, orcamento.equipamento_nome);
      if (!equipamentoNome) {
        return NextResponse.json(
          { error: "Informe o nome da máquina ou equipamento." },
          { status: 400 },
        );
      }

      equipamentoPatrimonio =
        textoOuGuardado(alvo?.equipamento?.patrimonio, orcamento.equipamento_patrimonio) || null;
      equipamentoAno = numeroOuGuardado(alvo?.equipamento?.ano, orcamento.equipamento_ano);
      equipamentoHorimetro = numeroOuGuardado(
        alvo?.equipamento?.horimetro,
        orcamento.equipamento_horimetro,
      );

      if (
        equipamentoAno !== null &&
        (!Number.isInteger(equipamentoAno) || equipamentoAno < 1900 || equipamentoAno > 3000)
      ) {
        return NextResponse.json({ error: "Ano do equipamento inválido." }, { status: 400 });
      }
      if (
        equipamentoHorimetro !== null &&
        (!Number.isFinite(equipamentoHorimetro) || equipamentoHorimetro < 0)
      ) {
        return NextResponse.json({ error: "Horímetro inválido." }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Tipo de alvo inválido." }, { status: 400 });
    }

    const itens = await carregarItensDoOrcamento(orcamentoId);

    // 1) Cria a OS ja com os totais do orcamento — os mesmos numeros que o
    //    cliente aprovou, sem recalcular preco.
    const { data: os, error: erroOS } = await supabaseAdmin
      .from("ordemservico")
      .insert({
        clienteid,
        veiculoid,
        pecaid,
        equipamento_nome: equipamentoNome,
        equipamento_patrimonio: equipamentoPatrimonio,
        equipamento_ano: equipamentoAno,
        equipamento_horimetro: equipamentoHorimetro,
        alvo_tipo: alvoTipo,
        usuariocriadorid,
        setorid,
        prioridade,
        status,
        descricao: orcamento.descricao ?? null,
        observacoes: orcamento.observacoes ?? null,
        orcamentoid: orcamentoId,
        subtotal: orcamento.subtotal ?? 0,
        desconto_tipo: orcamento.desconto_tipo ?? null,
        desconto: orcamento.desconto ?? 0,
        valor_frete: orcamento.valor_frete ?? 0,
        orcamentototal: orcamento.total ?? 0,
      })
      .select("id")
      .single();

    if (erroOS) throw erroOS;
    osCriadaId = Number(os.id);

    // 2) Copia os itens preservando o preco cotado.
    if (itens.produtos.length) {
      const { error } = await supabaseAdmin.from("osproduto").insert(
        itens.produtos.map((item) => ({
          ordemservicoid: osCriadaId,
          produtoid: item.produtoid,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          subtotal: item.subtotal,
          desconto_tipo: item.descontoTipo,
          desconto: item.desconto,
        })),
      );
      if (error) throw error;
    }

    if (itens.servicos.length) {
      const { error } = await supabaseAdmin.from("osservico").insert(
        itens.servicos.map((item) => ({
          ordemservicoid: osCriadaId,
          servicoid: item.servicoid,
          descricao: item.descricaoServico,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          subtotal: item.subtotal,
          desconto_tipo: item.descontoTipo,
          desconto: item.desconto,
        })),
      );
      if (error) throw error;
    }

    // Produtos avulsos entram como avulsos mesmo. A OS ja impede iniciar ou
    // finalizar com avulso pendente, entao o atendente sera obrigado a vincular
    // cada um a um produto de verdade antes de consumir estoque.
    if (itens.produtosAvulsos.length) {
      const { error } = await supabaseAdmin.from("osproduto_avulso").insert(
        itens.produtosAvulsos.map((item) => ({
          ordemservicoid: osCriadaId,
          titulo: item.titulo,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          subtotal: item.subtotal,
          desconto_tipo: item.descontoTipo,
          desconto: item.desconto,
          created_by: usuariocriadorid,
        })),
      );
      if (error) throw error;
    }

    // 3) Estoque — so agora, e so se a flag mandar.
    const modoBaixa = await buscarModoBaixaEstoqueOS();
    if (modoBaixa === "ORCAMENTO" && itens.produtos.length) {
      for (const item of itens.produtos) {
        const sync = await supabaseAdmin.rpc("sincronizar_baixa_estoque_os_produto", {
          p_os_id: osCriadaId,
          p_produto_id: item.produtoid,
          p_quantidade_alvo: item.quantidade,
        });

        if (sync.error) {
          if (/insuficiente/i.test(sync.error.message ?? "")) {
            const { data: produto } = await supabaseAdmin
              .from("produto")
              .select("titulo, estoque")
              .eq("id", item.produtoid)
              .maybeSingle();

            // Sai pelo mesmo caminho de limpeza do catch: os produtos anteriores
            // desta mesma conversao ja reservaram saldo e precisam devolver, ou
            // a falta de uma peca prenderia todas as outras.
            await desfazer({ osCriadaId, veiculoCriadoId, pecaCriadaId, produtosReservados });
            osCriadaId = null;
            veiculoCriadoId = null;
            pecaCriadaId = null;

            return NextResponse.json(
              {
                error:
                  `Estoque insuficiente para ${produto?.titulo ?? `produto #${item.produtoid}`}. ` +
                  `Disponível: ${Number(produto?.estoque ?? 0)}; necessário: ${item.quantidade}. ` +
                  `Ajuste o orçamento ou reponha o estoque antes de gerar a OS.`,
                codigo: "ESTOQUE_INSUFICIENTE",
                itens: [
                  {
                    id: item.produtoid,
                    titulo: produto?.titulo ?? `Produto #${item.produtoid}`,
                    disponivel: Number(produto?.estoque ?? 0),
                    solicitado: item.quantidade,
                  },
                ],
              },
              { status: 409 },
            );
          }
          throw sync.error;
        }

        produtosReservados.push(item.produtoid);
      }
    }

    // 4) Fecha o orcamento.
    const { error: erroFechamento } = await supabaseAdmin
      .from("orcamento")
      .update({
        status: "CONVERTIDO",
        updated_by: usuariocriadorid,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orcamentoId);

    if (erroFechamento) throw erroFechamento;

    return NextResponse.json({ ok: true, ordemservicoid: osCriadaId }, { status: 201 });
  } catch (err: any) {
    await desfazer({ osCriadaId, veiculoCriadoId, pecaCriadaId, produtosReservados });

    console.error("POST /api/orcamentos/[id]/gerar-os", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao gerar OS a partir do orçamento" },
      { status: err?.statusCode || 500 },
    );
  }
}

/**
 * Desfaz na ordem inversa. O estoque vem primeiro: devolver saldo depois de
 * apagar a OS seria impossivel, porque a RPC se apoia na baixa registrada para
 * a propria OS.
 */
async function desfazer(estado: {
  osCriadaId: number | null;
  veiculoCriadoId: number | null;
  pecaCriadaId: number | null;
  produtosReservados: number[];
}) {
  const { osCriadaId, veiculoCriadoId, pecaCriadaId, produtosReservados } = estado;

  try {
    if (osCriadaId && produtosReservados.length) {
      for (const produtoId of produtosReservados) {
        await supabaseAdmin.rpc("sincronizar_baixa_estoque_os_produto", {
          p_os_id: osCriadaId,
          p_produto_id: produtoId,
          p_quantidade_alvo: 0,
        });
      }
    }

    if (osCriadaId) {
      await supabaseAdmin.from("osproduto").delete().eq("ordemservicoid", osCriadaId);
      await supabaseAdmin.from("osservico").delete().eq("ordemservicoid", osCriadaId);
      await supabaseAdmin.from("osproduto_avulso").delete().eq("ordemservicoid", osCriadaId);
      await supabaseAdmin.from("ordemservico").delete().eq("id", osCriadaId);
    }

    if (pecaCriadaId) {
      await supabaseAdmin.from("peca").delete().eq("id", pecaCriadaId);
    }
    if (veiculoCriadoId) {
      await supabaseAdmin.from("veiculo").delete().eq("id", veiculoCriadoId);
    }
  } catch (erroRollback) {
    // Nao mascara o erro original: ele e o que o usuario precisa ver.
    console.error("Falha ao desfazer geração de OS a partir do orçamento", erroRollback);
  }
}
