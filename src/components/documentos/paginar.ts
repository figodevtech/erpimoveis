// Paginação do documento em folhas A4, feita no DOM do frame depois que ele
// carrega. O modelo é HTML livre; aqui ele é repartido em folhas de verdade
// (210 × 297 mm), cada uma com o cabeçalho e o rodapé repetidos e o número da
// folha. A impressão sai dessas mesmas folhas, uma por página.
//
// Convenções que o modelo pode usar:
//   data-documento="cabecalho"  repete no topo de toda folha
//   data-documento="rodape"     repete no pé de toda folha
//   data-documento="quebra"     força o início de uma folha nova
//   {{pagina.atual}} / {{pagina.total}} dentro do cabeçalho ou do rodapé
// e também `break-before`, `break-after` e `break-inside: avoid` do CSS.
// Sem marcador de número no modelo, cada folha ganha "Página X de Y" no pé.
//
// Cupom em impressora térmica: `<body data-documento-bobina="80mm">` troca as
// folhas A4 por uma tira só, da largura dada e da altura do conteúdo.

const NAO_DIVIDE = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "SVG", "THEAD", "TFOOT", "PRE", "BLOCKQUOTE", "FIGURE", "CANVAS"]);
/** O que não se parte como texto: linha de tabela, imagem, figura. */
const SEM_TEXTO_PARTIVEL = new Set(["TR", "TABLE", "THEAD", "TBODY", "TFOOT", "IMG", "SVG", "CANVAS", "FIGURE", "VIDEO"]);
const QUEBRA = new Set(["page", "always", "left", "right", "recto", "verso"]);
const EVITA = new Set(["avoid", "avoid-page"]);
const MARGEM_PADRAO = "15mm";
const MARGEM_BOBINA = "3mm";
const LARGURA_BOBINA = /^\d{2,3}(?:\.\d+)?mm$/;
const MM_POR_PX = 25.4 / 96;

export type Margens = { top: string; right: string; bottom: string; left: string };

/** Largura do papel de bobina (`data-documento-bobina="80mm"`); `null` é A4. */
export function larguraDaBobina(doc: Document): string | null {
  const valor = doc.body?.getAttribute("data-documento-bobina")?.trim() ?? "";
  return LARGURA_BOBINA.test(valor) ? valor : null;
}

/** As margens do `@page` do modelo; sem elas, 15 mm (3 mm na bobina). */
export function margensDoModelo(doc: Document): Margens {
  const padrao = larguraDaBobina(doc) ? MARGEM_BOBINA : MARGEM_PADRAO;
  const margens: Margens = { top: padrao, right: padrao, bottom: padrao, left: padrao };
  for (const folha of Array.from(doc.styleSheets)) {
    let regras: CSSRuleList;
    try {
      regras = folha.cssRules;
    } catch {
      continue;
    }
    for (const regra of Array.from(regras)) {
      // 6 = CSSRule.PAGE_RULE; comparar pelo número evita depender da classe
      // do outro documento.
      if (regra.type !== 6) continue;
      const estilo = (regra as CSSPageRule).style;
      if (estilo.marginTop) margens.top = estilo.marginTop;
      if (estilo.marginRight) margens.right = estilo.marginRight;
      if (estilo.marginBottom) margens.bottom = estilo.marginBottom;
      if (estilo.marginLeft) margens.left = estilo.marginLeft;
    }
  }
  return margens;
}

