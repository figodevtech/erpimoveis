// Documentos dinâmicos: modelos em HTML que o próprio cliente escreve, com
// variáveis do registro, emitidos a partir da venda, da OS ou do aluguel.
// Sem "use client": o motor roda na emissão (servidor) e na prévia (navegador).

export const MODULOS_DOCUMENTO = ["venda", "os", "aluguel"] as const;
export type ModuloDocumento = (typeof MODULOS_DOCUMENTO)[number];

export const ROTULO_MODULO_DOCUMENTO: Record<ModuloDocumento, string> = {
  venda: "Venda",
  os: "Ordem de serviço",
  aluguel: "Aluguel",
};

export function ehModuloDocumento(valor: unknown): valor is ModuloDocumento {
  return typeof valor === "string" && (MODULOS_DOCUMENTO as readonly string[]).includes(valor);
}

/** Teto do HTML de um modelo; o banco tem a mesma trava. */
export const LIMITE_HTML_DOCUMENTO = 200_000;

export type DocumentoModelo = {
  id: number;
  codigo_padrao: string | null;
  modulo: ModuloDocumento;
  nome: string;
  html: string;
  ativo: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
};

/** O que o dropdown de emissão precisa saber de cada modelo. */
export type DocumentoParaEmitir = Pick<DocumentoModelo, "id" | "nome">;

/**
 * Variável que o modelo pode usar. `html` é marcação montada pelo sistema
 * (tabela de itens, logo, texto rico) e entra sem escape; todo o resto é
 * texto e é escapado.
 */
export type VariavelDocumento = {
  chave: string;
  rotulo: string;
  tipo?: "texto" | "html";
};

export type GrupoVariaveis = {
  rotulo: string;
  variaveis: VariavelDocumento[];
};

/**
 * Lista repetível: `{{#chave}} … {{item.campo}} … {{/chave}}`. Os campos são
 * relativos ao `item` (ex.: `descricao` vira `{{item.descricao}}`).
 */
export type ListaDocumento = {
  chave: string;
  rotulo: string;
  item: string;
  campos: VariavelDocumento[];
};

/**
 * Trecho condicional: `{{#chave}} … {{/chave}}` sai uma vez quando a condição
 * do registro vale e some quando não vale. A chave não tem ponto, como a das
 * listas (ex.: `se_pessoa_juridica`).
 */
export type CondicaoDocumento = {
  chave: string;
  rotulo: string;
};

export type CatalogoModulo = {
  modulo: ModuloDocumento;
  grupos: GrupoVariaveis[];
  listas: ListaDocumento[];
  condicoes: CondicaoDocumento[];
};

/** Valores de um registro, aninhados pelo caminho da chave (`cliente.nome`). */
export type ContextoDocumento = Record<string, unknown>;
