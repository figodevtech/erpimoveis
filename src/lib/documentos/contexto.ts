// Linhas do banco -> contexto dos documentos, com cada valor já formatado.
// Funções puras: a emissão passa o que leu do banco, a prévia do editor passa
// os exemplos de `exemplos.ts`, e o teste confere que toda chave do catálogo
// sai daqui.

import { calculateFinancialSurcharge, calculateFinancialTotal } from "@/lib/financial-surcharge";
import type { PrintPaymentSummary } from "@/lib/print-payment-display";

import {
  ano,
  arredondar,
  cep,
  data,
  dataHora,
  dataPorExtenso,
  documento,
  juntar,
  moeda,
  numero,
  quantidade,
  rotuloDeEnum,
  telefone,
  texto,
  valorPorExtenso,
} from "./formatacao";
import { escaparHtml } from "./motor";
import type { ContextoDocumento } from "./tipos";

type Linha = Record<string, any>;

/** O PostgREST devolve relação 1:1 como objeto ou como lista de um. */
function um<T = Linha>(valor: unknown): T | null {
  if (Array.isArray(valor)) return (valor[0] ?? null) as T | null;
  return (valor ?? null) as T | null;
}

function lista(valor: unknown): Linha[] {
  return Array.isArray(valor) ? valor : [];
}

/* --------------------------------- comuns --------------------------------- */

export type EmissaoDocumento = {
  nomeDocumento: string;
  emitidoPor: string | null;
  agora: Date;
  /** URL pública da logo da empresa; a prévia do editor usa um data URL de exemplo. */
  logoUrl: string | null;
};

function contextoEmpresa(empresa: Linha | null, logoUrl: string | null) {
  const razao = texto(empresa?.razaosocial);
  const numeroEndereco = texto(empresa?.numero);
  const codigoPostal = cep(empresa?.cep);
  return {
    nome: texto(empresa?.nomefantasia) || razao,
    razao_social: razao,
    cnpj: documento(empresa?.cnpj),
    inscricao_estadual: texto(empresa?.inscricaoestadual),
    inscricao_municipal: texto(empresa?.inscricaomunicipal),
    telefone: telefone(empresa?.telefone),
    endereco: juntar(
      [
        juntar([empresa?.endereco, numeroEndereco ? `nº ${numeroEndereco}` : null, empresa?.complemento]),
        empresa?.bairro,
        juntar([empresa?.cidade, empresa?.uf], "/"),
        codigoPostal ? `CEP ${codigoPostal}` : null,
      ],
      " · ",
    ),
    bairro: texto(empresa?.bairro),
    cidade: texto(empresa?.cidade),
    uf: texto(empresa?.uf),
    cep: codigoPostal,
    logo: logoUrl ? `<img class="doc-logo" src="${escaparHtml(logoUrl)}" alt="" style="max-height:64px;max-width:220px;object-fit:contain" />` : "",
    logo_url: logoUrl ?? "",
  };
}

function contextoEmissao(emissao: EmissaoDocumento) {
  return {
    nome: emissao.nomeDocumento,
    data_emissao: data(emissao.agora),
    data_emissao_extenso: dataPorExtenso(emissao.agora),
    hora_emissao: dataHora(emissao.agora),
    emitido_por: texto(emissao.emitidoPor),
  };
}

/**
 * Marcadores do número da folha. Fora da paginação (ou antes dela) valem 1; a
 * folha A4 troca o texto de cada um pelo número da folha em que ele caiu.
 */
function contextoPagina() {
  return {
    atual: '<span data-documento-pagina="atual">1</span>',
    total: '<span data-documento-pagina="total">1</span>',
  };
}

export type ClienteDocumento = {
  nome?: unknown;
  documento?: unknown;
  tipopessoa?: unknown;
  inscricaoestadual?: unknown;
  email?: unknown;
  telefone?: unknown;
  endereco?: unknown;
  endereconumero?: unknown;
  enderecocomplemento?: unknown;
  bairro?: unknown;
  cidade?: unknown;
  estado?: unknown;
  cep?: unknown;
};

/** Sem tipo no cadastro, conta o documento: 14 dígitos é CNPJ. */
function ehPessoaJuridica(cliente: ClienteDocumento | null) {
  const tipo = texto(cliente?.tipopessoa).toUpperCase();
  const digitos = texto(cliente?.documento).replace(/\D/g, "");
  return tipo ? tipo === "JURIDICA" || tipo === "PJ" : digitos.length === 14;
}

/** Os trechos `{{#se_pessoa_juridica}}` / `{{#se_pessoa_fisica}}`; sem cliente, só `{{#se_sem_cliente}}`. */
function condicoesDoCliente(cliente: ClienteDocumento | null) {
  const juridica = Boolean(cliente) && ehPessoaJuridica(cliente);
  return { se_pessoa_juridica: juridica, se_pessoa_fisica: Boolean(cliente) && !juridica, se_sem_cliente: !cliente };
}

