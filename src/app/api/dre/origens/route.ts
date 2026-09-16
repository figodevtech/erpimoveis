export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { carregarVisaoDeContas, contasDasTransacoes } from "../_planos";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

type Registro = Record<string, unknown>;

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v: unknown) => (v == null ? null : String(v));

/**
 * Rótulo das origens automáticas.
 *
 * A chave é `origem:natureza`, como o mapeamento guarda. "PRODUTO:RECEITA"
 * descreve o registro; aqui fica o que a pessoa lê. Chave desconhecida não some
 * da lista: aparece com a própria chave, porque valor chegando por um caminho
 * que a tela não conhece é exatamente o que precisa ser visto.
 */
const AUTOMATICAS: Record<string, { rotulo: string; detalhe: string }> = {
  "PRODUTO:RECEITA": {
    rotulo: "Peças e produtos vendidos",
    detalhe: "Itens de ordem de serviço e de venda, pelo preço de tabela.",
  },
  "SERVICO:RECEITA": {
    rotulo: "Serviços prestados",
    detalhe: "Serviços da ordem de serviço, pelo preço de tabela.",
  },
  "FRETE:RECEITA": {
    rotulo: "Frete cobrado do cliente",
    detalhe: "Frete lançado na ordem de serviço ou na venda.",
  },
  "DESCONTO:DESPESA": {
    rotulo: "Descontos concedidos",
    detalhe: "Desconto dado no documento, registrado separado da receita.",
  },
  "PRODUTO:DESPESA": {
    rotulo: "Custo das peças e produtos",
    detalhe: "Custo congelado no momento em que o item saiu do estoque.",
  },
  "SERVICO:DESPESA": {
    rotulo: "Custo de serviço da OS",
    detalhe: "Despesa lançada dentro da ordem de serviço e ligada a um serviço.",
  },
  "CONSUMO:DESPESA": {
    rotulo: "Material de uso e consumo",
    detalhe: "Material aplicado na ordem de serviço pelo uso e consumo.",
  },
  "COMISSAO:DESPESA": {
    rotulo: "Comissões",
    detalhe: "Comissão dos realizadores da OS e dos vendedores.",
  },
  "FRETE:DESPESA": {
    rotulo: "Frete pago",
    detalhe: "Frete que a oficina pagou no documento.",
  },
  "ENTRADA_FISCAL:DESPESA": {
    rotulo: "Tributos da nota de entrada",
    detalhe: "Tributo da compra que a política atual leva ao resultado do mês.",
  },
  "ENTRADA_FISCAL:RECEITA": {
    rotulo: "Recuperações da nota de entrada",
    detalhe: "Crédito ou desoneração da compra, que abate o custo.",
  },
};

/** Linha clicada mais toda a subárvore: um grupo mostra o que cai nos filhos. */
async function descendentes(templateId: number, linhaId: number) {
  const { data, error } = await supabaseAdmin
    .from("dre_linha")
    .select("id, codigo, parent_id")
    .eq("template_id", templateId)
    .eq("ativo", true);

  if (error) throw error;

  const linhas = (data ?? []) as Registro[];
  const filhosDe = new Map<number, number[]>();
  for (const row of linhas) {
    const pai = row.parent_id == null ? null : Number(row.parent_id);
    if (pai == null) continue;
    filhosDe.set(pai, [...(filhosDe.get(pai) ?? []), Number(row.id)]);
  }

  const ids: number[] = [];
  const pilha = [linhaId];
  while (pilha.length) {
    const atual = pilha.pop()!;
    ids.push(atual);
    pilha.push(...(filhosDe.get(atual) ?? []));
  }

  const codigoPorId = new Map(linhas.map((row) => [Number(row.id), texto(row.codigo)]));
  const codigos = new Set(ids.map((id) => codigoPorId.get(id)).filter((codigo): codigo is string => !!codigo));

  return { ids, codigos };
}

/**
 * GET /api/dre/origens?linha=&de=&ate=
 *
 * O que ALIMENTA uma linha — não os lançamentos dela. São duas fontes:
 *
 * - planos de conta cujo destino é a linha (ou uma linha filha, quando se clica
 *   num grupo). Aparecem mesmo sem movimento no período: a pergunta "o que cai
 *   aqui" é de cadastro, não de mês;
 * - origens automáticas, que vêm do documento (OS, venda, entrada fiscal) e não
 *   passam por plano de conta.
 *
 * O movimento do período acompanha cada fonte, para a lista sair na ordem do que
 * pesa — e para quem abre saber o que mexer primeiro.
 */