function estiloDasFolhas(m: Margens) {
  return `
@page { size: A4; margin: 0; }
html, body { margin: 0 !important; padding: 0 !important; }
@media screen { html, body { background: transparent !important; } }
.doc-paginas { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 12px 0; }
.doc-folha {
  box-sizing: border-box; position: relative; display: flex; flex-direction: column;
  width: 210mm; height: 297mm; overflow: hidden; background: #fff;
  padding: ${m.top} ${m.right} ${m.bottom} ${m.left};
  box-shadow: 0 1px 2px rgba(15,23,42,.10), 0 10px 28px -12px rgba(15,23,42,.40);
}
.doc-folha-corpo { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.doc-folha > [data-documento="cabecalho"], .doc-folha > [data-documento="rodape"], .doc-folha-numero { flex: none; }
.doc-folha-numero { padding-top: 3mm; text-align: right; font: 9px/1.2 Arial, Helvetica, sans-serif; color: #64748b; }
@media print {
  html, body { background: #fff !important; }
  .doc-paginas { display: block; padding: 0; gap: 0; }
  /* Um fio abaixo de 297 mm: o arredondamento não empurra uma folha em branco. */
  .doc-folha { box-shadow: none; height: 296.6mm; break-after: page; }
  .doc-folha:last-child { break-after: auto; }
}`;
}

function ehElemento(no: Node): no is HTMLElement {
  return no.nodeType === 1;
}

function ehEspaco(no: Node) {
  return no.nodeType === 3 && !(no.textContent ?? "").trim();
}

function temConteudo(el: Element) {
  return Boolean((el.textContent ?? "").trim()) || Boolean(el.querySelector("img, svg, hr, canvas, video"));
}

export type ResultadoPaginacao = { folhas: number };

/**
 * A tira de bobina: o conteúdo corre inteiro, sem quebra, e a página impressa
 * tem a altura medida dele — a térmica corta logo depois do fim.
 */
function montarBobina(doc: Document, largura: string): ResultadoPaginacao {
  const body = doc.body;
  const m = margensDoModelo(doc);
  const css = doc.createElement("style");
  css.setAttribute("data-documento-paginacao", "");
  doc.head.appendChild(css);
  const estilo = (alturaMm: number | null) => `
@page { ${alturaMm ? `size: ${largura} ${alturaMm}mm; ` : ""}margin: 0; }
html, body { margin: 0 !important; padding: 0 !important; }
@media screen { html, body { background: transparent !important; } }
.doc-paginas { display: flex; justify-content: center; padding: 12px 0; }
.doc-bobina {
  box-sizing: border-box; width: ${largura}; background: #fff;
  padding: ${m.top} ${m.right} ${m.bottom} ${m.left};
  box-shadow: 0 1px 2px rgba(15,23,42,.10), 0 10px 28px -12px rgba(15,23,42,.40);
}
@media print {
  html, body { background: #fff !important; }
  .doc-paginas { display: block; padding: 0; }
  .doc-bobina { box-shadow: none; }
}`;
  css.textContent = estilo(null);

  const conjunto = doc.createElement("div");
  conjunto.className = "doc-paginas";
  const bobina = doc.createElement("section");
  bobina.className = "doc-bobina";
  Array.from(body.childNodes).forEach((no) => bobina.appendChild(no));
  conjunto.appendChild(bobina);
  body.appendChild(conjunto);

  // Na bobina não há quebra nem segunda folha.
  bobina.querySelectorAll('[data-documento="quebra"]').forEach((el) => el.remove());
  bobina.querySelectorAll("[data-documento-pagina]").forEach((s) => (s.textContent = "1"));

  // Um milímetro de folga para o arredondamento não empurrar uma página em branco.
  css.textContent = estilo(Math.ceil(bobina.getBoundingClientRect().height * MM_POR_PX) + 1);

  body.setAttribute("data-documento-paginado", "");
  return { folhas: 1 };
}