function contextoCliente(cliente: ClienteDocumento | null) {
  const tipo = texto(cliente?.tipopessoa).toUpperCase();
  const digitos = texto(cliente?.documento).replace(/\D/g, "");
  const juridica = ehPessoaJuridica(cliente);
  const numeroEndereco = texto(cliente?.endereconumero);
  const codigoPostal = cep(cliente?.cep);
  return {
    nome: texto(cliente?.nome),
    documento: documento(cliente?.documento),
    tipo_pessoa: cliente && (tipo || digitos) ? (juridica ? "Pessoa jurídica" : "Pessoa física") : "",
    inscricao_estadual: texto(cliente?.inscricaoestadual),
    email: texto(cliente?.email),
    telefone: telefone(cliente?.telefone),
    endereco_completo: juntar([
      juntar([cliente?.endereco, numeroEndereco ? `nº ${numeroEndereco}` : null, cliente?.enderecocomplemento]),
      cliente?.bairro,
      juntar([cliente?.cidade, cliente?.estado], "/"),
      codigoPostal ? `CEP ${codigoPostal}` : null,
    ], " · "),
    logradouro: texto(cliente?.endereco),
    numero: numeroEndereco,
    complemento: texto(cliente?.enderecocomplemento),
    bairro: texto(cliente?.bairro),
    cidade: texto(cliente?.cidade),
    uf: texto(cliente?.estado),
    cep: codigoPostal,
  };
}

/**
 * Cliente do cadastro (`cliente`), no formato que os documentos esperam. O
 * Consumidor Final é a venda sem cliente identificado: sai como sem cliente.
 */
export function clienteDoCadastro(cliente: Linha | null): ClienteDocumento | null {
  if (!cliente || cliente.codigo_sistema) return null;
  return {
    ...cliente,
    nome: cliente.nomerazaosocial ?? cliente.nome,
    documento: cliente.cpfcnpj ?? cliente.documento,
  };
}

type Coluna = { titulo: string; direita?: boolean };

