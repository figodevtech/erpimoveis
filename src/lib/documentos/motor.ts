// Motor dos documentos dinâmicos: troca `{{cliente.nome}}` pelo valor do
// registro e repete `{{#itens}} … {{/itens}}` para cada linha da lista.
//
// Uma passada só sobre o modelo: o valor que entra nunca é relido como
// variável, então uma descrição de produto com `{{…}}` sai como texto.

import type { CatalogoModulo, ContextoDocumento, VariavelDocumento } from "./tipos";

type TipoVariavel = NonNullable<VariavelDocumento["tipo"]>;

const NOME = "[a-z_][a-z0-9_]*";
const CAMINHO = `${NOME}(?:\\.${NOME})*`;

/** Uma lista inteira (grupo 1 e 2) ou uma variável solta (grupo 3). */
const TOKEN = new RegExp(
  `\\{\\{#\\s*(${NOME})\\s*\\}\\}([\\s\\S]*?)\\{\\{\\/\\s*\\1\\s*\\}\\}|\\{\\{\\s*(${CAMINHO})\\s*\\}\\}`,
  "gi",
);

/** Abertura ou fechamento de lista que sobrou sem par. */
const MARCA_DE_LISTA = new RegExp(`\\{\\{\\s*[#/]\\s*${NOME}\\s*\\}\\}`, "gi");

export function escaparHtml(texto: string) {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function variaveisDoCatalogo(catalogo: CatalogoModulo) {
  const mapa = new Map<string, TipoVariavel>();
  for (const grupo of catalogo.grupos) {
    for (const variavel of grupo.variaveis) mapa.set(variavel.chave, variavel.tipo ?? "texto");
  }
  return mapa;
}

function variaveisDentroDaLista(
  externas: Map<string, TipoVariavel>,
  lista: CatalogoModulo["listas"][number],
) {
  const mapa = new Map(externas);
  for (const campo of lista.campos) mapa.set(`${lista.item}.${campo.chave}`, campo.tipo ?? "texto");
  return mapa;
}

function valorNoCaminho(contexto: ContextoDocumento, caminho: string): unknown {
  let atual: unknown = contexto;
  for (const parte of caminho.split(".")) {
    if (!atual || typeof atual !== "object") return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

function comoTexto(valor: unknown) {
  if (valor == null) return "";
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  return "";
}

function substituir(
  modelo: string,
  contexto: ContextoDocumento,
  conhecidas: Map<string, TipoVariavel>,
  catalogo: CatalogoModulo,
): string {
  return modelo.replace(TOKEN, (original, chaveLista?: string, miolo?: string, caminho?: string) => {
    if (chaveLista !== undefined) {
      const lista = catalogo.listas.find((l) => l.chave === chaveLista.toLowerCase());
      if (!lista) return original;
      const linhas = valorNoCaminho(contexto, lista.chave);
      const internas = variaveisDentroDaLista(conhecidas, lista);
      return (Array.isArray(linhas) ? linhas : [])
        .map((linha) => substituir(miolo ?? "", { ...contexto, [lista.item]: linha }, internas, catalogo))
        .join("");
    }

    const chave = String(caminho).toLowerCase();
    const tipo = conhecidas.get(chave);
    // Escrita errada fica à vista: some-la deixaria uma frase truncada num
    // documento que o cliente assina, e ninguém perceberia.
    if (!tipo) return original;
    const texto = comoTexto(valorNoCaminho(contexto, chave));
    return tipo === "html" ? texto : escaparHtml(texto);
  });
}

/**
 * Preenche o modelo com o contexto do registro. Variável do catálogo sem valor
 * vira vazio (um complemento em branco não suja o contrato); variável fora do
 * catálogo continua escrita como está.
 */
export function renderizarModelo(modelo: string, contexto: ContextoDocumento, catalogo: CatalogoModulo) {
  return substituir(modelo, contexto, variaveisDoCatalogo(catalogo), catalogo);
}

function coletarDesconhecidas(
  modelo: string,
  conhecidas: Map<string, TipoVariavel>,
  catalogo: CatalogoModulo,
  achadas: Set<string>,
) {
  const sobra = modelo.replace(TOKEN, (original, chaveLista?: string, miolo?: string, caminho?: string) => {
    if (chaveLista !== undefined) {
      const lista = catalogo.listas.find((l) => l.chave === chaveLista.toLowerCase());
      if (!lista) {
        achadas.add(`#${chaveLista}`);
        return "";
      }
      coletarDesconhecidas(miolo ?? "", variaveisDentroDaLista(conhecidas, lista), catalogo, achadas);
      return "";
    }
    if (!conhecidas.has(String(caminho).toLowerCase())) achadas.add(String(caminho));
    return "";
  });

  for (const marca of sobra.match(MARCA_DE_LISTA) ?? []) achadas.add(marca.replace(/\s+/g, ""));
}

/**
 * O que o modelo usa e o catálogo não conhece — inclusive `{{item.x}}` fora da
 * lista e lista aberta sem fechamento. É o aviso do editor antes de salvar.
 */
export function variaveisDesconhecidas(modelo: string, catalogo: CatalogoModulo): string[] {
  const achadas = new Set<string>();
  coletarDesconhecidas(modelo, variaveisDoCatalogo(catalogo), catalogo, achadas);
  return Array.from(achadas);
}
