export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import {
  resolveOrdemVehicle,
  type OrdemVehicleSnapshot,
} from "@/lib/ordens/vehicle-snapshot";
import {
  resolveOrdemCustomer,
  type OrdemCustomerSnapshot,
} from "@/lib/ordens/customer-snapshot";
import { carregarFatiasRateadas, fatiaComoTransacao } from "@/lib/financeiro/rateio-documentos";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { requireOSEdit, requireOSAccess, hasOSRentabilidade } from "@/app/api/_authz/perms";
import { valorDeFace } from "@/lib/financeiro/transacao";
import { calcularResumoFinanceiroOs } from "@/lib/ordens/financeiro";

type Prioridade = "BAIXA" | "NORMAL" | "ALTA";
type AlvoTipo = "VEICULO" | "PECA" | "EQUIPAMENTO";
type CkStatus = "OK" | "ALERTA" | "FALHA";

const toNum = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sanitizeCkStatus = (s?: string): CkStatus => {
  const up = String(s || "").toUpperCase();
  return (["OK", "ALERTA", "FALHA"] as const).includes(up as CkStatus) ? (up as CkStatus) : "OK";
};

type RealizadorLite = { id: string; nome: string | null };

function primeiro<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/* =========================================
 * GET: OS + setor + peça + checklist (+imagens) + itens + aprovações
 * ========================================= */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOSAccess();
    const { id } = await ctx.params;
    const osId = Number(id);
    if (!osId) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    // OS base
    const os_res = await supabase
      .from("ordemservico")
      .select(
        [
          "id",
          "clienteid",
          "veiculoid",
          "usuariocriadorid",
          "setorid",
          "status",
          "statusaprovacao",
          "descricao",
          "dataentrada",
          "datasaida",
          "pagamento_concluido_em",
          "finalizado_em",
          "destacada",
          "destaque_motivo",
          "destaque_cor",
          "destacada_por",
          "destacada_em",
          "orcamentototal",
          "valor_frete",
          "subtotal",
          "desconto_tipo",
          "desconto",
          "acrescimo_financeiro_tipo",
          "acrescimo_financeiro_valor",
          "observacoes",
          "observacoes_fiscais",
          "forma_pagamento",
          "parcelas_pagamento",
          "pagamentos_previstos",
          "descricao_financeiro",
          "garantia",
          "motivo_cancelamento",
          "motivo_sem_cobranca",
          "createdat",
          "updatedat",
          "checklist_modelo_id",
          "prioridade",
          "alvo_tipo",
          "pecaid",
          "equipamento_nome",
          "equipamento_patrimonio",
          "equipamento_ano",
          "equipamento_horimetro",
          "motivo_cancelamento",
          "execucao_inicio_em",
          "execucao_fim_em",
          "migracao_referencia",
          "cliente_snapshot",
          "veiculo_snapshot"
        ].join(",")
      )
      .eq("id", osId)
      .maybeSingle();

    if (os_res.error) throw os_res.error;

    type OrdemRow = {
      id: number;
      clienteid: number | null;
      veiculoid: number | null;
      usuariocriadorid: string;
      setorid: number | null;
      status: string | null;
      statusaprovacao: string | null;
      descricao: string | null;
      execucao_inicio_em: string | null;
      execucao_fim_em: string | null;
      dataentrada: string | null;
      datasaida: string | null;
      pagamento_concluido_em: string | null;
      finalizado_em: string | null;
      destacada: boolean;
      destaque_motivo: string | null;
      destaque_cor?: string | null;
      destacada_por: string | null;
      destacada_em: string | null;
      orcamentototal: number | null;
      valor_frete?: number | null;
      subtotal?: number | null;
      desconto_tipo?: string | null;
      desconto?: number | null;
      acrescimo_financeiro_tipo?: string | null;
      acrescimo_financeiro_valor?: number | null;
      observacoes: string | null;
      observacoes_fiscais: string | null;
      forma_pagamento: string | null;
      parcelas_pagamento: number | null;
      pagamentos_previstos: Array<{
        metodo: string;
        valor: number;
        parcelas?: number | null;
      }> | null;
      descricao_financeiro: string | null;
      garantia: string | null;
      createdat: string | null;
      updatedat: string | null;
      checklist_modelo_id: number | null;
      prioridade: Prioridade | null;
      alvo_tipo: AlvoTipo | null;
      pecaid: number | null;
      equipamento_nome: string | null;
      equipamento_patrimonio: string | null;
      equipamento_ano: number | null;
      equipamento_horimetro: number | null;
      motivo_cancelamento?: string | null;
      motivo_sem_cobranca?: string | null;
      migracao_referencia?: string | null;
      cliente_snapshot?: OrdemCustomerSnapshot | null;
      veiculo_snapshot?: OrdemVehicleSnapshot | null;
    };

    const osRow = os_res.data as OrdemRow | null;
    if (!osRow) return NextResponse.json({ error: "OS não encontrada" }, { status: 404 });

    // Setor
    const setor_res = await supabase.from("setor").select("id, nome, descricao").eq("id", osRow.setorid).maybeSingle();
    if (setor_res.error) throw setor_res.error;

    const setor = (setor_res.data as { id: number; nome: string; descricao: string | null } | null) ?? null;

    const criador_res = await supabase
      .from("usuario")
      .select("id, nome")
      .eq("id", osRow.usuariocriadorid)
      .maybeSingle();

    const criador =
      criador_res.error
        ? null
        : criador_res.data
        ? {
            id: String((criador_res.data as any).id),
            nome: ((criador_res.data as any).nome ?? null) as string | null,
          }
        : null;

    // Cliente
    type ClienteRow = {
      id: number;
      tipopessoa: string | null;
      nomerazaosocial: string;
      cpfcnpj: string;
      email: string | null;
      telefone: string | null;
      endereco: string | null;
      endereconumero: string | null;
      enderecocomplemento: string | null;
      bairro: string | null;
      cidade: string | null;
      estado: string | null;
      cep: string | null;
      inscricaoestadual: string | null;
      inscricaomunicipal: string | null;
      codigomunicipio: string | null;
      createdat: string | null;
      updatedat: string | null;
      status: string | null;
      rank: string | null;
    };

    let clienteRow: ClienteRow | null = null;

    if (osRow.clienteid !== null) {
      const cli_res = await supabase
        .from("cliente")
        .select(
          "id, tipopessoa, nomerazaosocial, cpfcnpj, email, telefone, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio, createdat, updatedat, status, rank"
        )
        .eq("id", osRow.clienteid)
        .maybeSingle();
      if (cli_res.error) throw cli_res.error;

      clienteRow = cli_res.data as ClienteRow | null;
    }

    const cliente = clienteRow
      ? resolveOrdemCustomer({
        id: clienteRow.id,
        tipopessoa: clienteRow.tipopessoa,
        nomerazaosocial: clienteRow.nomerazaosocial,
        cpfcnpj: clienteRow.cpfcnpj,
        email: clienteRow.email,
        telefone: clienteRow.telefone,
        endereco: clienteRow.endereco,
        endereconumero: clienteRow.endereconumero,
        enderecocomplemento: clienteRow.enderecocomplemento,
        bairro: clienteRow.bairro,
        cidade: clienteRow.cidade,
        estado: clienteRow.estado,
        cep: clienteRow.cep,
        inscricaoestadual: clienteRow.inscricaoestadual,
        inscricaomunicipal: clienteRow.inscricaomunicipal,
        codigomunicipio: clienteRow.codigomunicipio,
        createdat: clienteRow.createdat,
        updatedat: clienteRow.updatedat,
        status: clienteRow.status,
        rank: clienteRow.rank,
      }, null)
      : resolveOrdemCustomer(null, osRow.cliente_snapshot);

    // Veículo
    let veiculo:
      | {
          id: number | null;
          placa: string | null;
          modelo: string | null;
          marca: string | null;
          ano: number | null;
          cor: string | null;
          kmatual: number | null;
          chassi: string | null;
          ano_modelo?: number | null;
          renavam?: string | null;
          combustivel?: string | null;
          descricao_veiculo?: string | null;
          historico?: boolean;
        }
      | null = null;

    if (osRow.veiculoid) {
      const v_res = await supabase.from("veiculo").select("id, placa, modelo, marca, ano, cor, kmatual, chassi").eq("id", osRow.veiculoid).maybeSingle();
      if (v_res.error) throw v_res.error;
      if (v_res.data) {
        veiculo = {
          id: v_res.data.id,
          placa: v_res.data.placa ?? null,
          modelo: v_res.data.modelo ?? null,
          marca: v_res.data.marca ?? null,
          ano: v_res.data.ano ?? null,
          cor: v_res.data.cor ?? null,
          kmatual: v_res.data.kmatual ?? null,
          chassi: v_res.data.chassi ?? null,
        };
      }
    }
    const veiculoResolvido = resolveOrdemVehicle(veiculo, osRow.veiculo_snapshot);
    veiculo = veiculoResolvido
      ? {
          id: veiculoResolvido.id ?? null,
          placa: veiculoResolvido.placa ?? null,
          modelo: veiculoResolvido.modelo ?? null,
          marca: veiculoResolvido.marca ?? null,
          ano: veiculoResolvido.ano ?? null,
          cor: veiculoResolvido.cor ?? null,
          kmatual: veiculoResolvido.kmatual ?? null,
          chassi: veiculoResolvido.chassi ?? null,
          ano_modelo: veiculoResolvido.ano_modelo ?? null,
          renavam: veiculoResolvido.renavam ?? null,
          combustivel: veiculoResolvido.combustivel ?? null,
          descricao_veiculo: veiculoResolvido.descricao_veiculo ?? null,
          historico: veiculoResolvido.historico === true,
        }
      : null;

    // Peça (opcional)
    let peca: { id: number; titulo: string; descricao: string | null; lacre?: string | null } | null = null;
    if (osRow.pecaid) {
      const pc_res = await supabase.from("peca").select("id, titulo, descricao, lacre").eq("id", osRow.pecaid).maybeSingle();
      if (pc_res.error) throw pc_res.error;
      if (pc_res.data) {
        peca = {
          id: pc_res.data.id,
          titulo: pc_res.data.titulo,
          descricao: pc_res.data.descricao ?? null,
          lacre: pc_res.data.lacre ?? null,
        };
      }
    }

    const equipamento =
      osRow.alvo_tipo === "EQUIPAMENTO" && osRow.equipamento_nome
        ? {
            nome: osRow.equipamento_nome,
            patrimonio: osRow.equipamento_patrimonio,
            ano: osRow.equipamento_ano,
            horimetro: osRow.equipamento_horimetro,
          }
        : null;

    // Checklist + imagens (+ usuário que respondeu)
    const ck_res = await supabase
      .from("checklist")
      .select(
        `
          id,
          item,
          status,
          observacao,
          createdat,
          created_by,
          usuario:usuario!checklist_created_by_fkey (
            id,
            nome
          )
        `
      )
      .eq("ordemservicoid", osId);

    if (ck_res.error) throw ck_res.error;

    // RAW: usuario pode vir como array ou objeto (tipagem/shape varia)
    type CkRowRaw = {
      id: any;
      item: any;
      status: any;
      observacao: any;
      createdat: any;
      created_by: any;
      usuario: any; // pode ser [{...}] ou {...} ou null
    };

    const ckRowsRaw = (ck_res.data ?? []) as unknown as CkRowRaw[];

    const ckRows = ckRowsRaw.map((r) => {
      const embedded = r.usuario;
      const u = Array.isArray(embedded) ? embedded[0] : embedded;

      return {
        id: Number(r.id),
        item: String(r.item),
        status: sanitizeCkStatus(String(r.status ?? "OK")),
        observacao: (r.observacao ?? null) as string | null,
        createdat: (r.createdat ?? null) as string | null,
        created_by: (r.created_by ?? null) as string | null,
        usuario: u ? { id: String(u.id), nome: (u.nome ?? null) as string | null } : null,
      };
    });

    const ckIds = ckRows.map((r) => r.id);

    const imgsMap = new Map<number, Array<{ id: number; url: string; descricao: string | null; createdat: string | null }>>();

    if (ckIds.length) {
      const img_res = await supabase.from("imagemvistoria").select("id, checklistid, url, descricao, createdat").in("checklistid", ckIds);
      if (img_res.error) throw img_res.error;

      for (const it of img_res.data ?? []) {
        const arr = imgsMap.get(it.checklistid) ?? [];
        arr.push({
          id: Number(it.id),
          url: String(it.url),
          descricao: it.descricao ?? null,
          createdat: it.createdat ?? null,
        });
        imgsMap.set(it.checklistid, arr);
      }
    }

    const checklist = ckRows.map((ck) => ({
      id: ck.id,
      item: ck.item,
      status: ck.status,
      observacao: ck.observacao ?? null,
      createdat: ck.createdat ?? null,
      created_by: ck.created_by ?? null,
      usuario: ck.usuario ?? null,
      imagens: imgsMap.get(ck.id) ?? [],
    }));

    const saidaRes = await supabase
      .from("os_saida")
      .select("id, saida_em, retirado_por, documento_observacao, checklist_modelo_id, registrado_por, created_at, itens:os_saida_checklist_item(id, titulo, descricao, categoria, status, observacao, ordem, created_at, imagens:os_saida_checklist_imagem(id, url, descricao, created_at))")
      .eq("ordemservico_id", osId)
      .maybeSingle();
    if (saidaRes.error) throw saidaRes.error;
    let saida: any = saidaRes.data ?? null;
    if (saida?.registrado_por) {
      const usuarioSaida = await supabase.from("usuario").select("id, nome").eq("id", saida.registrado_por).maybeSingle();
      if (usuarioSaida.error) throw usuarioSaida.error;
      saida = { ...saida, usuario: usuarioSaida.data ?? null };
    }

    // Itens — produtos
    const prod_res = await supabase
      .from("osproduto")
      .select("ordemservicoid, produtoid, quantidade, precounitario, subtotal, desconto_tipo, desconto, custo_unitario_aplicado, produto:produtoid (id, titulo, descricao, referencia, codigobarras, precovenda, ultimovalordecompra, unidade)")
      .eq("ordemservicoid", osId);
    if (prod_res.error) throw prod_res.error;

    const itensProduto = (prod_res.data ?? []).map((r: any) => ({
      ordemservicoid: osId,
      produtoid: Number(r.produtoid),
      quantidade: toNum(r.quantidade),
      precounitario: toNum(r.precounitario),
      subtotal: toNum(r.subtotal),
      descontoTipo: r.desconto_tipo ?? null,
      desconto: toNum(r.desconto ?? 0),
      custoUnitarioAplicado: r.custo_unitario_aplicado == null ? null : toNum(r.custo_unitario_aplicado),
      custoEstimado: r.custo_unitario_aplicado == null,
      produto: r.produto
        ? {
            id: Number(r.produto.id),
            codigo: String(r.produto.referencia ?? r.produto.codigobarras ?? "") || null,
            titulo: String(r.produto.titulo ?? ""),
            descricao: String(r.produto.descricao ?? ""),
            precounitario: r.produto.precovenda ?? null,
            ultimovalordecompra: r.produto.ultimovalordecompra ?? null,
            unidade: r.produto.unidade ?? null,
          }
        : null,
    }));

    const avulsoRes = await supabase
      .from("osproduto_avulso")
      .select("id, ordemservicoid, titulo, quantidade, precounitario, subtotal, desconto_tipo, desconto")
      .eq("ordemservicoid", osId)
      .order("id", { ascending: true });
    if (avulsoRes.error) throw avulsoRes.error;
    const itensProdutoAvulso = (avulsoRes.data ?? []).map((item: any) => ({
      id: Number(item.id),
      ordemservicoid: osId,
      titulo: String(item.titulo ?? ""),
      quantidade: toNum(item.quantidade),
      precounitario: toNum(item.precounitario),
      subtotal: toNum(item.subtotal),
      descontoTipo: item.desconto_tipo ?? null,
      desconto: toNum(item.desconto ?? 0),
    }));

    // Itens — serviços
    const serv_res = await supabase
      .from("osservico")
      .select(
        `
          ordemservicoid,
          servicoid,
          descricao,
          quantidade,
          precounitario,
          subtotal,
          desconto_tipo,
          desconto,
          servico:servicoid (id, codigo, descricao, precohora)
        `
      )
      .eq("ordemservicoid", osId);

    if (serv_res.error) throw serv_res.error;

    // Realizadores (N:N)
    const rel_res = await supabase
      .from("osservico_realizador")
      .select(
        `
          ordemservicoid,
          servicoid,
          usuarioid,
          comissao_percent_aplicada,
          valor_base,
          valor_comissao,
          usuario:usuarioid (id, nome)
        `
      )
      .eq("ordemservicoid", osId);

    if (rel_res.error) throw rel_res.error;

    const realizadoresByServico = new Map<number, RealizadorLite[]>();
    const comissoesByServico = new Map<
      number,
      Array<{
        usuarioid: string;
        nome: string | null;
        percentual: number;
        valorBase: number;
        valorComissao: number;
      }>
    >();
    for (const rr of rel_res.data ?? []) {
      const sid = Number((rr as any).servicoid);
      const usuario = primeiro((rr as any).usuario) as { id?: unknown; nome?: unknown } | null;
      const usuarioid = (rr as any).usuarioid;
      const idRealizador = String(usuario?.id ?? usuarioid ?? "").trim();
      if (!idRealizador) continue;
      const nomeRealizador = String(usuario?.nome ?? "").trim() || null;

      const item: RealizadorLite = {
        id: idRealizador,
        nome: nomeRealizador,
      };

      const arr = realizadoresByServico.get(sid) ?? [];
      arr.push(item);
      realizadoresByServico.set(sid, arr);

      const comissoes = comissoesByServico.get(sid) ?? [];
      comissoes.push({
        usuarioid: idRealizador,
        nome: nomeRealizador,
        percentual: toNum((rr as any).comissao_percent_aplicada),
        valorBase: toNum((rr as any).valor_base),
        valorComissao: toNum((rr as any).valor_comissao),
      });
      comissoesByServico.set(sid, comissoes);
    }

    const itensServico = (serv_res.data ?? []).map((r: any) => ({
      ordemservicoid: osId,
      servicoid: Number(r.servicoid),
      descricaoServico: r.descricao ?? null,
      quantidade: toNum(r.quantidade),
      precounitario: toNum(r.precounitario),
      subtotal: toNum(r.subtotal),
      descontoTipo: r.desconto_tipo ?? null,
      desconto: toNum(r.desconto ?? 0),
      realizadores: realizadoresByServico.get(Number(r.servicoid)) ?? [],
      servico: r.servico
        ? {
            id: Number(r.servico.id),
            codigo: r.servico.codigo ?? null,
            descricao: r.servico.descricao ?? null,
            precohora: r.servico.precohora ?? null,
          }
        : null,
    }));

    const trans_res = await supabase
      .from("transacao")
      .select("id, descricao, valor, valorLiquido, valor_acrescimos, valor_descontos, data, tipo, pendente, metodopagamento, categoria, plano_de_conta, plano_de_conta_id, banco_id, evento_financeiro_id, lancamento_id")
      .eq("ordemservicoid", osId)
      .eq("is_deleted", false)
      .order("data", { ascending: false });
    if (trans_res.error) throw trans_res.error;

    // Pagamento múltiplo não preenche `ordemservicoid`. Sem juntar as fatias, a
    // OS paga em grupo aparece sem pagamento nenhum no detalhe.
    const fatiasDaOs = await carregarFatiasRateadas("OS", [osId]);
    const transacoesDaOs = [
      ...(trans_res.data ?? []),
      ...(fatiasDaOs.get(osId) ?? []).map(fatiaComoTransacao),
    ];

    const despesas_servico_res = await supabase
      .from("eventos_financeiros")
      .select("id, servicoid, descricao, detalhe, valor, status, transacaoid, lancamento_id")
      .eq("ordemservicoid", osId)
      .eq("origem", "SERVICO")
      .eq("natureza", "DESPESA")
      .neq("status", "CANCELADO")
      .not("servicoid", "is", null)
      .order("data_evento", { ascending: true })
      .order("id", { ascending: true });
    if (despesas_servico_res.error) throw despesas_servico_res.error;

    const transacoes = transacoesDaOs.map((t: any) => ({
      ...t,
      valor: toNum(t.valor),
      valorLiquido: t.valorLiquido == null ? toNum(t.valor) : toNum(t.valorLiquido),
      pendente: Boolean(t.pendente),
    }));
    const resumoFinanceiro = calcularResumoFinanceiroOs({
      totalComercial: osRow.orcamentototal,
      acrescimoFinanceiroTipo: osRow.acrescimo_financeiro_tipo,
      acrescimoFinanceiroValor: osRow.acrescimo_financeiro_valor,
      transacoes,
    });

    const receitasPagas = transacoes.filter((t: any) => t.tipo === "RECEITA" && !t.pendente);
    const despesas = transacoes.filter((t: any) => t.tipo === "DESPESA");
    const despesasPagas = despesas.filter((t: any) => !t.pendente);
    const despesasPendentes = despesas.filter((t: any) => t.pendente);
    const transacoesPorId = new Map(
      transacoes.map((transacao: any) => [Number(transacao.id), transacao]),
    );
    // As parcelas de um boleto de despesas. A despesa lançada em grupo não tem
    // `transacaoid` — com cinco parcelas não existe UMA transação para nomear —,
    // então quem responde "isso já foi pago?" é o conjunto.
    const parcelasPorLancamento = new Map<number, any[]>();
    for (const transacao of transacoes as any[]) {
      if (transacao.lancamento_id == null) continue;
      const chave = Number(transacao.lancamento_id);
      const atual = parcelasPorLancamento.get(chave);
      if (atual) atual.push(transacao);
      else parcelasPorLancamento.set(chave, [transacao]);
    }
    const despesasByServico = new Map<
      number,
      Array<{
        id: number;
        descricao: string;
        detalhe: string | null;
        valor: number;
        status: "ATIVO" | "CONVERTIDO";
        situacao: "PREVISTA" | "A_PAGAR" | "PARCIAL" | "PAGA" | "LANCADA";
        transacaoid: number | null;
        lancamentoid: number | null;
        parcelas: number;
        parcelasPagas: number;
      }>
    >();
    for (const evento of despesas_servico_res.data ?? []) {
      const servicoid = Number(evento.servicoid);
      const transacaoid = evento.transacaoid == null ? null : Number(evento.transacaoid);
      const transacao = transacaoid ? transacoesPorId.get(transacaoid) : null;
      const lancamentoid = evento.lancamento_id == null ? null : Number(evento.lancamento_id);
      const parcelas: any[] = lancamentoid
        ? (parcelasPorLancamento.get(lancamentoid) ?? [])
        : [];
      const parcelasPagas = parcelas.filter((p: any) => p.pendente === false).length;
      const status = evento.status === "CONVERTIDO" ? "CONVERTIDO" : "ATIVO";
      const despesasServico = despesasByServico.get(servicoid) ?? [];
      despesasServico.push({
        id: Number(evento.id),
        descricao: String(evento.descricao || "Despesa do servi\u00e7o"),
        detalhe: evento.detalhe ? String(evento.detalhe) : null,
        valor: toNum(evento.valor),
        status,
        // Vínculo direto: a resposta é o `pendente` daquela transação. Boleto em
        // grupo: é o conjunto das parcelas — todas em aberto é a pagar, todas
        // baixadas é paga, e o meio do caminho tem nome próprio, senão um boleto
        // de 5x com 4 pagas apareceria igual a um sem nenhuma.
        situacao:
          status === "ATIVO"
            ? "PREVISTA"
            : parcelas.length > 0
              ? parcelasPagas === 0
                ? "A_PAGAR"
                : parcelasPagas === parcelas.length
                  ? "PAGA"
                  : "PARCIAL"
              : transacao?.pendente === true
                ? "A_PAGAR"
                : transacao?.pendente === false
                  ? "PAGA"
                  : "LANCADA",
        transacaoid,
        lancamentoid,
        parcelas: parcelas.length,
        parcelasPagas,
      });
      despesasByServico.set(servicoid, despesasServico);
    }
    // Duas leituras diferentes do mesmo pagamento, e nao da para usar uma so:
    //   face    -> o que abateu a OS (juros e multa nao abatem);
    //   cobrado -> o que saiu do bolso do cliente, base da taxa de recebimento.
    // Sem acrescimo lancado as duas sao iguais, que e o estado de tudo que ja
    // existia.
    const recebidoBruto = receitasPagas.reduce(
      (acc: number, t: any) => acc + valorDeFace(t),
      0,
    );
    const recebidoCobrado = receitasPagas.reduce((acc: number, t: any) => acc + t.valor, 0);
    const recebidoLiquido = receitasPagas.reduce((acc: number, t: any) => acc + t.valorLiquido, 0);
    const valorFinalOs = toNum(osRow.orcamentototal);
    const valorFrete = toNum(osRow.valor_frete);
    const valorLiquidoItensOs = Math.max(0, valorFinalOs - valorFrete);
    const subtotalItens = [...itensProduto, ...itensServico].reduce(
      (acc: number, item: any) => acc + toNum(item.subtotal),
      0,
    );
    const fatorDescontoOs = subtotalItens > 0 ? valorLiquidoItensOs / subtotalItens : 1;
    const produtosRentabilidade = itensProduto.map((item: any) => {
      const custoAtual = item.produto?.ultimovalordecompra;
      const custoNaoInformado = item.custoUnitarioAplicado == null && custoAtual == null;
      const custoEstimado = item.custoUnitarioAplicado == null && custoAtual != null;
      const custoUnitario = item.custoUnitarioAplicado ?? toNum(custoAtual);
      const custoTotal = custoUnitario * item.quantidade;
      const receitaLiquida = toNum(item.subtotal) * fatorDescontoOs;
      const lucroBruto = receitaLiquida - custoTotal;

      return {
        produtoid: item.produtoid,
        descricao: item.produto?.titulo || item.produto?.descricao || "Produto",
        quantidade: item.quantidade,
        receitaLiquida,
        custoUnitario,
        custoTotal,
        lucroBruto,
        margemBruta: receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : 0,
        custoEstimado,
        custoNaoInformado,
      };
    });
    const custoProdutos = itensProduto.reduce((acc: number, item: any) => {
      const custoUnitario = item.custoUnitarioAplicado ?? toNum(item.produto?.ultimovalordecompra);
      return acc + custoUnitario * item.quantidade;
    }, 0);
    const despesasServicoNaoLancadas = Array.from(despesasByServico.values())
      .flat()
      .filter((despesa) => despesa.status === "ATIVO" && despesa.transacaoid == null)
      .reduce((acc, despesa) => acc + despesa.valor, 0);
    const despesasComprometidas =
      despesas.reduce((acc: number, t: any) => acc + t.valor, 0) +
      despesasServicoNaoLancadas;
    const despesasRealizadas = despesasPagas.reduce((acc: number, t: any) => acc + t.valorLiquido, 0);
    const comissoesServicos = itensServico.map((item: any) => {
      const realizadores = comissoesByServico.get(item.servicoid) ?? [];
      const despesasServico = despesasByServico.get(item.servicoid) ?? [];
      const receitaLiquida = item.subtotal * fatorDescontoOs;
      const valorComissao = realizadores.reduce(
        (acc, realizador) => acc + realizador.valorComissao,
        0,
      );
      const valorOutrasDespesas = despesasServico.reduce(
        (acc, despesa) => acc + despesa.valor,
        0,
      );
      const resultadoServico = receitaLiquida - valorComissao - valorOutrasDespesas;
      return {
        servicoid: item.servicoid,
        descricao: item.descricaoServico || item.servico?.descricao || "Serviço",
        valorServico: item.subtotal,
        receitaLiquida,
        valorComissao,
        valorOutrasDespesas,
        valorDespesasTotal: valorComissao + valorOutrasDespesas,
        resultadoServico,
        margemServico: receitaLiquida > 0 ? (resultadoServico / receitaLiquida) * 100 : 0,
        despesas: despesasServico,
        realizadores,
      };
    });
    const totalComissoesServicos = comissoesServicos.reduce(
      (acc, servico) => acc + servico.valorComissao,
      0,
    );
    const totalOutrasDespesasServicos = comissoesServicos.reduce(
      (acc, servico) => acc + servico.valorOutrasDespesas,
      0,
    );
    const lucroPrevisto =
      valorFinalOs - custoProdutos - despesasComprometidas - totalComissoesServicos;
    const lucroRealizado =
      recebidoLiquido - custoProdutos - despesasRealizadas - totalComissoesServicos;
    const rentabilidade = {
      valorFinalOs,
      valorFrete,
      recebidoBruto,
      recebidoLiquido,
      taxasRecebimento: Math.max(0, recebidoCobrado - recebidoLiquido),
      saldoAReceber: Math.max(0, valorFinalOs - recebidoBruto),
      custoProdutos,
      itensCustoEstimado: produtosRentabilidade.filter((item) => item.custoEstimado).length,
      itensSemCusto: produtosRentabilidade.filter((item) => item.custoNaoInformado).length,
      produtos: produtosRentabilidade,
      despesasComprometidas,
      despesasPagas: despesasRealizadas,
      despesasPendentes:
        despesasPendentes.reduce((acc: number, t: any) => acc + t.valor, 0) +
        despesasServicoNaoLancadas,
      totalComissoesServicos,
      totalOutrasDespesasServicos,
      comissoesServicos,
      lucroPrevisto,
      lucroRealizado,
      margemPrevista: valorFinalOs > 0 ? (lucroPrevisto / valorFinalOs) * 100 : 0,
      margemRealizada: recebidoLiquido > 0 ? (lucroRealizado / recebidoLiquido) * 100 : 0,
    };

    // Aprovações
    const ap_res = await supabase.from("osaprovacao").select("id, token, expira_em, usado_em, created_at").eq("ordemservicoid", osId);
    if (ap_res.error) throw ap_res.error;

    const aprovacoes =
      (ap_res.data as Array<{ id: number; token: string; expira_em: string | null; usado_em: string | null; created_at: string | null }>) ?? [];

    // OS agregada
    const os = {
      id: osRow.id,
      usuariocriadorid: osRow.usuariocriadorid,
      criador,
      orcamentototal: osRow.orcamentototal,
      valor_frete: osRow.valor_frete ?? 0,
      subtotal: osRow.subtotal ?? osRow.orcamentototal,
      desconto_tipo: osRow.desconto_tipo ?? null,
      desconto: osRow.desconto ?? 0,
      acrescimo_financeiro_tipo: osRow.acrescimo_financeiro_tipo ?? null,
      acrescimo_financeiro_valor: osRow.acrescimo_financeiro_valor ?? 0,
      descricao: osRow.descricao ?? null,
      observacoes: osRow.observacoes ?? null,
      observacoes_fiscais: osRow.observacoes_fiscais ?? null,
      forma_pagamento: osRow.forma_pagamento ?? null,
      parcelas_pagamento: osRow.parcelas_pagamento ?? null,
      pagamentos_previstos: Array.isArray(osRow.pagamentos_previstos)
        ? osRow.pagamentos_previstos
        : null,
      descricao_financeiro: osRow.descricao_financeiro ?? null,
      garantia: osRow.garantia ?? null,
      motivocancelamento: (osRow as any).motivo_cancelamento ?? null,
      motivosemcobranca: (osRow as any).motivo_sem_cobranca ?? null,
      status: osRow.status ?? null,
      statusaprovacao: osRow.statusaprovacao ?? null,
      prioridade: (osRow.prioridade ?? "NORMAL") as Prioridade,
      execucao_inicio_em: osRow.execucao_inicio_em ?? null,
      // Fim do andamento: gravado quando o ultimo servico da execucao e
      // finalizado e a OS vai para PAGAMENTO. E a "entrega" do cabecalho.
      execucao_fim_em: osRow.execucao_fim_em ?? null,
      dataentrada: osRow.dataentrada ?? null,
      datasaida: osRow.datasaida ?? null,
      pagamento_concluido_em: osRow.pagamento_concluido_em ?? null,
      finalizado_em: osRow.finalizado_em ?? null,
      destacada: osRow.destacada === true,
      destaque_motivo: osRow.destaque_motivo ?? null,
      destaque_cor: osRow.destaque_cor ?? "vermelho",
      destacada_por: osRow.destacada_por ?? null,
      destacada_em: osRow.destacada_em ?? null,
      alvo_tipo: (osRow.alvo_tipo ?? "VEICULO") as AlvoTipo,
      setor: setor ? { id: setor.id, nome: setor.nome } : null,
      cliente,
      veiculo,
      migracaoReferencia: osRow.migracao_referencia ?? null,
      cliente_snapshot: osRow.cliente_snapshot ?? null,
      veiculo_snapshot: osRow.veiculo_snapshot ?? null,
      peca,
      equipamento,
    };

    const orcamento = {
      produtos: itensProduto.map((p) => ({
        produtoid: p.produtoid,
        descricao: p.produto?.descricao ?? "Produto",
        quantidade: p.quantidade,
        precounitario: p.precounitario,
        subtotal: p.subtotal,
      })),
      produtosAvulsos: itensProdutoAvulso,
      servicos: itensServico.map((s) => ({
        servicoid: s.servicoid,
        descricao: s.servico?.descricao ?? "Serviço",
        quantidade: s.quantidade,
        precounitario: s.precounitario,
        subtotal: s.subtotal,
        realizadores: s.realizadores,
      })),
    };

    // Rentabilidade (custos, margens e transacoes da OS) so vai no payload para
    // quem tem a permissao dedicada; sem ela a aba nao e exibida no front.
    const podeVerRentabilidade = await hasOSRentabilidade();

    return NextResponse.json(
      {
        os,
        cliente: os.cliente,
        itensProduto,
        itensProdutoAvulso,
        itensServico,
        checklist,
        saida,
        aprovacoes,
        orcamento,
        resumoFinanceiro,
        ...(podeVerRentabilidade ? { transacoes, rentabilidade } : {}),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("GET /api/ordens/[id]", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao carregar OS" }, { status: 500 });
  }
}

/* =====================================================
 * PUT: atualiza campos básicos + substitui checklist (fluxo legado)
 * ===================================================== */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOSEdit();
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    const userId = session.user.id;

    const { id } = await ctx.params;
    const osId = Number(id);
    if (!osId) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

    const { data: ordemProtegida, error: ordemProtegidaError } = await supabase
      .from("ordemservico")
      .select("migracao_referencia")
      .eq("id", osId)
      .maybeSingle();
    if (ordemProtegidaError) throw ordemProtegidaError;
    if (ordemProtegida?.migracao_referencia) {
      return NextResponse.json(
        { error: "Esta OS foi migrada como histórico e é somente leitura." },
        { status: 409 },
      );
    }

    const body: any = await req.json().catch(() => ({}));

    const pickNum = (...keys: string[]) => {
      for (const k of keys) {
        if (body[k] !== undefined && body[k] !== null) {
          const n = Number(body[k]);
          return Number.isFinite(n) ? n : null;
        }
      }
      return undefined;
    };
    const pickStr = (...keys: string[]) => {
      for (const k of keys) {
        if (body[k] !== undefined) {
          const v = body[k];
          if (v === null) return null;
          const s = String(v);
          return s.length ? s : null;
        }
      }
      return undefined;
    };

    const setorid = pickNum("setorid", "setorId");
    const prioridade = pickStr("prioridade") as Prioridade | undefined;
    const descricao = pickStr("descricao");
    const observacoes = pickStr("observacoes");
    const observacoes_fiscais = pickStr("observacoes_fiscais", "observacoesFiscais");
    const alvo_tipoStr = pickStr("alvo_tipo", "alvoTipo") ?? (body?.alvo?.tipo != null ? String(body.alvo.tipo) : undefined);
    const alvo_tipo = ((): AlvoTipo | undefined => {
      const up = (alvo_tipoStr || "").toUpperCase();
      return up === "VEICULO" || up === "PECA" || up === "EQUIPAMENTO"
        ? (up as AlvoTipo)
        : undefined;
    })();
    let pecaid = pickNum("pecaid", "pecaId");
    const veiculoid =
      body?.veiculoid === null || body?.veiculoId === null || body?.alvo?.veiculoid === null
        ? null
        : body?.veiculoid !== undefined
          ? Number(body.veiculoid)
          : body?.veiculoId !== undefined
            ? Number(body.veiculoId)
            : body?.alvo?.veiculoid !== undefined
              ? Number(body.alvo.veiculoid)
              : undefined;
    const clienteid =
      body?.cliente === null
        ? null
        : body?.cliente && typeof body.cliente?.id === "number"
          ? Number(body.cliente.id)
          : undefined;

    if (typeof clienteid === "number") {
      const clienteRes = await supabase
        .from("cliente")
        .select("id")
        .eq("id", clienteid)
        .maybeSingle();

      if (clienteRes.error) throw clienteRes.error;
      if (!clienteRes.data?.id) {
        return NextResponse.json({ error: "Cliente não encontrado." }, { status: 400 });
      }
    }

    if (typeof veiculoid === "number") {
      if (!Number.isFinite(veiculoid)) {
        return NextResponse.json({ error: "Veículo inválido." }, { status: 400 });
      }

      const veiculoRes = await supabase
        .from("veiculo")
        .select("id")
        .eq("id", veiculoid)
        .maybeSingle();

      if (veiculoRes.error) throw veiculoRes.error;
      if (!veiculoRes.data?.id) {
        return NextResponse.json({ error: "Veículo não encontrado." }, { status: 400 });
      }
    }

    const alvoEquipamento =
      body?.alvo?.tipo === "EQUIPAMENTO" ? body?.alvo?.equipamento ?? null : null;
    const equipamentoNome =
      alvo_tipo === "EQUIPAMENTO"
        ? String(alvoEquipamento?.nome ?? "").trim()
        : null;
    const equipamentoPatrimonio =
      alvo_tipo === "EQUIPAMENTO"
        ? String(alvoEquipamento?.patrimonio ?? "").trim() || null
        : null;
    const equipamentoAno =
      alvo_tipo === "EQUIPAMENTO" &&
      alvoEquipamento?.ano !== null &&
      alvoEquipamento?.ano !== undefined
        ? Number(alvoEquipamento.ano)
        : null;
    const equipamentoHorimetro =
      alvo_tipo === "EQUIPAMENTO" &&
      alvoEquipamento?.horimetro !== null &&
      alvoEquipamento?.horimetro !== undefined
        ? Number(alvoEquipamento.horimetro)
        : null;

    if (alvo_tipo === "EQUIPAMENTO") {
      if (!equipamentoNome) {
        return NextResponse.json({ error: "Informe o nome do equipamento." }, { status: 400 });
      }
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
    }

    if (alvo_tipo === "PECA" && pecaid == null) {
      const atual = await supabase
        .from("ordemservico")
        .select("pecaid")
        .eq("id", osId)
        .maybeSingle();
      if (atual.error) throw atual.error;
      pecaid = atual.data?.pecaid ?? null;

      if (pecaid == null) {
        const alvoPecaNovo = body?.alvo?.peca ?? null;
        const nome = String(alvoPecaNovo?.nome ?? "").trim();
        if (!nome) {
          return NextResponse.json({ error: "Informe o nome da peça." }, { status: 400 });
        }
        const novaPeca = await supabase
          .from("peca")
          .insert({
            clienteid: clienteid ?? null,
            veiculoid: null,
            titulo: nome,
            descricao: String(alvoPecaNovo?.descricao ?? "").trim() || null,
            lacre: String(alvoPecaNovo?.lacre ?? "").trim() || null,
          })
          .select("id")
          .single();
        if (novaPeca.error) throw novaPeca.error;
        pecaid = Number(novaPeca.data.id);
      }
    }

    const patch: Record<string, unknown> = {};
    if (clienteid !== undefined) patch.clienteid = clienteid;
    if (setorid !== undefined) patch.setorid = setorid;
    if (prioridade !== undefined) patch.prioridade = prioridade || "NORMAL";
    if (descricao !== undefined) patch.descricao = descricao;
    if (observacoes !== undefined) patch.observacoes = observacoes;
    if (observacoes_fiscais !== undefined) patch.observacoes_fiscais = observacoes_fiscais;
    if (alvo_tipo !== undefined) patch.alvo_tipo = alvo_tipo;
    if (pecaid !== undefined) patch.pecaid = pecaid;
    if (veiculoid !== undefined) patch.veiculoid = veiculoid;
    if (alvo_tipo === "VEICULO") {
      patch.pecaid = null;
      patch.equipamento_nome = null;
      patch.equipamento_patrimonio = null;
      patch.equipamento_ano = null;
      patch.equipamento_horimetro = null;
    }
    if (alvo_tipo === "PECA") {
      patch.veiculoid = null;
      patch.equipamento_nome = null;
      patch.equipamento_patrimonio = null;
      patch.equipamento_ano = null;
      patch.equipamento_horimetro = null;
    }
    if (alvo_tipo === "EQUIPAMENTO") {
      patch.veiculoid = null;
      patch.pecaid = null;
      patch.equipamento_nome = equipamentoNome;
      patch.equipamento_patrimonio = equipamentoPatrimonio;
      patch.equipamento_ano = equipamentoAno;
      patch.equipamento_horimetro = equipamentoHorimetro;
    }

    if (Object.keys(patch).length) {
      const upd_res = await supabase.from("ordemservico").update(patch).eq("id", osId);
      if (upd_res.error) throw upd_res.error;
    }

    // Atualiza dados da peça (nome/descrição/lacre) quando alvo é PECA
    // buscamos a OS atual para recuperar pecaid quando preciso
    const currentOsRes = await supabase.from("ordemservico").select("pecaid").eq("id", osId).maybeSingle();
    if (currentOsRes.error) throw currentOsRes.error;
    const currentOs = currentOsRes.data as { pecaid?: number | null } | null;

    const alvoPeca = body?.alvo?.tipo === "PECA" ? body?.alvo?.peca ?? null : null;
    const pecaVinculadaId = pecaid ?? currentOs?.pecaid ?? null;

    if (pecaVinculadaId) {
      const pecaPatch: Record<string, any> = {};

      if (alvoPeca !== null) {
        if (alvoPeca.nome !== undefined) pecaPatch.titulo = alvoPeca.nome?.trim() || null;
        if (alvoPeca.descricao !== undefined) pecaPatch.descricao = alvoPeca.descricao ?? null;
        if (alvoPeca.lacre !== undefined) pecaPatch.lacre = alvoPeca.lacre ?? null;
      }

      // A peca pertence ao dono da OS: se o cliente da ordem muda (inclusive quando
      // uma OS aberta sem cliente passa a ter um), a peca acompanha. Fica fora do
      // bloco acima porque o cliente pode ser alterado sem reenviar os dados da peca.
      if (clienteid !== undefined) pecaPatch.clienteid = clienteid;

      if (Object.keys(pecaPatch).length) {
        const updPeca = await supabase.from("peca").update(pecaPatch).eq("id", pecaVinculadaId);
        if (updPeca.error) throw updPeca.error;
      }
    }

    // Substituição do checklist (fluxo legado)
    if (Array.isArray(body.checklist)) {
      const antigos_res = await supabase.from("checklist").select("id").eq("ordemservicoid", osId);
      if (antigos_res.error) throw antigos_res.error;

      const ids = (antigos_res.data ?? []).map((r: any) => r.id as number);
      if (ids.length) {
        const delImgs_res = await supabase.from("imagemvistoria").delete().in("checklistid", ids);
        if (delImgs_res.error) throw delImgs_res.error;
      }

      const delCk_res = await supabase.from("checklist").delete().eq("ordemservicoid", osId);
      if (delCk_res.error) throw delCk_res.error;

      for (const it of body.checklist) {
        const ins_res = await supabase
          .from("checklist")
          .insert({
            ordemservicoid: osId,
            item: String(it?.item || "").slice(0, 255),
            status: sanitizeCkStatus(it?.status),
            observacao: it?.observacao ?? null,
            created_by: userId, // <-- importante pro NOT NULL
          })
          .select("id")
          .single();

        if (ins_res.error) throw ins_res.error;

        const checklistid = ins_res.data.id as number;
        const imagens = Array.isArray(it?.imagens) ? it.imagens : [];
        const imgs = imagens
          .map((img: any) => ({
            checklistid,
            url: String(img?.url || "").trim(),
            descricao: img?.descricao ?? null,
          }))
          .filter((x: any) => x.url.length > 0);

        if (imgs.length) {
          const insImgs_res = await supabase.from("imagemvistoria").insert(imgs);
          if (insImgs_res.error) throw insImgs_res.error;
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("PUT /api/ordens/[id]", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao salvar OS" }, { status: 500 });
  }
}
