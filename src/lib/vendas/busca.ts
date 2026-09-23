import { idDeBusca } from "../busca-numerica";
import { CANAIS_VENDAS, ENTREGAS_VENDAS, STATUS_VENDAS } from "./filtros";

// Valores ficam entre aspas para não alterar a gramática do filtro PostgREST.
function padrao(texto: string) {
  const grupos: Record<string, string> = { a: "[aáàâã]", e: "[eéê]", i: "[ií]", o: "[oóôõ]", u: "[uúü]", c: "[cç]" };
  const literal = texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[aeiouc]/g, (letra) => grupos[letra])
    .replace(/\s+/g, ".*");
  return `"${literal.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function textos(campos: string[], termo: string) {
  return campos.map((campo) => `${campo}.imatch.${padrao(termo)}`);
}

export function buscaCliente(termo: string) {
  const filtros = textos(/\s/.test(termo) ? ["nomerazaosocial"] : ["nomerazaosocial", "cpfcnpj", "telefone", "email"], termo);
  // O padrão aceita documentos/telefones gravados com ou sem máscara, inclusive trechos.
  const digitos = termo.replace(/\D/g, "");
  if (digitos && /^[\d\s.()/+\-]+$/.test(termo)) {
    const flexivel = `"${digitos.split("").join("[^0-9]*")}"`;
    filtros.push(`cpfcnpj.imatch.${flexivel}`, `telefone.imatch.${flexivel}`);
  }
  const cnpj = termo.replace(/[.\/\s-]/g, "");
  if (/^[a-z\d]{12}\d{2}$/i.test(cnpj) && /[a-z]/i.test(cnpj)) {
    filtros.push(`cpfcnpj.imatch."${cnpj.split("").join("[^a-z0-9]*")}"`);
  }
  return filtros.join(",");
}

export function valorDaBusca(termo: string): number | null {
  const texto = termo.replace(/^R\$\s*/i, "").trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(texto) && !/^\d+\.\d{1,2}$/.test(texto)) return null;
  const numero = Number(texto.includes(",") || /\.\d{3}/.test(texto)
    ? texto.replace(/\./g, "").replace(",", ".") : texto);
  return Number.isFinite(numero) ? numero : null;
}

export type PlanoBuscaVendas = {
  select: string[];
  filtros: Array<{ relacao: string; expressao: string }>;
  or: string[];
  obrigatorias: string[];
};

/** Relações auxiliares preservam todos os itens e o cliente da resposta.
 * A busca é feita no banco antes da paginação, sem truncar listas de IDs.
 */
export function planoBuscaVendas(termo: string, cliente = "", nota = "", notasAgrupadas = true): PlanoBuscaVendas {
  const plano: PlanoBuscaVendas = { select: [], filtros: [], or: [], obrigatorias: [] };
  function relacao(alias: string, select: string, expressao: string, obrigatoria = false, caminho = alias) {
    plano.select.push(`${alias}:${select}`);
    plano.filtros.push({ relacao: caminho, expressao });
    (obrigatoria ? plano.obrigatorias : plano.or).push(`${alias}.not.is.null`);
  }
  function notas(prefixo: string, expressao: string, obrigatoria: boolean) {
    relacao(prefixo, "nfe!nfe_vendaid_fkey()", expressao);
    const alternativas = [plano.or.pop()!];
    if (notasAgrupadas) {
      relacao(`${prefixo}_grupo`, "nfe_origem_vinculo!venda_id(nota:nfe_id!inner())", expressao, false, `${prefixo}_grupo.nota`);
      alternativas.push(plano.or.pop()!);
    }
    if (obrigatoria) plano.obrigatorias.push(`or(${alternativas.join(",")})`);
    else plano.or.push(...alternativas);
  }

  let q = termo.trim();
  const valorExplicito = valorDaBusca(q);
  if (valorExplicito !== null && (/^R\$/i.test(q) || q.includes(","))) {
    plano.or.push(`valortotal.eq.${valorExplicito}`);
    q = "";
  } else if (/^#\d{1,10}$/.test(q)) {
    plano.or.push(`id.eq.${idDeBusca(q) ?? -1}`);
    q = "";
  }
  if (q) {
    relacao("busca_cliente", "cliente()", buscaCliente(q));
    const variasPalavras = /\s/.test(q);
    const produtos = textos(["titulo", "descricao", "referencia", "codigobarras", "fabricante", "etiqueta", "ncm"], q);
    const produtoId = /^\d{1,10}$/.test(q) ? idDeBusca(q) : null;
    if (produtoId !== null) produtos.push(`id.eq.${produtoId}`);
    relacao("busca_produtos", "vendaproduto(produto:produtoid!inner())", produtos.join(","), false, "busca_produtos.produto");
    relacao("busca_vendedor", "vendedor()", textos(["nome"], q).join(","));
    relacao("busca_criador", "created_by()", textos(["nome"], q).join(","));
    relacao("busca_categoria", "categoriavendaid()", textos(["nome", "descricao"], q).join(","));
    const comprador = variasPalavras ? [] : textos(["raw_order->buyer->>first_name", "raw_order->buyer->>last_name", "raw_order->buyer->>nickname"], q);
    const palavras = q.split(/\s+/);
    if (palavras.length > 1) comprador.push(`and(${palavras.map((p) => `or(${textos(["raw_order->buyer->>first_name", "raw_order->buyer->>last_name"], p).join(",")})`).join(",")})`);
    if (/^\d{1,18}$/.test(q)) comprador.push(`ml_order_id.eq.${q}`, `ml_pack_id.eq.${q}`, `buyer_id.eq.${q}`);
    relacao("busca_marketplace", "mercadolivre_order()", comprador.join(","));
    const notaFiltros = textos(["chave_acesso"], q);
    const numero = /^\d{1,9}$/.test(q) ? idDeBusca(q) : null;
    if (numero !== null) notaFiltros.push(`numero.eq.${numero}`);
    if (!variasPalavras) notas("busca_nota", notaFiltros.join(","), false);
    plano.or.push(...textos([
      "descricao", "observacoes", "observacoes_fiscais", "descricao_financeiro", "garantia",
      "forma_pagamento", "transportadora_rastreio", "motivo_cancelamento",
      ...(!variasPalavras ? ["codigo_rastreio", "nfe_chave_acesso"] : []),
    ], q));
    const id = /^#?\d{1,10}$/.test(q) ? idDeBusca(q) : null;
    if (id !== null) plano.or.push(`id.eq.${id}`);
    const valor = valorDaBusca(q);
    if (valor !== null) plano.or.push(`valortotal.eq.${valor}`);
    const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/_/g, " ");
    for (const [campo, opcoes] of [["status", STATUS_VENDAS], ["canal", CANAIS_VENDAS], ["status_entrega", ENTREGAS_VENDAS]] as const) {
      for (const [valor, rotulo] of opcoes) {
        if (valor !== "NAO_INICIADA" && (normalizar(rotulo).includes(normalizar(q)) || normalizar(valor).includes(normalizar(q)))) plano.or.push(`${campo}.eq.${valor}`);
      }
    }
  }
  if (cliente.trim()) relacao("filtro_cliente", "cliente()", buscaCliente(cliente.trim()), true);
  if (nota.trim()) {
    const numero = /^\d{1,9}$/.test(nota.trim()) ? idDeBusca(nota) : null;
    // Número inválido produz lista vazia, nunca um filtro que estoura integer.
    notas("filtro_nota", `numero.eq.${numero ?? -1}`, true);
  }
  return plano;
}