/** Tabela pronta, com estilo embutido para sair legível em qualquer modelo. */
function tabela(colunas: Coluna[], linhas: string[][]) {
  if (linhas.length === 0) return "";
  const borda = "border:1px solid #cbd5e1;padding:4px 6px";
  const cabecalho = colunas
    .map((c) => `<th style="${borda};background:#f1f5f9;text-align:${c.direita ? "right" : "left"}">${escaparHtml(c.titulo)}</th>`)
    .join("");
  const corpo = linhas
    .map(
      (linha) =>
        `<tr>${linha
          .map((celula, i) => `<td style="${borda};text-align:${colunas[i]?.direita ? "right" : "left"}">${escaparHtml(celula)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table class="doc-tabela" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>${cabecalho}</tr></thead><tbody>${corpo}</tbody></table>`;
}

function pagamentos(resumo: PrintPaymentSummary | null) {
  const linhas = (resumo?.entries ?? []).map((p) =>
    juntar([p.label, p.valor != null ? moeda(p.valor) : null, p.parcelas ? `em ${p.parcelas}x` : null], " "),
  );
  return {
    linha: linhas.join("; "),
    html: linhas.length ? `<ul class="doc-pagamentos">${linhas.map((l) => `<li>${escaparHtml(l)}</li>`).join("")}</ul>` : "",
  };
}

type TipoDesconto = "FIXO" | "PORCENTAGEM" | null;

function tipoDesconto(valor: unknown): TipoDesconto {
  return valor === "FIXO" || valor === "PORCENTAGEM" ? valor : null;
}

function descontoAplicado(base: number, tipoValor: unknown, descontoValor: unknown) {
  const tipo = tipoDesconto(tipoValor);
  const baseSegura = Math.max(0, base);
  const desconto = Math.max(0, numero(descontoValor));
  if (!tipo || baseSegura <= 0 || desconto <= 0) return 0;
  if (tipo === "PORCENTAGEM") return arredondar(baseSegura * (Math.min(desconto, 100) / 100));
  return arredondar(Math.min(desconto, baseSegura));
}

/* ---------------------------------- venda --------------------------------- */

export type EntradaVenda = {
  venda: Linha;
  empresa: Linha | null;
  pagamentos: PrintPaymentSummary | null;
  emissao: EmissaoDocumento;
};

export function contextoDaVenda({ venda, empresa, pagamentos: resumo, emissao }: EntradaVenda): ContextoDocumento {
  const linhasItens = lista(venda.itens).slice().sort((a, b) => numero(a.id) - numero(b.id));

  const itens = linhasItens.map((item, i) => {
    const produto = um(item.produto);
    const qtd = numero(item.quantidade);
    const bruto = Math.max(0, numero(item.sub_total));
    return {
      numero: String(i + 1),
      codigo: texto(produto?.etiqueta) || texto(produto?.codigobarras) || texto(produto?.id),
      descricao: texto(produto?.titulo) || texto(produto?.descricao) || "Produto",
      unidade: texto(produto?.unidade),
      quantidade: quantidade(qtd),
      valor_unitario: moeda(qtd > 0 ? bruto / qtd : bruto),
      desconto: moeda(descontoAplicado(bruto, item.tipo_desconto, item.valor_desconto)),
      total: moeda(item.valor_total),
    };
  });

  // As mesmas contas do diálogo da venda.
  const subtotal = arredondar(linhasItens.reduce((s, item) => s + Math.max(0, numero(item.sub_total)), 0));
  const descontoItens = arredondar(
    linhasItens.reduce((s, item) => s + descontoAplicado(Math.max(0, numero(item.sub_total)), item.tipo_desconto, item.valor_desconto), 0),
  );
  const freteItens = arredondar(linhasItens.reduce((s, item) => s + Math.max(0, numero(item.valor_frete)), 0));
  const baseDescontoGeral = Math.max(0, arredondar(subtotal - descontoItens));
  const descontoGeral = descontoAplicado(baseDescontoGeral, venda.desconto_tipo, venda.desconto_valor);
  const frete = arredondar(freteItens + Math.max(0, numero(venda.valor_frete)));
  const totalComercial = arredondar(baseDescontoGeral - descontoGeral + frete);
  const acrescimo = calculateFinancialSurcharge(totalComercial, venda.acrescimo_financeiro_tipo, venda.acrescimo_financeiro_valor);
  const total = calculateFinancialTotal(totalComercial, venda.acrescimo_financeiro_tipo, venda.acrescimo_financeiro_valor);

  const entrega = (venda.endereco_entrega_snapshot ?? {}) as Linha;
  const enderecoEntrega =
    juntar([
      juntar([entrega.logradouro, entrega.numero ? `nº ${entrega.numero}` : null, entrega.complemento]),
      entrega.bairro,
      juntar([entrega.cidade, entrega.estado], "/"),
      cep(entrega.cep) ? `CEP ${cep(entrega.cep)}` : null,
    ], " · ") || texto(entrega.pickupAddress);
  const formas = pagamentos(resumo);
  const cliente = clienteDoCadastro(um(venda.cliente));
  const descontoTotal = arredondar(descontoItens + descontoGeral);

  return {
    empresa: contextoEmpresa(empresa, emissao.logoUrl),
    documento: contextoEmissao(emissao),
    pagina: contextoPagina(),
    cliente: contextoCliente(cliente),
    ...condicoesDoCliente(cliente),
    se_desconto: descontoTotal > 0,
    se_frete: frete > 0,
    se_acrescimo: acrescimo > 0,
    venda: {
      numero: texto(venda.id),
      data: data(venda.datavenda ?? venda.createdat),
      data_hora: dataHora(venda.datavenda ?? venda.createdat),
      ano: ano(venda.datavenda ?? venda.createdat),
      ano_curto: ano(venda.datavenda ?? venda.createdat).slice(-2),
      status: rotuloDeEnum(venda.status),
      canal: rotuloDeEnum(venda.canal),
      categoria: texto(um(venda.categoria_venda)?.nome),
      vendedor: texto(um(venda.vendedor_rel)?.nome),
      criado_por: texto(um(venda.criador)?.nome),
      quantidade_itens: String(itens.length),
      subtotal: moeda(subtotal),
      desconto: moeda(descontoTotal),
      frete: moeda(frete),
      acrescimo: moeda(acrescimo),
      total: moeda(total),
      total_extenso: valorPorExtenso(total),
      forma_pagamento: formas.linha,
      pagamentos: formas.html,
      garantia: texto(venda.garantia),
      descricao: texto(venda.descricao),
      observacoes: texto(venda.observacoes),
      nfe_chave: texto(venda.nfe_chave_acesso),
      itens_tabela: tabela(
        [
          { titulo: "#" },
          { titulo: "Descrição" },
          { titulo: "Qtd.", direita: true },
          { titulo: "Unitário", direita: true },
          { titulo: "Desconto", direita: true },
          { titulo: "Total", direita: true },
        ],
        itens.map((i) => [i.numero, i.descricao, juntar([i.quantidade, i.unidade], " "), i.valor_unitario, i.desconto, i.total]),
      ),
    },
    entrega: {
      metodo: texto(entrega.deliveryLabel) || rotuloDeEnum(entrega.deliveryMethod),
      endereco: enderecoEntrega,
      rastreio: texto(venda.codigo_rastreio),
      transportadora: texto(venda.transportadora_rastreio),
    },
    itens,
  };
}
