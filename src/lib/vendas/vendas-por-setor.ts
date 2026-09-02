import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";
import { calcularBaseLiquidaDosItens } from "@/lib/ordens/totais";

/**
 * Vendas realizadas, agrupadas por setor e vendedor.
 *
 * Esta era a mesma consulta escrita duas vezes — uma na exportação em xlsx
 * (`api/users/export/vendas-setor`) e outra na folha de impressão
 * (`print/relatorios/vendas-setor`) —, e as duas cópias carregavam os mesmos
 * defeitos. Agora as duas leem daqui: o papel e a planilha não têm como
 * divergir, e um conserto vale para os dois.
 *
 * O que estava errado nas cópias, e que o módulo corrige:
 *
 * - **O período era filtrado em memória.** A consulta trazia todas as vendas e
 *   o JS descartava as de fora do recorte. Sem `.range()` nem `.order()`, o
 *   PostgREST devolve no máximo mil linhas numa ordem que ninguém definiu:
 *   passando disso, o relatório perderia vendas em silêncio, e as perdidas nem
 *   seriam as mais antigas — seriam as que o banco resolvesse não mandar. Aqui
 *   a data vai no SQL e a leitura é paginada.
 *
 * - **O filtro de setor também era em memória**, sobre aquele mesmo bolo. Como
 *   o setor mora no usuário e não na venda, ele agora vira uma lista de
 *   vendedores resolvida antes, e entra na consulta como `in("vendedor", ...)`.
 *
 * - **Faltavam status.** Só `PAGO` e `FINALIZADA` entravam, e a venda em
 *   `PAGAMENTO` — que o banco reconhece como receita — ficava de fora.
 */

/**
 * Os status em que a venda já é receita.
 *
 * É a mesma lista de `public.venda_reconhece_receita`, a função que a DRE usa;
 * o comentário dela no SQL diz, com todas as letras, que centraliza a regra
 * "para a DRE e qualquer relatorio futuro". Divergir dela é o que fazia este
 * relatório fechar abaixo da DRE sem explicação.
 */
export const STATUS_VENDA_REALIZADA = ["PAGAMENTO", "PAGO", "AUTORIZADO", "FINALIZADA"] as const;

const LOCAL_OFFSET = "-03:00";
const TIMEZONE = "America/Fortaleza";

