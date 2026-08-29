import { NextRequest, NextResponse } from "next/server";

import { requireOSAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DadosAuditoria = Record<string, unknown> | null;

type EventoAuditoria = {
  id: number;
  ocorrido_em: string;
  operacao: "INSERT" | "UPDATE" | "DELETE";
  tabela: string;
  registro_id: string | null;
  usuario_id: string | null;
  ator_nome: string | null;
  dados_anteriores: DadosAuditoria;
  dados_novos: DadosAuditoria;
  campos_alterados: string[];
  transacao_id: number;
  origem: "usuario" | "cliente";
  usuario: { id: string; nome: string | null; email: string | null } | null;
};

type ItemResumo = {
  id: string;
  ocorridoEm: string;
  tipo:
    | "criacao"
    | "status"
    | "orcamento"
    | "checklist"
    | "atribuicao"
    | "execucao"
    | "aprovacao"
    | "anexo"
    | "estoque"
    | "saida"
    | "financeiro"
    | "destaque"
    | "dados";
  titulo: string;
  detalhe: string | null;
  usuario: { id: string | null; nome: string };
};

const TABELAS_FILHAS = [
  "checklist",
  "osproduto",
  "osservico",
  "osservico_realizador",
  "osanexo",
  "osaprovacao",
  "osproduto_baixa",
  "eventos_financeiros",
];

const STATUS_LABELS: Record<string, string> = {
  ORCAMENTO: "Orçamento",
  APROVACAO_ORCAMENTO: "Aprovação do orçamento",
  ORCAMENTO_APROVADO: "Orçamento aprovado",
  ORCAMENTO_RECUSADO: "Orçamento recusado",
  AGUARDANDO_CHECKLIST: "Aguardando checklist",
  EM_ANDAMENTO: "Em andamento",
  PAGAMENTO: "Pagamento",
  SEM_COBRANCA: "Sem cobrança",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

function textoStatus(valor: unknown) {
  const status = String(valor ?? "").toUpperCase();
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function dataHoraAuditoria(valorData: unknown) {
  const data = new Date(String(valorData ?? ""));
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
}

const CAMPOS_ORDEM_LABEL: Record<string, string> = {
  descricao: "descrição",
  observacoes: "observações internas",
  observacoes_fiscais: "observações fiscais",
  prioridade: "prioridade",
  setorid: "setor",
  clienteid: "cliente",
  veiculoid: "veículo",
  garantia: "garantia",
  forma_pagamento: "forma de pagamento",
  parcelas_pagamento: "parcelas",
  descricao_financeiro: "descrição financeira",
};

function valor(dados: DadosAuditoria, campo: string) {
  return dados?.[campo];
}

function ator(evento: EventoAuditoria) {
  return {
    id: evento.usuario_id,
    nome:
      evento.usuario?.nome?.trim() ||
      evento.usuario?.email?.trim() ||
      evento.ator_nome?.trim() ||
      "Usuário não identificado",
  };
}

function documentoMascarado(valorAtual: unknown) {
  const documento = String(valorAtual ?? "").replace(/\D/g, "");
  if (documento.length === 11) return `***.***.***-${documento.slice(-2)}`;
  if (documento.length === 14) return `**.***.***/****-${documento.slice(-2)}`;
  return documento ? `final ${documento.slice(-2)}` : null;
}

function mesmoId(valorAtual: unknown, osId: number) {
  return valorAtual !== null && valorAtual !== undefined && String(valorAtual) === String(osId);
}

function idReferenciado(evento: EventoAuditoria, campo: string) {
  return valor(evento.dados_novos, campo) ?? valor(evento.dados_anteriores, campo);
}

function nomeReferencia(mapa: Map<string, string>, id: unknown, fallback: string) {
  if (id === null || id === undefined) return fallback;
  return mapa.get(String(id)) ?? fallback;
}

function numeroFormatado(valorAtual: unknown) {
  const numero = Number(valorAtual);
  if (!Number.isFinite(numero)) return String(valorAtual ?? "não informado");
  return numero.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function moedaFormatada(valorAtual: unknown) {
  const numero = Number(valorAtual);
  if (!Number.isFinite(numero)) return String(valorAtual ?? "não informado");
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function descontoFormatado(dados: DadosAuditoria) {
  const desconto = Number(valor(dados, "desconto") ?? 0);
  if (!Number.isFinite(desconto) || desconto <= 0) return "sem desconto";
  return String(valor(dados, "desconto_tipo") ?? "").toUpperCase() === "PORCENTAGEM"
    ? `${numeroFormatado(desconto)}%`
    : moedaFormatada(desconto);
}

function numeroSeguro(valorAtual: unknown) {
  const numero = Number(valorAtual);
  return Number.isFinite(numero) ? numero : 0;
}

function resumoPrecoEDesconto(dados: DadosAuditoria, precoCadastrado?: number) {
  const quantidade = numeroSeguro(valor(dados, "quantidade"));
  const precoUsado = numeroSeguro(valor(dados, "precounitario"));
  const subtotalBruto = quantidade * precoUsado;
  const desconto = numeroSeguro(valor(dados, "desconto"));
  const descontoTipo = String(valor(dados, "desconto_tipo") ?? "").toUpperCase();
  const descontoAplicado =
    descontoTipo === "PORCENTAGEM"
      ? subtotalBruto * (Math.min(Math.max(desconto, 0), 100) / 100)
      : descontoTipo === "FIXO"
        ? Math.min(Math.max(desconto, 0), Math.max(subtotalBruto, 0))
        : 0;
  const partes = [
    `quantidade ${numeroFormatado(quantidade)}`,
    precoCadastrado !== undefined
      ? `valor cadastrado ${moedaFormatada(precoCadastrado)}`
      : null,
    `valor usado ${moedaFormatada(precoUsado)}`,
  ].filter((parte): parte is string => Boolean(parte));

  if (precoCadastrado !== undefined && Math.abs(precoUsado - precoCadastrado) >= 0.01) {
    const diferenca = precoUsado - precoCadastrado;
    const percentual =
      precoCadastrado > 0
        ? ` (${numeroFormatado(Math.abs((diferenca / precoCadastrado) * 100))}%)`
        : "";
    partes.push(
      diferenca < 0
        ? `redução sobre o valor cadastrado ${moedaFormatada(Math.abs(diferenca))}${percentual}`
        : `acréscimo sobre o valor cadastrado ${moedaFormatada(diferenca)}${percentual}`,
    );
  }

  if (desconto > 0 && descontoTipo) {
    partes.push(
      `desconto preenchido ${descontoFormatado(dados)} (${moedaFormatada(descontoAplicado)} aplicado no item)`,
    );
  } else {
    partes.push("sem desconto preenchido");
  }
  partes.push(`total ${moedaFormatada(valor(dados, "subtotal"))}`);
  return partes.join("; ");
}

function mudou(anterior: DadosAuditoria, novo: DadosAuditoria, campo: string) {
  return JSON.stringify(valor(anterior, campo) ?? null) !== JSON.stringify(valor(novo, campo) ?? null);
}

function detalheAlteracaoOrcamento(
  evento: EventoAuditoria,
  nomesProdutos: Map<string, string>,
  nomesServicos: Map<string, string>,
  precosProdutos: Map<string, number>,
  precosServicos: Map<string, number>,
) {
  const anterior = evento.dados_anteriores;
  const novo = evento.dados_novos;
  const produto = evento.tabela === "osproduto";
  const tipoItem = produto ? "Produto" : "Serviço";
  const id = idReferenciado(evento, produto ? "produtoid" : "servicoid");
  const nome = nomeReferencia(
    produto ? nomesProdutos : nomesServicos,
    id,
    `${tipoItem.toLocaleLowerCase("pt-BR")} #${id ?? "não identificado"}`,
  );
  const precoCadastrado = (produto ? precosProdutos : precosServicos).get(String(id));
  const dados = novo ?? anterior;

  if (evento.operacao === "INSERT") {
    return `Adicionou ${tipoItem.toLocaleLowerCase("pt-BR")} “${nome}”: ${resumoPrecoEDesconto(dados, precoCadastrado)}`;
  }

  if (evento.operacao === "DELETE") {
    return `Removeu ${tipoItem.toLocaleLowerCase("pt-BR")} “${nome}” do orçamento`;
  }

  const alteracoes: string[] = [];
  if (mudou(anterior, novo, "quantidade")) {
    alteracoes.push(
      `quantidade ${numeroFormatado(valor(anterior, "quantidade"))} → ${numeroFormatado(valor(novo, "quantidade"))}`,
    );
  }
  if (mudou(anterior, novo, "precounitario")) {
    alteracoes.push(
      `valor unitário ${moedaFormatada(valor(anterior, "precounitario"))} → ${moedaFormatada(valor(novo, "precounitario"))}`,
    );
  }
  if (mudou(anterior, novo, "desconto") || mudou(anterior, novo, "desconto_tipo")) {
    alteracoes.push(`desconto ${descontoFormatado(anterior)} → ${descontoFormatado(novo)}`);
  }
  if (
    mudou(anterior, novo, "subtotal") &&
    !mudou(anterior, novo, "quantidade") &&
    !mudou(anterior, novo, "precounitario") &&
    !mudou(anterior, novo, "desconto") &&
    !mudou(anterior, novo, "desconto_tipo")
  ) {
    alteracoes.push(
      `total ${moedaFormatada(valor(anterior, "subtotal"))} → ${moedaFormatada(valor(novo, "subtotal"))}`,
    );
  }

  const resumoAtual =
    mudou(anterior, novo, "precounitario") ||
    mudou(anterior, novo, "quantidade") ||
    mudou(anterior, novo, "desconto") ||
    mudou(anterior, novo, "desconto_tipo")
      ? `Após a alteração: ${resumoPrecoEDesconto(novo, precoCadastrado)}`
      : null;

  return `Alterou ${tipoItem.toLocaleLowerCase("pt-BR")} “${nome}”: ${[
    alteracoes.join("; ") || "dados do item atualizados",
    resumoAtual,
  ].filter(Boolean).join(" • ")}`;
}

function detalheCondicoesOrcamento(evento: EventoAuditoria) {
  const anterior = evento.dados_anteriores;
  const novo = evento.dados_novos;
  const alteracoes: string[] = [];

  if (mudou(anterior, novo, "desconto") || mudou(anterior, novo, "desconto_tipo")) {
    alteracoes.push(`desconto geral ${descontoFormatado(anterior)} → ${descontoFormatado(novo)}`);
  }
  if (mudou(anterior, novo, "valor_frete")) {
    alteracoes.push(
      `frete ${moedaFormatada(valor(anterior, "valor_frete"))} → ${moedaFormatada(valor(novo, "valor_frete"))}`,
    );
  }
  if (
    mudou(anterior, novo, "acrescimo_financeiro_valor") ||
    mudou(anterior, novo, "acrescimo_financeiro_tipo")
  ) {
    const formatarAcrescimo = (dados: DadosAuditoria) => {
      const acrescimo = Number(valor(dados, "acrescimo_financeiro_valor") ?? 0);
      if (!Number.isFinite(acrescimo) || acrescimo <= 0) return "sem acréscimo";
      return String(valor(dados, "acrescimo_financeiro_tipo") ?? "").toUpperCase() === "PORCENTAGEM"
        ? `${numeroFormatado(acrescimo)}%`
        : moedaFormatada(acrescimo);
    };
    alteracoes.push(`acréscimo financeiro ${formatarAcrescimo(anterior)} → ${formatarAcrescimo(novo)}`);
  }
  if (mudou(anterior, novo, "forma_pagamento")) {
    alteracoes.push(
      `forma de pagamento ${String(valor(anterior, "forma_pagamento") || "não informada")} → ${String(valor(novo, "forma_pagamento") || "não informada")}`,
    );
  }
  if (mudou(anterior, novo, "parcelas_pagamento")) {
    alteracoes.push(
      `parcelas ${numeroFormatado(valor(anterior, "parcelas_pagamento") ?? 0)} → ${numeroFormatado(valor(novo, "parcelas_pagamento") ?? 0)}`,
    );
  }
  if (mudou(anterior, novo, "pagamentos_previstos")) {
    alteracoes.push("alterou o planejamento dos pagamentos");
  }
  if (mudou(anterior, novo, "descricao_financeiro")) {
    alteracoes.push("alterou a descrição para o financeiro");
  }
  if (mudou(anterior, novo, "garantia")) {
    alteracoes.push("alterou as condições de garantia");
  }
  if (
    mudou(anterior, novo, "orcamentototal") &&
    !mudou(anterior, novo, "desconto") &&
    !mudou(anterior, novo, "desconto_tipo") &&
    !mudou(anterior, novo, "valor_frete") &&
    !mudou(anterior, novo, "acrescimo_financeiro_valor") &&
    !mudou(anterior, novo, "acrescimo_financeiro_tipo")
  ) {
    alteracoes.push(
      `total do orçamento ${moedaFormatada(valor(anterior, "orcamentototal"))} → ${moedaFormatada(valor(novo, "orcamentototal"))}`,
    );
  }

  return alteracoes;
}

function chaveAgrupamento(evento: EventoAuditoria, tipo: ItemResumo["tipo"]) {
  return `${evento.transacao_id}:${evento.usuario_id ?? "sem-usuario"}:${tipo}`;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireOSAccess();

    const { id } = await context.params;
    const osId = Number(id);
    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const select =
      "id, ocorrido_em, operacao, tabela, registro_id, usuario_id, ator_nome, dados_anteriores, dados_novos, campos_alterados, transacao_id, origem, usuario:usuario_id ( id, nome, email )";

    const [checklistsAtuais, aprovacoesAtuais, anexosAtuais, eventosFinanceirosAtuais] = await Promise.all([
      supabaseAdmin.from("checklist").select("id").eq("ordemservicoid", osId),
      supabaseAdmin.from("osaprovacao").select("id").eq("ordemservicoid", osId),
      supabaseAdmin.from("osanexo").select("id").eq("ordemservicoid", osId),
      supabaseAdmin
        .from("eventos_financeiros")
        .select("id, origem, natureza, descricao, detalhe, valor, is_manual, dados_snapshot, created_by, created_at")
        .eq("ordemservicoid", osId),
    ]);
    for (const resultado of [checklistsAtuais, aprovacoesAtuais, anexosAtuais, eventosFinanceirosAtuais]) {
      if (resultado.error) throw resultado.error;
    }
    const idsAtuaisPorTabela = new Map<string, Set<string>>([
      ["checklist", new Set((checklistsAtuais.data ?? []).map((item) => String(item.id)))],
      ["osaprovacao", new Set((aprovacoesAtuais.data ?? []).map((item) => String(item.id)))],
      ["osanexo", new Set((anexosAtuais.data ?? []).map((item) => String(item.id)))],
      ["eventos_financeiros", new Set((eventosFinanceirosAtuais.data ?? []).map((item) => String(item.id)))],
    ]);
    const eventosFinanceirosPorId = new Map(
      (eventosFinanceirosAtuais.data ?? []).map((evento) => [String(evento.id), evento]),
    );

    const consultarRegistros = (tabela: string, ids: Array<number | string>) =>
      ids.length
        ? supabaseAdmin
            .from("auditoria_evento")
            .select(select)
            .in("origem", ["usuario", "cliente"])
            .eq("tabela", tabela)
            .in("registro_id", ids.map(String))
            .order("ocorrido_em", { ascending: true })
            .limit(500)
        : Promise.resolve({ data: [], error: null });

    const saidaAtual = await supabaseAdmin.from("os_saida").select("id").eq("ordemservico_id", osId).maybeSingle();
    if (saidaAtual.error) throw saidaAtual.error;
    const itensSaidaAtuais = saidaAtual.data
      ? await supabaseAdmin.from("os_saida_checklist_item").select("id").eq("os_saida_id", saidaAtual.data.id)
      : { data: [], error: null };
    if (itensSaidaAtuais.error) throw itensSaidaAtuais.error;
    const imagensSaidaAtuais = (itensSaidaAtuais.data ?? []).length
      ? await supabaseAdmin
          .from("os_saida_checklist_imagem")
          .select("id")
          .in("checklist_item_id", (itensSaidaAtuais.data ?? []).map((item) => item.id))
      : { data: [], error: null };
    if (imagensSaidaAtuais.error) throw imagensSaidaAtuais.error;

    const [ordem, filhasNovas, filhasAnteriores, filhasPorOs, checklists, aprovacoes, anexos, auditoriaFinanceira, saidas, itensSaida, imagensSaida] =
      await Promise.all([
      supabaseAdmin
        .from("auditoria_evento")
        .select(select)
        .in("origem", ["usuario", "cliente"])
        .eq("tabela", "ordemservico")
        .eq("registro_id", String(osId))
        .order("ocorrido_em", { ascending: true })
        .limit(300),
      supabaseAdmin
        .from("auditoria_evento")
        .select(select)
        .in("origem", ["usuario", "cliente"])
        .in("tabela", TABELAS_FILHAS)
        .eq("dados_novos->ordemservicoid", osId)
        .order("ocorrido_em", { ascending: true })
        .limit(500),
      supabaseAdmin
        .from("auditoria_evento")
        .select(select)
        .in("origem", ["usuario", "cliente"])
        .in("tabela", TABELAS_FILHAS)
        .eq("dados_anteriores->ordemservicoid", osId)
        .order("ocorrido_em", { ascending: true })
        .limit(500),
      supabaseAdmin
        .from("auditoria_evento")
        .select(select)
        .in("origem", ["usuario", "cliente"])
        .in("tabela", ["osproduto", "osservico", "osservico_realizador", "osproduto_baixa"])
        .eq("registro_id", String(osId))
        .order("ocorrido_em", { ascending: true })
        .limit(500),
      consultarRegistros("checklist", (checklistsAtuais.data ?? []).map((item) => item.id)),
      consultarRegistros("osaprovacao", (aprovacoesAtuais.data ?? []).map((item) => item.id)),
      consultarRegistros("osanexo", (anexosAtuais.data ?? []).map((item) => item.id)),
      consultarRegistros("eventos_financeiros", (eventosFinanceirosAtuais.data ?? []).map((item) => item.id)),
      consultarRegistros("os_saida", saidaAtual.data ? [saidaAtual.data.id] : []),
      consultarRegistros("os_saida_checklist_item", (itensSaidaAtuais.data ?? []).map((item) => item.id)),
      consultarRegistros("os_saida_checklist_imagem", (imagensSaidaAtuais.data ?? []).map((item) => item.id)),
    ]);

    for (const resultado of [
      ordem,
      filhasNovas,
      filhasAnteriores,
      filhasPorOs,
      checklists,
      aprovacoes,
      anexos,
      auditoriaFinanceira,
      saidas,
      itensSaida,
      imagensSaida,
    ]) {
      if (resultado.error) throw resultado.error;
    }

    const eventos = Array.from(
      new Map(
        [
          ...(ordem.data ?? []),
          ...(filhasNovas.data ?? []),
          ...(filhasAnteriores.data ?? []),
          ...(filhasPorOs.data ?? []),
          ...(checklists.data ?? []),
          ...(aprovacoes.data ?? []),
          ...(anexos.data ?? []),
          ...(auditoriaFinanceira.data ?? []),
          ...(saidas.data ?? []),
          ...(itensSaida.data ?? []),
          ...(imagensSaida.data ?? []),
        ].map((evento) => [String(evento.id), evento as unknown as EventoAuditoria]),
      ).values(),
    )
      .filter((evento) => {
        if (evento.tabela === "ordemservico") return true;
        if (idsAtuaisPorTabela.get(evento.tabela)?.has(String(evento.registro_id))) {
          return true;
        }
        if (
          ["osproduto", "osservico", "osservico_realizador", "osproduto_baixa"].includes(
            evento.tabela,
          ) &&
          String(evento.registro_id) === String(osId)
        ) {
          return true;
        }
        return (
          mesmoId(valor(evento.dados_novos, "ordemservicoid"), osId) ||
          mesmoId(valor(evento.dados_anteriores, "ordemservicoid"), osId)
        );
      })
      .sort((a, b) => new Date(a.ocorrido_em).getTime() - new Date(b.ocorrido_em).getTime());

    const usuarioIds = new Set<string>();
    const servicoIds = new Set<string>();
    const produtoIds = new Set<string>();
    const clienteIds = new Set<string>();
    for (const evento of eventos) {
      const usuarioId = idReferenciado(evento, "usuarioid");
      const servicoId = idReferenciado(evento, "servicoid");
      const produtoId = idReferenciado(evento, "produtoid");
      if (usuarioId !== null && usuarioId !== undefined) usuarioIds.add(String(usuarioId));
      if (servicoId !== null && servicoId !== undefined) servicoIds.add(String(servicoId));
      if (produtoId !== null && produtoId !== undefined) produtoIds.add(String(produtoId));
      // A troca de titularidade guarda só o id: o nome vem do cadastro.
      if (evento.tabela === "ordemservico") {
        for (const dados of [evento.dados_anteriores, evento.dados_novos]) {
          const clienteId = valor(dados, "clienteid");
          if (clienteId !== null && clienteId !== undefined) clienteIds.add(String(clienteId));
        }
      }
    }
    for (const evento of eventosFinanceirosAtuais.data ?? []) {
      if (evento.created_by) usuarioIds.add(String(evento.created_by));
    }

    const [usuarios, servicos, produtos, clientes] = await Promise.all([
      usuarioIds.size
        ? supabaseAdmin.from("usuario").select("id, nome, email").in("id", Array.from(usuarioIds))
        : Promise.resolve({ data: [], error: null }),
      servicoIds.size
        ? supabaseAdmin.from("servico").select("id, descricao, codigo, precohora").in("id", Array.from(servicoIds))
        : Promise.resolve({ data: [], error: null }),
      produtoIds.size
        ? supabaseAdmin.from("produto").select("id, titulo, descricao, referencia, precovenda").in("id", Array.from(produtoIds))
        : Promise.resolve({ data: [], error: null }),
      clienteIds.size
        ? supabaseAdmin.from("cliente").select("id, nomerazaosocial").in("id", Array.from(clienteIds))
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (usuarios.error) throw usuarios.error;
    if (servicos.error) throw servicos.error;
    if (produtos.error) throw produtos.error;
    if (clientes.error) throw clientes.error;

    const nomesUsuarios = new Map<string, string>(
      (usuarios.data ?? []).map((usuario) => [
        String(usuario.id),
        String(usuario.nome || usuario.email || "Usuário"),
      ]),
    );
    const nomesServicos = new Map<string, string>(
      (servicos.data ?? []).map((servico) => [
        String(servico.id),
        String(servico.descricao || servico.codigo || `Serviço #${servico.id}`),
      ]),
    );
    const nomesProdutos = new Map<string, string>(
      (produtos.data ?? []).map((produto) => [
        String(produto.id),
        String(produto.titulo || produto.descricao || produto.referencia || `Produto #${produto.id}`),
      ]),
    );
    const nomesClientes = new Map<string, string>(
      (clientes.data ?? []).map((cliente) => [
        String(cliente.id),
        String(cliente.nomerazaosocial || `Cliente #${cliente.id}`),
      ]),
    );
    const precosProdutos = new Map<string, number>(
      (produtos.data ?? [])
        .filter((produto) => produto.precovenda !== null && Number.isFinite(Number(produto.precovenda)))
        .map((produto) => [String(produto.id), Number(produto.precovenda)]),
    );
    const precosServicos = new Map<string, number>(
      (servicos.data ?? [])
        .filter((servico) => servico.precohora !== null && Number.isFinite(Number(servico.precohora)))
        .map((servico) => [String(servico.id), Number(servico.precohora)]),
    );

    const itens: ItemResumo[] = [];
    const agrupados = new Map<string, ItemResumo>();
    const transacoesDeOrcamento = new Set(
      eventos
        .filter((evento) => evento.tabela === "osproduto" || evento.tabela === "osservico")
        .map((evento) => evento.transacao_id),
    );
    const possuiRespostaDeCliente = eventos.some(
      (evento) =>
        evento.origem === "cliente" &&
        evento.tabela === "osaprovacao" &&
        evento.operacao === "UPDATE" &&
        Boolean(valor(evento.dados_novos, "resultado")),
    );

    const adicionar = (evento: EventoAuditoria, item: Omit<ItemResumo, "id" | "ocorridoEm" | "usuario">, agrupar = false) => {
      const chave = chaveAgrupamento(evento, item.tipo);
      const existente = agrupados.get(chave);
      if (agrupar && existente) {
        if (item.detalhe && !existente.detalhe?.includes(item.detalhe)) {
          existente.detalhe = existente.detalhe ? `${existente.detalhe} • ${item.detalhe}` : item.detalhe;
        }
        return;
      }

      const completo: ItemResumo = {
        ...item,
        id: agrupar ? chave : String(evento.id),
        ocorridoEm: evento.ocorrido_em,
        usuario: ator(evento),
      };
      itens.push(completo);
      if (agrupar) agrupados.set(chave, completo);
    };

    for (const evento of eventos) {
      const anterior = evento.dados_anteriores;
      const novo = evento.dados_novos;

      if (evento.tabela === "ordemservico" && evento.operacao === "INSERT") {
        adicionar(evento, {
          tipo: "criacao",
          titulo: "Criou a OS",
          detalhe: `Status inicial: ${textoStatus(valor(novo, "status"))}`,
        });
        continue;
      }

      if (
        evento.tabela === "ordemservico"
        && evento.operacao === "UPDATE"
        && (
          evento.campos_alterados?.includes("destacada")
          || evento.campos_alterados?.includes("destaque_motivo")
        )
      ) {
        const destacada = valor(novo, "destacada") === true;
        const mudouEstado = evento.campos_alterados?.includes("destacada");
        adicionar(evento, {
          tipo: "destaque",
          titulo: destacada
            ? mudouEstado ? "Destacou a OS" : "Atualizou o destaque da OS"
            : "Removeu o destaque da OS",
          detalhe: destacada
            ? `Motivo: ${String(valor(novo, "destaque_motivo") ?? "N\u00e3o informado")}`
            : valor(anterior, "destaque_motivo")
              ? `Motivo anterior: ${String(valor(anterior, "destaque_motivo"))}`
              : null,
        });
        continue;
      }

      if (evento.tabela === "ordemservico" && evento.campos_alterados?.includes("status")) {
        if (evento.origem === "cliente" && possuiRespostaDeCliente) continue;
        const statusNovo = String(valor(novo, "status") ?? "").toUpperCase();
        const titulo =
          statusNovo === "CONCLUIDO"
            ? "Concluiu o pagamento da OS"
            : statusNovo === "SEM_COBRANCA"
              ? "Finalizou a OS sem cobrança"
              : statusNovo === "CANCELADO"
                ? "Cancelou a OS"
                : "Alterou o status da OS";
        adicionar(evento, {
          tipo: "status",
          titulo,
          detalhe: [
            `${textoStatus(valor(anterior, "status"))} → ${textoStatus(valor(novo, "status"))}`,
            ["CONCLUIDO", "SEM_COBRANCA", "CANCELADO"].includes(statusNovo) &&
            dataHoraAuditoria(valor(novo, "finalizado_em"))
              ? `Finalizada em ${dataHoraAuditoria(valor(novo, "finalizado_em"))}`
              : null,
            statusNovo === "CONCLUIDO" && dataHoraAuditoria(valor(novo, "pagamento_concluido_em"))
              ? `Pagamento concluído em ${dataHoraAuditoria(valor(novo, "pagamento_concluido_em"))}`
              : null,
          ].filter(Boolean).join(" • "),
        });
        continue;
      }

      if (evento.tabela === "ordemservico" && evento.campos_alterados?.includes("statusaprovacao")) {
        if (evento.origem === "cliente" && possuiRespostaDeCliente) continue;
        adicionar(evento, {
          tipo: "aprovacao",
          titulo: "Atualizou a aprovação do orçamento",
          detalhe: `${textoStatus(valor(anterior, "statusaprovacao"))} → ${textoStatus(valor(novo, "statusaprovacao"))}`,
        });
        continue;
      }

      if (evento.tabela === "eventos_financeiros") {
        const atual = eventosFinanceirosPorId.get(String(evento.registro_id));
        const natureza = String(
          valor(novo, "natureza") ?? valor(anterior, "natureza") ?? atual?.natureza ?? "",
        ).toUpperCase();
        const manual = Boolean(
          valor(novo, "is_manual") ?? valor(anterior, "is_manual") ?? atual?.is_manual,
        );
        if (natureza !== "DESPESA") continue;

        const origemEvento = String(
          valor(novo, "origem") ?? valor(anterior, "origem") ?? atual?.origem ?? "AVULSO",
        ).toUpperCase();
        const tipoEvento =
          origemEvento === "SERVICO"
            ? "Serviço"
            : origemEvento === "PRODUTO"
              ? "Produto"
              : origemEvento === "COMISSAO" ? "Comissão" : "Avulsa";
        const descricaoAtual = String(
          valor(novo, "descricao") ?? valor(anterior, "descricao") ?? atual?.descricao ?? "Despesa",
        );
        const valorAtual = valor(novo, "valor") ?? valor(anterior, "valor") ?? atual?.valor;

        if (evento.operacao === "INSERT" && manual) {
          adicionar(evento, {
            tipo: "financeiro",
            titulo: "Adicionou uma despesa nos eventos financeiros",
            detalhe: `${descricaoAtual} • ${moedaFormatada(valorAtual)} • Tipo: ${tipoEvento}`,
          });
          continue;
        }

        if (evento.operacao === "UPDATE" && evento.campos_alterados?.includes("status")) {
          const statusNovo = String(valor(novo, "status") ?? "").toUpperCase();
          if (statusNovo === "CONVERTIDO") {
            adicionar(evento, {
              tipo: "financeiro",
              titulo: "Lançou uma despesa no financeiro",
              detalhe: `${descricaoAtual} • ${moedaFormatada(valorAtual)} • Tipo: ${tipoEvento}`,
            });
          }
          continue;
        }

        if (evento.operacao === "UPDATE" && manual) {
          const alteracoes: string[] = [];
          if (evento.campos_alterados?.includes("descricao")) {
            alteracoes.push(
              `título “${String(valor(anterior, "descricao") ?? "")}” → “${String(valor(novo, "descricao") ?? "")}”`,
            );
          }
          if (evento.campos_alterados?.includes("detalhe")) {
            alteracoes.push(
              `descrição “${String(valor(anterior, "detalhe") ?? "sem descrição")}” → “${String(valor(novo, "detalhe") ?? "sem descrição")}”`,
            );
          }
          if (evento.campos_alterados?.includes("valor")) {
            alteracoes.push(
              `valor ${moedaFormatada(valor(anterior, "valor"))} → ${moedaFormatada(valor(novo, "valor"))}`,
            );
          }
          if (alteracoes.length) {
            adicionar(evento, {
              tipo: "financeiro",
              titulo: "Editou uma despesa dos eventos financeiros",
              detalhe: `${descricaoAtual} • ${alteracoes.join("; ")} • Tipo: ${tipoEvento}`,
            });
          }
          continue;
        }
      }

      if (evento.tabela === "osproduto" || evento.tabela === "osservico") {
        adicionar(
          evento,
          {
            tipo: "orcamento",
            titulo: "Atualizou o orçamento",
            detalhe: detalheAlteracaoOrcamento(
              evento,
              nomesProdutos,
              nomesServicos,
              precosProdutos,
              precosServicos,
            ),
          },
          true,
        );
        continue;
      }

      if (evento.tabela === "checklist") {
        adicionar(
          evento,
          {
            tipo: "checklist",
            titulo: evento.operacao === "INSERT" ? "Realizou o checklist" : "Atualizou o checklist",
            detalhe: "Registrou itens, observações ou resultados da vistoria",
          },
          true,
        );
        continue;
      }

      if (evento.tabela === "os_saida") {
        const dadosSaida = evento.operacao === "DELETE" ? anterior : novo;
        const partes = [
          dataHoraAuditoria(valor(dadosSaida, "saida_em"))
            ? `Retirada em ${dataHoraAuditoria(valor(dadosSaida, "saida_em"))}`
            : null,
          valor(dadosSaida, "retirado_por")
            ? `Retirado por: ${String(valor(dadosSaida, "retirado_por"))}`
            : "Pessoa que retirou não informada",
        ].filter(Boolean);
        adicionar(evento, {
          tipo: "saida",
          titulo: evento.operacao === "INSERT" ? "Registrou a saída da OS" : evento.operacao === "DELETE" ? "Removeu o registro de saída da OS" : "Atualizou a saída da OS",
          detalhe: partes.join(" • "),
        });
        continue;
      }

      if (evento.tabela === "os_saida_checklist_item") {
        adicionar(evento, {
          tipo: "saida",
          titulo: "Registrou o checklist de saída",
          detalhe: String(valor(novo, "titulo") ?? "Item do checklist de saída"),
        }, true);
        continue;
      }

      if (evento.tabela === "os_saida_checklist_imagem") {
        adicionar(evento, {
          tipo: "saida",
          titulo: evento.operacao === "DELETE" ? "Removeu uma imagem do checklist de saída" : "Anexou uma imagem ao checklist de saída",
          detalhe: String(valor(novo, "descricao") ?? valor(anterior, "descricao") ?? "Imagem do checklist de saída"),
        }, true);
        continue;
      }

      if (evento.tabela === "osservico_realizador") {
        const usuarioId = idReferenciado(evento, "usuarioid");
        const servicoId = idReferenciado(evento, "servicoid");
        const usuarioAtribuido = nomeReferencia(nomesUsuarios, usuarioId, "um usuário");
        const servico = nomeReferencia(nomesServicos, servicoId, "um serviço");
        const statusAnterior = String(valor(anterior, "status_execucao") ?? "").toUpperCase();
        const statusNovo = String(valor(novo, "status_execucao") ?? "").toUpperCase();

        if (evento.operacao === "UPDATE" && statusAnterior !== statusNovo && statusNovo) {
          adicionar(evento, {
            tipo: "execucao",
            titulo:
              statusNovo === "FINALIZADO"
                ? "Finalizou um serviço"
                : statusNovo === "EM_EXECUCAO"
                  ? "Iniciou um serviço"
                  : "Atualizou a execução do serviço",
            detalhe: servico,
          });
        } else {
          adicionar(
            evento,
            {
              tipo: "atribuicao",
              titulo: evento.operacao === "DELETE" ? "Removeu um responsável" : "Atribuiu um responsável",
              detalhe: `${usuarioAtribuido} · ${servico}`,
            },
            true,
          );
        }
        continue;
      }

      if (evento.tabela === "osanexo") {
        adicionar(evento, {
          tipo: "anexo",
          titulo: evento.operacao === "DELETE" ? "Removeu um anexo" : "Adicionou um anexo",
          detalhe: String(idReferenciado(evento, "nome") || "Arquivo da OS"),
        });
        continue;
      }

      if (evento.tabela === "osaprovacao") {
        if (evento.operacao === "UPDATE" && valor(novo, "resultado")) {
          const resultado = String(valor(novo, "resultado") ?? "").toUpperCase();
          const viaLink =
            evento.origem === "cliente" || String(valor(novo, "origem") ?? "").toUpperCase() === "LINK";
          const documento = documentoMascarado(valor(novo, "aprovador_doc"));
          adicionar(evento, {
            tipo: "aprovacao",
            titulo:
              resultado === "APROVADA"
                ? viaLink
                  ? "Aprovou o orçamento pelo link"
                  : "Aprovou o orçamento internamente"
                : viaLink
                  ? "Reprovou o orçamento pelo link"
                  : "Reprovou o orçamento internamente",
            detalhe: documento
              ? `Documento confirmado: ${documento}`
              : "Resposta registrada por usuário interno",
          });
          continue;
        }

        adicionar(
          evento,
          {
            tipo: "aprovacao",
            titulo: "Gerou um link de aprovação",
            detalhe: "Disponibilizou o orçamento para aprovação",
          },
          true,
        );
        continue;
      }

      if (evento.tabela === "osproduto_baixa") {
        adicionar(
          evento,
          {
            tipo: "estoque",
            titulo: "Registrou a baixa de produtos",
            detalhe: "Atualizou o consumo de estoque desta OS",
          },
          true,
        );
        continue;
      }

      if (evento.tabela === "ordemservico" && evento.operacao === "UPDATE") {
        // A gravação de datasaida é parte técnica do registro detalhado em os_saida.
        // Evita duplicar a atividade como um vago "Atualizou os dados da OS".
        if (evento.campos_alterados?.includes("datasaida")) continue;
        if (evento.campos_alterados?.includes("finalizado_em")) {
          adicionar(evento, {
            tipo: "status",
            titulo: "Registrou a finalização da OS",
            detalhe:
              dataHoraAuditoria(valor(novo, "finalizado_em")) ??
              "Data de finalização removida",
          });
          continue;
        }
        if (evento.campos_alterados?.includes("pagamento_concluido_em")) {
          adicionar(evento, {
            tipo: "status",
            titulo: "Registrou a conclusão do pagamento",
            detalhe: dataHoraAuditoria(valor(novo, "pagamento_concluido_em")),
          });
          continue;
        }
        // Troca de titularidade merece linha própria: quem paga a OS mudou, e o
        // genérico "atualizou informações" esconderia exatamente isso.
        if (mudou(anterior, novo, "clienteid")) {
          const de = nomeReferencia(
            nomesClientes,
            valor(anterior, "clienteid"),
            "sem cliente",
          );
          const para = nomeReferencia(nomesClientes, valor(novo, "clienteid"), "sem cliente");
          // Editar a OS troca o cliente junto com outros campos: eles entram no
          // mesmo item para nenhuma alteração sumir do histórico.
          const demaisCampos = (evento.campos_alterados ?? [])
            .filter((campo) => campo !== "clienteid" && campo !== "updatedat")
            .map((campo) => CAMPOS_ORDEM_LABEL[campo] ?? campo.replaceAll("_", " "));
          adicionar(evento, {
            tipo: "dados",
            titulo: "Trocou o cliente da OS",
            detalhe: demaisCampos.length
              ? `${de} → ${para} • também alterou: ${demaisCampos.join(", ")}`
              : `${de} → ${para}`,
          });
          continue;
        }
        const condicoesOrcamento = detalheCondicoesOrcamento(evento);
        if (condicoesOrcamento.length) {
          adicionar(
            evento,
            {
              tipo: "orcamento",
              titulo: "Atualizou as condições do orçamento",
              detalhe: condicoesOrcamento.join(" • "),
            },
            true,
          );
          continue;
        }
        if (transacoesDeOrcamento.has(evento.transacao_id)) continue;
        adicionar(
          evento,
          {
            tipo: "dados",
            titulo: "Atualizou informações da OS",
            detalhe: (evento.campos_alterados ?? [])
              .filter((campo) => campo !== "updatedat")
              .map((campo) => CAMPOS_ORDEM_LABEL[campo] ?? campo.replaceAll("_", " "))
              .join(", ") || null,
          },
          true,
        );
      }
    }

    // Eventos manuais criados antes desta tabela receber auditoria tambem
    // aparecem no historico. O autor e a data vêm do proprio registro, sem
    // fabricar uma alteracao que nao ocorreu.
    const despesasComCriacaoAuditada = new Set(
      eventos
        .filter((evento) => evento.tabela === "eventos_financeiros" && evento.operacao === "INSERT")
        .map((evento) => String(evento.registro_id)),
    );
    for (const evento of eventosFinanceirosAtuais.data ?? []) {
      const snapshot = evento.dados_snapshot as Record<string, unknown> | null;
      const criadoManualmente =
        evento.origem === "AVULSO"
        || snapshot?.despesa_servico_manual === true
        || snapshot?.lancamento_avulso_manual === true;
      if (
        evento.natureza !== "DESPESA"
        || !evento.is_manual
        || !criadoManualmente
        || despesasComCriacaoAuditada.has(String(evento.id))
      ) continue;

      const origemEvento = String(evento.origem ?? "AVULSO").toUpperCase();
      const tipoEvento =
        origemEvento === "SERVICO"
          ? "Serviço"
          : origemEvento === "PRODUTO"
            ? "Produto"
            : origemEvento === "COMISSAO" ? "Comissão" : "Avulsa";
      const usuarioId = evento.created_by ? String(evento.created_by) : null;
      itens.push({
        id: `evento-financeiro-${evento.id}`,
        ocorridoEm: String(evento.created_at),
        tipo: "financeiro",
        titulo: "Adicionou uma despesa nos eventos financeiros",
        detalhe: `${evento.descricao || "Despesa"} • ${moedaFormatada(evento.valor)} • Tipo: ${tipoEvento}`,
        usuario: {
          id: usuarioId,
          nome: usuarioId
            ? nomesUsuarios.get(usuarioId) ?? "Usuário não identificado"
            : "Usuário não identificado",
        },
      });
    }

    return NextResponse.json({
      itens: itens.sort(
        (a, b) => new Date(a.ocorridoEm).getTime() - new Date(b.ocorridoEm).getTime(),
      ),
      total: itens.length,
    });
  } catch (error) {
    const status = Number((error as { statusCode?: number })?.statusCode) || 500;
    console.error("[ordens/auditoria-resumo] Falha ao carregar histórico:", error);
    return NextResponse.json(
      { error: status === 403 ? "Sem permissão para visualizar esta OS." : "Não foi possível carregar o histórico da OS." },
      { status },
    );
  }
}