export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();

    const { searchParams } = new URL(req.url);
    const de = (searchParams.get("de") ?? "").trim();
    const ate = (searchParams.get("ate") ?? "").trim();
    const linhaId = Number(searchParams.get("linha"));

    if (!DATA_ISO.test(de) || !DATA_ISO.test(ate) || !Number.isFinite(linhaId)) {
      return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
    }

    const { data: linha, error: erroLinha } = await supabaseAdmin
      .from("dre_linha")
      .select("id, template_id, codigo, nome, tipo")
      .eq("id", linhaId)
      .maybeSingle();

    if (erroLinha) throw erroLinha;
    if (!linha) return NextResponse.json({ error: "Linha não encontrada." }, { status: 404 });

    const registro = linha as Registro;
    const templateId = Number(registro.template_id);
    const cabecalho = {
      id: linhaId,
      codigo: texto(registro.codigo),
      nome: texto(registro.nome),
      calculada: String(registro.tipo) === "FORMULA",
    };

    // Linha de fórmula não tem fonte própria: ela combina o resultado de outras.
    if (cabecalho.calculada) {
      return NextResponse.json(
        { linha: cabecalho, contas: [], automaticas: [], periodo: { de, ate } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { ids, codigos } = await descendentes(templateId, linhaId);

    // ------------------------------------------------- movimento do período
    const { data: lancamentos, error: erroLancamentos } = await supabaseAdmin.rpc("dre_lancamentos_por_linha", {
      p_template_id: templateId,
      p_linha_ids: ids,
      p_de: `${de}T00:00:00.000Z`,
      p_ate: `${ate}T23:59:59.999Z`,
    });
    if (erroLancamentos) throw erroLancamentos;

    const rows = (lancamentos ?? []) as Registro[];
    const transacoes = rows
      .filter((row) => texto(row.source_type) === "TRANSACAO" && row.source_id != null)
      .map((row) => Number(row.source_id));
    const contaDaTransacao = await contasDasTransacoes([...new Set(transacoes)]);

    type Movimento = { quantidade: number; valor: number };
    const somar = (mapa: Map<string | number, Movimento>, chave: string | number, valor: number) => {
      const atual = mapa.get(chave) ?? { quantidade: 0, valor: 0 };
      mapa.set(chave, { quantidade: atual.quantidade + 1, valor: atual.valor + valor });
    };

    const movimentoDaConta = new Map<string | number, Movimento>();
    const movimentoAutomatico = new Map<string | number, Movimento>();

    for (const row of rows) {
      const conta =
        texto(row.source_type) === "TRANSACAO" && row.source_id != null
          ? contaDaTransacao.get(Number(row.source_id))
          : undefined;

      if (conta != null) somar(movimentoDaConta, conta, num(row.valor));
      else somar(movimentoAutomatico, `${texto(row.origem) ?? "?"}:${texto(row.natureza) ?? "?"}`, num(row.valor));
    }

    // --------------------------------------------------- contas do cadastro
    const visao = await carregarVisaoDeContas();
    const contas = visao
      .filter((conta) => !!conta.linha_codigo && codigos.has(conta.linha_codigo))
      .map((conta) => {
        const movimento = movimentoDaConta.get(Number(conta.conta_id));
        return {
          id: Number(conta.conta_id),
          codigo: conta.conta_codigo ?? null,
          nome: conta.conta_nome,
          grupo: conta.grupo_nome,
          ativo: Boolean(conta.conta_ativo),
          doSistema: conta.conta_origem === "SISTEMA",
          linhaPropria: Boolean(conta.classificacao_especifica),
          classificacao: conta.classificacao_nome ?? null,
          linhaCodigo: conta.linha_codigo ?? null,
          linhaNome: conta.linha_nome ?? null,
          quantidade: movimento?.quantidade ?? 0,
          valor: Number((movimento?.valor ?? 0).toFixed(2)),
          transacoes: Number(conta.transacoes ?? 0),
        };
      })
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor) || a.nome.localeCompare(b.nome, "pt-BR"));

    // ------------------------------------------------- origens automáticas
    const { data: mapeamentos, error: erroMapeamentos } = await supabaseAdmin
      .from("dre_mapeamento")
      .select("origem_valor")
      .eq("origem_tipo", "EVENTO_ORIGEM")
      .eq("ativo", true)
      .in("linha_id", ids);
    if (erroMapeamentos) throw erroMapeamentos;

    const declaradas = new Set(
      ((mapeamentos ?? []) as Registro[]).map((row) => texto(row.origem_valor)).filter((c): c is string => !!c),
    );
    // Declaradas no mapeamento (mesmo sem movimento) mais as que apareceram sem
    // mapeamento nenhum — caminho que a tela não conhece, e que precisa ser visto.
    const chaves = new Set<string>([...declaradas, ...[...movimentoAutomatico.keys()].map(String)]);

    const automaticas = [...chaves]
      .map((chave) => {
        const movimento = movimentoAutomatico.get(chave);
        return {
          chave,
          rotulo: AUTOMATICAS[chave]?.rotulo ?? chave,
          detalhe: AUTOMATICAS[chave]?.detalhe ?? "Origem automática sem descrição própria nesta tela.",
          declarada: declaradas.has(chave),
          quantidade: movimento?.quantidade ?? 0,
          valor: Number((movimento?.valor ?? 0).toFixed(2)),
        };
      })
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor) || a.rotulo.localeCompare(b.rotulo, "pt-BR"));

    return NextResponse.json(
      { linha: cabecalho, contas, automaticas, periodo: { de, ate } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Erro ao carregar as origens da linha";
    console.error("[GET /api/dre/origens]", e);
    return NextResponse.json({ error: mensagem }, { status: /forbidden|permiss/i.test(mensagem) ? 403 : 500 });
  }
}