const ID_SEM_SETOR = "SEM_SETOR";
const ID_SEM_VENDEDOR = "SEM_VENDEDOR";

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00${LOCAL_OFFSET}`).toISOString();
}

function nextDay(value: string) {
  return new Date(new Date(`${value}T00:00:00${LOCAL_OFFSET}`).getTime() + 86_400_000).toISOString();
}

/** Data no fuso da oficina — não no fuso de quem hospeda o servidor. */
function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function toNum(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** O Supabase devolve a junção ora como objeto, ora como lista de um. */
function juncao(valor: unknown): any {
  return Array.isArray(valor) ? valor[0] ?? null : valor ?? null;
}

export type VendaDoSetor = {
  vendaId: number;
  cliente: string;
  dataVenda: string;
  status: string;
  valorTotal: number;
  valorFrete: number;
  /** `valorTotal` menos o frete — o que de fato comissiona. */
  baseComissao: number;
  percentualComissao: number;
  valorComissao: number;
};

export type VendedorDoSetor = {
  userId: string;
  nome: string;
  itens: VendaDoSetor[];
  subtotalVenda: number;
  subtotalComissao: number;
};

export type SetorComVendas = {
  setorId: string;
  nome: string;
  vendedores: VendedorDoSetor[];
  totalVenda: number;
  totalComissao: number;
};

export type RelatorioVendasPorSetor = {
  setores: SetorComVendas[];
  totalVenda: number;
  totalComissao: number;
  quantidadeDeVendas: number;
};

export type FiltroVendasPorSetor = {
  inicio?: string;
  fim?: string;
  /** Id do setor; vazio ou "all" traz todos. */
  setor?: string;
};

/**
 * Vendedores de um setor, para o filtro entrar na consulta em vez de sobrar
 * para o JS. Devolve nulo quando não há filtro de setor.
 */
async function vendedoresDoSetor(setor: string) {
  if (!setor || setor === "all") return null;

  // O grupo que o relatório imprime para quem não tem setor vinculado.
  if (setor === ID_SEM_SETOR) {
    const { data, error } = await supabaseAdmin.from("usuario").select("id").is("setorid", null);
    if (error) throw error;
    return (data ?? []).map((usuario: any) => String(usuario.id));
  }

  // Setor desconhecido devolve lista vazia, nunca `null`: tratá-lo como "sem
  // filtro" faria um endereço inválido despejar as vendas da empresa inteira.
  const setorId = Number(setor);
  if (!Number.isInteger(setorId) || setorId <= 0) return [];

  const { data, error } = await supabaseAdmin.from("usuario").select("id").eq("setorid", setorId);
  if (error) throw error;
  return (data ?? []).map((usuario: any) => String(usuario.id));
}

export async function carregarVendasPorSetor(
  filtro: FiltroVendasPorSetor,
): Promise<RelatorioVendasPorSetor> {
  const inicio = (filtro.inicio ?? "").trim();
  const fim = (filtro.fim ?? "").trim();
  const setor = (filtro.setor ?? "").trim();

  const idsDoSetor = await vendedoresDoSetor(setor);
  // Setor sem nenhum usuário vinculado: a consulta não tem o que buscar, e um
  // `in` com lista vazia é um erro à espera de acontecer.
  if (idsDoSetor && idsDoSetor.length === 0) {
    return { setores: [], totalVenda: 0, totalComissao: 0, quantidadeDeVendas: 0 };
  }

  const vendas = await fetchAllSupabaseRows<any>(() => {
    let query = supabaseAdmin
      .from("venda")
      .select(`
        id, status, datavenda, valortotal, valor_frete, comissao_venda_percent_aplicada,
        cliente:clienteid ( id, nomerazaosocial ),
        vendedor_rel:vendedor ( id, nome, email, setorid )
      `)
      .in("status", STATUS_VENDA_REALIZADA as unknown as string[])
      .order("datavenda", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });

    // Janela semiaberta, como nos demais relatórios: `lt` do dia seguinte pega
    // o dia inteiro sem depender da hora gravada.
    if (inicio) query = query.gte("datavenda", startOfDay(inicio));
    if (fim) query = query.lt("datavenda", nextDay(fim));
    if (idsDoSetor) query = query.in("vendedor", idsDoSetor);

    return query;
  });

  const { data: setoresRows, error: setoresErro } = await supabaseAdmin.from("setor").select("id, nome");
  if (setoresErro) throw setoresErro;
  const nomeDoSetor = new Map<string, string>();
  for (const registro of setoresRows ?? []) nomeDoSetor.set(String(registro.id), registro.nome);

  const porSetor = new Map<string, SetorComVendas>();

  for (const venda of vendas) {
    const vendedor = juncao(venda.vendedor_rel);
    const userId = vendedor ? String(vendedor.id) : ID_SEM_VENDEDOR;
    const setorId = vendedor?.setorid ? String(vendedor.setorid) : ID_SEM_SETOR;

    if (!porSetor.has(setorId)) {
      porSetor.set(setorId, {
        setorId,
        nome: setorId === ID_SEM_SETOR ? "Sem Setor" : nomeDoSetor.get(setorId) || "Setor Oculto",
        vendedores: [],
        totalVenda: 0,
        totalComissao: 0,
      });
    }

    const grupoDoSetor = porSetor.get(setorId)!;
    let grupoDoVendedor = grupoDoSetor.vendedores.find((item) => item.userId === userId);
    if (!grupoDoVendedor) {
      grupoDoVendedor = {
        userId,
        nome:
          userId === ID_SEM_VENDEDOR
            ? "Sem Vendedor Vinculado"
            : vendedor?.nome || vendedor?.email || "Usuário Desconhecido",
        itens: [],
        subtotalVenda: 0,
        subtotalComissao: 0,
      };
      grupoDoSetor.vendedores.push(grupoDoVendedor);
    }

    const valorTotal = toNum(venda.valortotal);
    const valorFrete = toNum(venda.valor_frete);
    const percentualComissao = toNum(venda.comissao_venda_percent_aplicada);
    // O frete fica fora da base: é repasse de transporte, não venda de produto,
    // e comissioná-lo pagava o vendedor por um custo que ele não gerou. A conta
    // sai de `calcularBaseLiquidaDosItens`, cujo comentário no módulo de totais
    // já dizia que essa é a base de desconto, margem e comissão — ela só não
    // estava sendo usada do lado das vendas.
    const baseComissao = calcularBaseLiquidaDosItens(valorTotal, valorFrete);
    const valorComissao = (baseComissao * percentualComissao) / 100;

    grupoDoVendedor.itens.push({
      vendaId: Number(venda.id),
      cliente: juncao(venda.cliente)?.nomerazaosocial || "Cliente Desconhecido",
      dataVenda: formatDate(venda.datavenda),
      status: String(venda.status ?? ""),
      valorTotal,
      valorFrete,
      baseComissao,
      percentualComissao,
      valorComissao,
    });

    grupoDoVendedor.subtotalVenda += valorTotal;
    grupoDoVendedor.subtotalComissao += valorComissao;
    grupoDoSetor.totalVenda += valorTotal;
    grupoDoSetor.totalComissao += valorComissao;
  }

  const setores = [...porSetor.values()].filter((item) => item.vendedores.length > 0);
  setores.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  setores.forEach((item) => item.vendedores.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));

  return {
    setores,
    totalVenda: setores.reduce((soma, item) => soma + item.totalVenda, 0),
    totalComissao: setores.reduce((soma, item) => soma + item.totalComissao, 0),
    quantidadeDeVendas: vendas.length,
  };
}