export function paginarDocumento(doc: Document): ResultadoPaginacao {
  const body = doc.body;
  const janela = doc.defaultView;
  if (!body || !janela) return { folhas: 0 };
  if (body.hasAttribute("data-documento-paginado")) {
    return { folhas: body.querySelectorAll(".doc-folha, .doc-bobina").length };
  }
  const estilo = (el: Element) => janela.getComputedStyle(el);

  // <style> perdido no corpo vai para o head: ele não é conteúdo de folha.
  body.querySelectorAll("style").forEach((s) => doc.head.appendChild(s));

  const bobina = larguraDaBobina(doc);
  if (bobina) return montarBobina(doc, bobina);

  const cabecalho = body.querySelector<HTMLElement>('[data-documento="cabecalho"]');
  const rodape = body.querySelector<HTMLElement>('[data-documento="rodape"]');
  cabecalho?.remove();
  rodape?.remove();
  const numeracaoDoModelo = Boolean(
    cabecalho?.querySelector("[data-documento-pagina]") || rodape?.querySelector("[data-documento-pagina]"),
  );

  const fluxo = Array.from(body.childNodes).filter((n) => !ehEspaco(n) && n.nodeType !== 8);
  fluxo.forEach((n) => n.parentNode?.removeChild(n));

  const css = doc.createElement("style");
  css.setAttribute("data-documento-paginacao", "");
  css.textContent = estiloDasFolhas(margensDoModelo(doc));
  doc.head.appendChild(css);

  const conjunto = doc.createElement("div");
  conjunto.className = "doc-paginas";
  body.appendChild(conjunto);

  type Folha = { el: HTMLElement; corpo: HTMLElement };
  const folhas: Folha[] = [];
  const ultimaCasca = new WeakMap<Element, Element>();
  // O thead sai da tabela original quando ela é partida (vai para a primeira
  // folha); a cópia guardada aqui é a que as folhas seguintes repetem.
  const cabecalhoDaTabela = new WeakMap<Element, Node>();

  function criarFolha(): Folha {
    const el = doc.createElement("section");
    el.className = "doc-folha";
    if (cabecalho) el.appendChild(cabecalho.cloneNode(true));
    const corpo = doc.createElement("div");
    corpo.className = "doc-folha-corpo";
    el.appendChild(corpo);
    if (rodape) el.appendChild(rodape.cloneNode(true));
    if (!numeracaoDoModelo) {
      const numero = doc.createElement("div");
      numero.className = "doc-folha-numero";
      numero.innerHTML = 'Página <span data-documento-pagina="atual"></span> de <span data-documento-pagina="total"></span>';
      el.appendChild(numero);
    }
    conjunto.appendChild(el);
    const folha = { el, corpo };
    folhas.push(folha);
    return folha;
  }

  /** Cópia vazia de um elemento que continua na folha seguinte. */
  function casca(origem: Element, continuacao: boolean) {
    const copia = origem.cloneNode(false) as HTMLElement;
    copia.removeAttribute("id");
    copia.setAttribute("data-documento-casca", "");
    if (origem.tagName === "TABLE" && !cabecalhoDaTabela.has(origem)) {
      const thead = origem.querySelector(":scope > thead");
      if (thead) cabecalhoDaTabela.set(origem, thead.cloneNode(true));
    }
    if (continuacao) {
      // A tabela que continua repete o cabeçalho das colunas.
      const thead = origem.tagName === "TABLE" ? cabecalhoDaTabela.get(origem) : undefined;
      if (thead) copia.appendChild(thead.cloneNode(true));
      if (origem.tagName === "OL") {
        const anterior = ultimaCasca.get(origem);
        if (anterior) {
          const inicio = Number(anterior.getAttribute("start") || 1);
          copia.setAttribute("start", String(inicio + anterior.querySelectorAll(":scope > li").length));
        }
      }
      // O item de lista partido não repete o marcador.
      if (origem.tagName === "LI") copia.style.listStyleType = "none";
    }
    ultimaCasca.set(origem, copia);
    return copia;
  }

  let folha = criarFolha();
  let atual: Element = folha.corpo;
  let quebraPendente = false;

  const cabe = () => folha.corpo.scrollHeight <= folha.corpo.clientHeight + 1;

  /** Folha nova, refazendo a cadeia de elementos partidos; devolve o mais interno. */
  function novaFolha(cadeia: Element[]) {
    folha = criarFolha();
    let pai: Element = folha.corpo;
    for (const origem of cadeia) {
      const copia = casca(origem, true);
      pai.appendChild(copia);
      pai = copia;
    }
    return pai;
  }

  function podeDividir(el: HTMLElement) {
    if (NAO_DIVIDE.has(el.tagName)) return false;
    const s = estilo(el);
    if (EVITA.has(s.breakInside) || EVITA.has(s.pageBreakInside)) return false;
    if (el.tagName === "TR") return el.children.length === 1;
    if (el.tagName === "TABLE") return Boolean(el.querySelector(":scope > tbody > tr, :scope > tr"));
    if (el.tagName === "TBODY" || el.tagName === "UL" || el.tagName === "OL") return el.children.length > 1;
    if (s.display.startsWith("inline") || s.display.includes("grid")) return false;
    if (s.display.includes("flex") && !s.flexDirection.startsWith("column")) return false;
    // Só parte quem tem blocos dentro; um parágrafo inteiro muda de folha.
    return Array.from(el.children).some((filho) => {
      const d = estilo(filho).display;
      return d !== "none" && !d.startsWith("inline");
    });
  }

  function manterComProximo(el: Element) {
    const s = estilo(el);
    return /^H[1-6]$/.test(el.tagName) || EVITA.has(s.breakAfter) || EVITA.has(s.pageBreakAfter);
  }

  function moverParaProxima(no: Node, cadeia: Element[]) {
    atual.removeChild(no);
    if (!temConteudo(folha.corpo)) {
      // Não cabe nem sozinho numa folha: fica, e o excesso é cortado.
      atual.appendChild(no);
      return;
    }
    // Título não fica sozinho no pé da folha: desce junto.
    const levar: Element[] = [];
    const anterior = atual.lastElementChild;
    if (anterior && manterComProximo(anterior)) {
      anterior.remove();
      if (temConteudo(folha.corpo)) levar.push(anterior);
      else atual.appendChild(anterior);
    }
    atual = novaFolha(cadeia);
    levar.forEach((el) => atual.appendChild(el));
    atual.appendChild(no);
  }

  function maiorQueUmaFolha(el: HTMLElement) {
    return el.getBoundingClientRect().height > folha.corpo.clientHeight;
  }

  /**
   * Texto que não cabe nem numa folha inteira (parágrafo longo escrito na
   * edição, observação extensa) é partido entre duas palavras: a folha
   * corrente vai até onde der e o resto segue na próxima. Sem isso o excesso
   * ficaria escondido no pé da folha. `false` quando nada do texto cabe aqui.
   */
  function partirTexto(el: HTMLElement, cadeia: Element[]) {
    if (SEM_TEXTO_PARTIVEL.has(el.tagName)) return false;
    const textos: Text[] = [];
    const caminhante = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = caminhante.nextNode(); n; n = caminhante.nextNode()) textos.push(n as Text);
    const corrido = textos.map((t) => t.data).join("");
    if (!corrido.trim()) return false;

    const ponto = (deslocamento: number): [Node, number] => {
      let resto = deslocamento;
      for (const t of textos) {
        if (resto <= t.data.length) return [t, resto];
        resto -= t.data.length;
      }
      const ultimo = textos[textos.length - 1];
      return [ultimo, ultimo.data.length];
    };
    const trecho = (de: number | null, ate: number | null) => {
      const faixa = doc.createRange();
      faixa.selectNodeContents(el);
      if (de !== null) faixa.setStart(...ponto(de));
      if (ate !== null) faixa.setEnd(...ponto(ate));
      return faixa.cloneContents();
    };

    // A primeira parte é medida no lugar do próprio elemento.
    const primeira = el.cloneNode(false) as HTMLElement;
    atual.replaceChild(primeira, el);
    const cabeAte = (k: number) => {
      primeira.replaceChildren(trecho(null, k));
      return cabe();
    };
    let cabeMais = 0;
    let naoCabe = corrido.length;
    while (naoCabe - cabeMais > 1) {
      const meio = Math.floor((cabeMais + naoCabe) / 2);
      if (cabeAte(meio)) cabeMais = meio;
      else naoCabe = meio;
    }
    // Corta no último espaço; palavra maior que a linha é cortada onde der.
    const espaco = corrido.lastIndexOf(" ", cabeMais);
    const corte = espaco > 0 ? espaco : cabeMais;
    if (!corrido.slice(0, corte).trim()) {
      atual.replaceChild(el, primeira);
      return false;
    }
    primeira.replaceChildren(trecho(null, corte));
    // A última linha da parte de cima é linha do meio do parágrafo.
    if (estilo(primeira).textAlign === "justify") primeira.style.textAlignLast = "justify";

    const continuacao = el.cloneNode(false) as HTMLElement;
    continuacao.removeAttribute("id");
    continuacao.style.textIndent = "0";
    if (el.tagName === "LI") continuacao.style.listStyleType = "none";
    continuacao.appendChild(trecho(corte, null));
    atual = novaFolha(cadeia);
    inserir(continuacao, cadeia);
    return true;
  }

  function dividir(el: HTMLElement, cadeia: Element[]) {
    const filhos = Array.from(el.childNodes);
    const copia = casca(el, false);
    atual.replaceChild(copia, el);
    atual = copia;
    const interna = [...cadeia, el];
    for (const filho of filhos) {
      if (ehEspaco(filho)) atual.appendChild(filho);
      else inserir(filho, interna);
    }
    // A casca de `el` na folha corrente, de onde se volta ao pai dela.
    atual = atual.parentElement ?? folha.corpo;
  }

  function inserir(no: Node, cadeia: Element[]) {
    const el = ehElemento(no) ? no : null;

    if (el?.getAttribute("data-documento") === "quebra") {
      if (temConteudo(folha.corpo)) atual = novaFolha(cadeia);
      quebraPendente = false;
      return;
    }
    atual.appendChild(no);
    // A regra de quebra só se lê com o elemento já no documento.
    if (quebraPendente || (el && QUEBRA.has(estiloQuebra(el, "antes")))) {
      quebraPendente = false;
      atual.removeChild(no);
      if (temConteudo(folha.corpo)) atual = novaFolha(cadeia);
      atual.appendChild(no);
    }

    if (!cabe()) {
      if (el && podeDividir(el)) dividir(el, cadeia);
      else if (!(el && maiorQueUmaFolha(el) && partirTexto(el, cadeia))) moverParaProxima(no, cadeia);
    }

    if (el && QUEBRA.has(estiloQuebra(el, "depois"))) quebraPendente = true;
  }

  function estiloQuebra(el: Element, lado: "antes" | "depois") {
    const s = estilo(el);
    const moderno = lado === "antes" ? s.breakBefore : s.breakAfter;
    const antigo = lado === "antes" ? s.pageBreakBefore : s.pageBreakAfter;
    return QUEBRA.has(moderno) ? moderno : antigo;
  }

  fluxo.forEach((no) => inserir(no, []));

  // Cascas que ficaram vazias numa folha (o conteúdo desceu inteiro).
  Array.from(conjunto.querySelectorAll("[data-documento-casca]"))
    .reverse()
    .forEach((c) => {
      const vazia =
        c.tagName === "TABLE" ? !c.querySelector(":scope > tbody > tr, :scope > tr") : !temConteudo(c) && !c.querySelector("*");
      if (vazia) c.remove();
    });

  // Folha que terminou sem nada (quebra forçada no fim, por exemplo).
  while (folhas.length > 1 && !temConteudo(folhas[folhas.length - 1].corpo)) {
    folhas.pop()?.el.remove();
  }

  folhas.forEach((f, i) => {
    f.el.querySelectorAll('[data-documento-pagina="atual"]').forEach((s) => (s.textContent = String(i + 1)));
    f.el.querySelectorAll('[data-documento-pagina="total"]').forEach((s) => (s.textContent = String(folhas.length)));
  });

  body.setAttribute("data-documento-paginado", "");
  return { folhas: folhas.length };
}
