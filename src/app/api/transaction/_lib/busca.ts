/**
 * Busca por texto numa transacao.
 *
 * Antes o termo batia so em `descricao`, e quem procurava pelo nome do
 * fornecedor, pelo CPF do pagador, pelo numero da nota ou pelo numero da
 * transacao nao achava nada — mesmo com o dado na tela. Aqui o mesmo termo
 * atravessa todos os campos onde ele pode razoavelmente estar.
 *
 * Vive fora das rotas porque a lista, os indicadores e a exportacao precisam
 * responder a mesma pergunta: um filtro que encontra na tabela e nao soma no
 * cartao e pior do que filtro nenhum.
 */

/**
 * Colunas de texto varridas pelo termo, na ordem em que o usuario pensaria.
 *
 * Categoria, plano de conta e centro de custo entram porque sao exatamente o que
 * a tabela mostra na linha: quem le "Combustivel" na tela procura por
 * "combustivel", e ate aqui nao achava nada. As tres estao gravadas como texto
 * na propria transacao (alem do id), entao a busca nao custa junção nenhuma.
 */
const CAMPOS_TEXTO = [
  "descricao",
  "descricao_pagamento",
  "nomepagador",
  "cpfcnpjpagador",
  "categoria",
  "plano_de_conta",
  "centro_custo",
  "documento_numero",
  "documento_serie",
  "documento_chave",
  "documento_observacao",
] as const;

/**
 * Escapa o termo para dentro de um `or()` do PostgREST.
 *
 * A lista de condicoes e separada por virgula e agrupada por parenteses, entao
 * um termo com `,` ou `(` quebraria a expressao inteira — e um termo com aspas
 * escaparia do valor. Aspas duplas ao redor resolvem a virgula; barra invertida
 * e aspas precisam ser neutralizadas dentro delas.
 */
function paraPadrao(termo: string) {
  const escapado = termo.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"*${escapado}*"`;
}

/**
 * Expressao `or` do PostgREST para o termo, ou `null` quando nao ha o que
 * filtrar. `null` significa "nao aplique filtro nenhum" — nunca "nao ache nada".
 */
export function filtroDeBusca(termo: string): string | null {
  const limpo = termo.trim();
  if (!limpo) return null;

  /*
   * `#123` procura o lancamento 123 e mais nada.
   *
   * Numero solto continua varrendo os textos junto — "87" pode ser o numero de
   * uma nota —, e por isso nunca da para pedir *so* o lancamento 87: a lista
   * volta cheia de coincidencia. O `#` e a forma de dizer "e o id", e e como o
   * proprio sistema escreve o numero na tela, em "#87".
   *
   * `#` sozinho, ou seguido de qualquer coisa que nao seja numero, cai no
   * caminho normal: melhor buscar pelo texto do que devolver lista vazia.
   */
  const porId = /^#\s*(\d{1,15})$/.exec(limpo);
  if (porId) return `id.eq.${porId[1]}`;

  const padrao = paraPadrao(limpo);
  const condicoes = CAMPOS_TEXTO.map((campo) => `${campo}.ilike.${padrao}`);

  /*
   * Documento digitado com pontuacao.
   *
   * O CPF/CNPJ e gravado so com digitos, mas ninguem procura assim: digita-se
   * "12.345.678/0001-99". Sem esta linha, colar o documento de um cadastro nao
   * acha o proprio lancamento.
   */
  const somenteDigitos = limpo.replace(/\D/g, "");
  if (somenteDigitos.length >= 3 && somenteDigitos !== limpo) {
    condicoes.push(`cpfcnpjpagador.ilike.${paraPadrao(somenteDigitos)}`);
  }

  /*
   * Numero puro procura tambem pelo id, e de forma exata.
   *
   * "87" e como o usuario se refere a transacao #87, que e o que a lista mostra
   * ao lado de cada linha. `ilike` traria 187 e 870 junto; igualdade responde a
   * pergunta que foi feita. O limite evita estourar o bigint com um numero de
   * nota longo, que ja e coberto por `documento_numero`.
   */
  if (/^\d{1,15}$/.test(limpo)) {
    condicoes.push(`id.eq.${limpo}`);
  }

  return condicoes.join(",");
}
