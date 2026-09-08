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
 * Vinculos que o usuario chama pelo numero do documento, e nao por texto.
 *
 * `os:123` e `venda:45` procuram a ordem de servico 123 e a venda 45 — e mais
 * nada, do mesmo jeito que `#123` procura o lancamento. Sao os dois numeros que
 * a tela mostra ao lado da transacao e que a busca manual da conciliacao ja
 * prometia no seu placeholder ("Descricao, pagador, OS ou venda...") sem nunca
 * ter cumprido: OS e venda nao sao coluna de texto, entao o `ilike` nunca as
 * alcancou.
 *
 * O separador e opcional para o termo digitado no ritmo de quem fala: `os:123`,
 * `os 123` e `os#123` sao a mesma pergunta. Sem numero atras, o termo cai no
 * caminho de texto — "os" sozinho e artigo, nao prefixo.
 *
 * Nove digitos porque as duas colunas sao `integer`: um numero maior derrubaria
 * a consulta inteira no lugar de nao achar nada.
 */
const PREFIXOS_DE_VINCULO: ReadonlyArray<readonly [RegExp, string]> = [
  [/^os\s*[:#]?\s*(\d{1,9})$/i, "ordemservicoid"],
  [/^venda\s*[:#]?\s*(\d{1,9})$/i, "vendaid"],
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

  for (const [padraoDoVinculo, campo] of PREFIXOS_DE_VINCULO) {
    const porVinculo = padraoDoVinculo.exec(limpo);
    if (porVinculo) return `${campo}.eq.${porVinculo[1]}`;
  }

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

  /*
   * O numero solto tambem procura a OS e a venda.
   *
   * Quem digita "1204" na conciliacao quase sempre esta com a OS na mao, nao com
   * o id do lancamento — e ate aqui so o id respondia. Sao condicoes de
   * igualdade dentro do mesmo `or`, entao elas somam resultado em vez de
   * estreitar: o "1204" continua achando a nota 1204 pelo texto.
   *
   * O teto de nove digitos e o mesmo de `PREFIXOS_DE_VINCULO`, e pela mesma
   * razao: as duas colunas sao `integer`.
   */
  if (/^\d{1,9}$/.test(limpo)) {
    condicoes.push(`ordemservicoid.eq.${limpo}`);
    condicoes.push(`vendaid.eq.${limpo}`);
  }

  return condicoes.join(",");
}
