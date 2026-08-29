import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { encodeCode128C } from "@/lib/nfe/code128";
import { DANFE_DEFAULT_FONT_SCALE, type DanfeFontScale } from "@/lib/nfe/danfeFontScale";
import type { DanfeViewData } from "@/components/danfe/danfe-view";
import type { DanfeItem } from "@/lib/nfe/danfeParser";

/**
 * DANFE vetorial montado com pdf-lib, a partir dos mesmos dados que alimentam o
 * `DanfeView`. Mantem os blocos exigidos pelo Manual de Integracao do Contribuinte
 * (canhoto, identificacao, destinatario, calculo do imposto, transporte, itens,
 * fatura/duplicatas, pagamento, ISSQN e dados adicionais).
 *
 * A paginacao aqui e por altura medida — diferente da heuristica da tela, que
 * estima por quantidade de caracteres — entao o corte entre paginas pode nao cair
 * no mesmo item da versao HTML. O conteudo fiscal e o mesmo.
 */

const MM = 2.834645669;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 5 * MM;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_H - MARGIN;

const LABEL_SIZE = 4.6;
const VALUE_SIZE = 6.2;
const ITEM_SIZE = 5;
const ITEM_HEAD_SIZE = 4.4;

const BLACK = rgb(0, 0, 0);
const LINE = 0.5;

const FRETE_LABEL: Record<string, string> = {
  "0": "0 - Emitente",
  "1": "1 - Destinatario",
  "2": "2 - Terceiros",
  "3": "3 - Proprio/emitente",
  "4": "4 - Proprio/destinatario",
  "9": "9 - Sem transporte",
};

const PAGAMENTO_LABEL: Record<string, string> = {
  "01": "Dinheiro", "02": "Cheque", "03": "Cartao de credito", "04": "Cartao de debito",
  "05": "Credito loja", "10": "Vale alimentacao", "11": "Vale refeicao", "12": "Vale presente",
  "13": "Vale combustivel", "14": "Duplicata mercantil", "15": "Boleto bancario",
  "16": "Deposito bancario", "17": "PIX", "18": "Transferencia/carteira digital",
  "19": "Fidelidade/cashback/credito virtual", "90": "Sem pagamento", "99": "Outros",
};

/** WinAnsi nao cobre tipografia unicode; troca o que aparece no DANFE. */
function safe(value: unknown) {
  return String(value ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

function fmtMoney(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "-";
}

function fmtDecimal(value: number | string | null | undefined, digits = 4) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: digits })
    : "-";
}

function fmtDate(value?: string | Date | null) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR");
}

function fmtDateOnly(value?: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function fmtDoc(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return digits || "-";
}

type Ctx = {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  fontScale: DanfeFontScale;
  /** Cursor medido a partir do topo da folha. */
  y: number;
  novaPagina: () => void;
};

const scaled = (ctx: Ctx, value: number) => value * ctx.fontScale;

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const clean = safe(text).replace(/\s+/g, " ").trim();
  if (!clean) return [""];

  const linhas: string[] = [];
  let atual = "";

  for (const palavra of clean.split(" ")) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (font.widthOfTextAtSize(tentativa, size) <= maxWidth) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);

    // Palavra sozinha maior que a coluna (chave, codigo): quebra por caractere.
    let resto = palavra;
    while (font.widthOfTextAtSize(resto, size) > maxWidth && resto.length > 1) {
      let corte = resto.length;
      while (corte > 1 && font.widthOfTextAtSize(resto.slice(0, corte), size) > maxWidth) corte -= 1;
      linhas.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    }
    atual = resto;
  }

  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [""];
}

function wrapText(ctx: Ctx, text: string, font: PDFFont, size: number, maxWidth: number) {
  return wrap(text, font, scaled(ctx, size), maxWidth);
}

function texto(ctx: Ctx, value: string, x: number, top: number, size: number, font: PDFFont) {
  const fontSize = scaled(ctx, size);
  ctx.page.drawText(safe(value), { x, y: PAGE_H - top - fontSize, size: fontSize, font, color: BLACK });
}

function textoDireita(ctx: Ctx, value: string, xFim: number, top: number, size: number, font: PDFFont) {
  const largura = font.widthOfTextAtSize(safe(value), scaled(ctx, size));
  texto(ctx, value, xFim - largura, top, size, font);
}

function textoCentro(ctx: Ctx, value: string, x: number, largura: number, top: number, size: number, font: PDFFont) {
  const w = font.widthOfTextAtSize(safe(value), scaled(ctx, size));
  texto(ctx, value, x + (largura - w) / 2, top, size, font);
}

function caixa(ctx: Ctx, x: number, top: number, largura: number, altura: number) {
  ctx.page.drawRectangle({
    x,
    y: PAGE_H - top - altura,
    width: largura,
    height: altura,
    borderWidth: LINE,
    borderColor: BLACK,
  });
}

function linhaVertical(ctx: Ctx, x: number, top: number, altura: number) {
  ctx.page.drawLine({
    start: { x, y: PAGE_H - top },
    end: { x, y: PAGE_H - top - altura },
    thickness: LINE,
    color: BLACK,
  });
}

type Campo = { label: string; valor: string; alinhamento?: "esquerda" | "direita" };

/** Uma linha de celulas rotuladas, com bordas — o "Cell" do DANFE em tela. */
function linhaDeCampos(ctx: Ctx, campos: Campo[], larguras: number[], altura = 8.5 * MM / 2) {
  const alturaLinhaLabel = LABEL_SIZE + 1;
  const alturaLinhaValor = VALUE_SIZE + 1.2;
  const layouts = campos.map((campo, indice) => ({
    labels: wrapText(ctx, campo.label.toUpperCase(), ctx.bold, LABEL_SIZE, larguras[indice] - 4),
    valores: wrapText(ctx, campo.valor || "-", ctx.font, VALUE_SIZE, larguras[indice] - 4),
  }));
  const maxLabels = Math.max(1, ...layouts.map((layout) => layout.labels.length));
  const maxValores = Math.max(1, ...layouts.map((layout) => layout.valores.length));
  const maiorAltura = Math.max(
    altura,
    scaled(ctx, 3 + maxLabels * alturaLinhaLabel + maxValores * alturaLinhaValor),
  );
  const topoValor = ctx.y + scaled(ctx, 2 + maxLabels * alturaLinhaLabel);

  caixa(ctx, MARGIN, ctx.y, larguras.reduce((soma, item) => soma + item, 0), maiorAltura);

  let x = MARGIN;
  campos.forEach((campo, indice) => {
    if (indice > 0) linhaVertical(ctx, x, ctx.y, maiorAltura);
    layouts[indice].labels.forEach((linha, ordem) => {
      texto(ctx, linha, x + 2, ctx.y + scaled(ctx, 1 + ordem * alturaLinhaLabel), LABEL_SIZE, ctx.bold);
    });
    layouts[indice].valores.forEach((linha, ordem) => {
      const top = topoValor + ordem * scaled(ctx, alturaLinhaValor);
      if (campo.alinhamento === "direita") {
        textoDireita(ctx, linha, x + larguras[indice] - 2, top, VALUE_SIZE, ctx.font);
      } else {
        texto(ctx, linha, x + 2, top, VALUE_SIZE, ctx.font);
      }
    });
    x += larguras[indice];
  });

  ctx.y += maiorAltura;
  return maiorAltura;
}

function colunas(total: number, pesos: number[]) {
  const soma = pesos.reduce((acumulado, peso) => acumulado + peso, 0);
  return pesos.map((peso) => (peso / soma) * total);
}

function tituloBloco(ctx: Ctx, titulo: string) {
  ctx.y += 1.5 * MM;
  texto(ctx, titulo.toUpperCase(), MARGIN, ctx.y, LABEL_SIZE, ctx.bold);
  ctx.y += scaled(ctx, LABEL_SIZE + 1.5);
}

function avisoFiscal(ctx: Ctx, data: DanfeViewData) {
  let mensagem: string | null = null;
  if (data.ambiente === "2") mensagem = "EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
  else if (!data.isAutorizada) mensagem = `SEM VALOR FISCAL - ${data.statusLabel || data.statusUpper || "NAO AUTORIZADA"}`;
  else if (data.tipoEmissao && data.tipoEmissao !== "1") mensagem = `EMISSAO EM CONTINGENCIA - TIPO ${data.tipoEmissao}`;
  if (!mensagem) return;

  const altura = scaled(ctx, 12);
  ctx.page.drawRectangle({
    x: MARGIN, y: PAGE_H - ctx.y - altura, width: CONTENT_W, height: altura,
    borderWidth: 1.5, borderColor: BLACK,
  });
  textoCentro(ctx, mensagem, MARGIN, CONTENT_W, ctx.y + 3.5, 8, ctx.bold);
  ctx.y += altura + 1 * MM;
}

function canhoto(ctx: Ctx, data: DanfeViewData) {
  const altura = 17 * MM * ctx.fontScale;
  const larguraDireita = 30 * MM;
  const larguraEsquerda = CONTENT_W - larguraDireita;

  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
  linhaVertical(ctx, MARGIN + larguraEsquerda, ctx.y, altura);

  const recebemos = `RECEBEMOS DE ${data.emitenteNome} OS PRODUTOS/SERVICOS CONSTANTES DA NF-e INDICADA AO LADO`;
  wrapText(ctx, recebemos, ctx.bold, 6, larguraEsquerda - 4).forEach((linha, ordem) => {
    texto(ctx, linha, MARGIN + 2, ctx.y + 2 + ordem * scaled(ctx, 7), 6, ctx.bold);
  });
  texto(ctx, "DATA DE RECEBIMENTO: ____________________", MARGIN + 2, ctx.y + altura - 16, 6, ctx.font);
  texto(ctx, "IDENTIFICACAO E ASSINATURA: ______________________________________", MARGIN + 2, ctx.y + altura - 8, 6, ctx.font);

  textoCentro(ctx, "NF-e", MARGIN + larguraEsquerda, larguraDireita, ctx.y + 3, 8, ctx.font);
  textoCentro(ctx, `No ${String(data.nfe.numero).padStart(9, "0")}`, MARGIN + larguraEsquerda, larguraDireita, ctx.y + 14, 8, ctx.bold);
  textoCentro(ctx, `SERIE ${String(data.nfe.serie).padStart(3, "0")}`, MARGIN + larguraEsquerda, larguraDireita, ctx.y + 25, 7, ctx.font);

  ctx.y += altura + 2 * MM;
}

function codigoDeBarras(ctx: Ctx, chave: string, x: number, top: number, largura: number, altura: number) {
  const encoded = encodeCode128C(chave);
  if (!encoded || encoded.digits.length !== 44) {
    caixa(ctx, x, top, largura, altura);
    textoCentro(ctx, "Chave invalida para codigo de barras", x, largura, top + altura / 2 - 3, 6, ctx.bold);
    return;
  }

  const escala = largura / encoded.width;
  for (const barra of encoded.bars) {
    ctx.page.drawRectangle({
      x: x + barra.x * escala,
      y: PAGE_H - top - altura,
      width: Math.max(barra.width * escala, 0.2),
      height: altura,
      color: BLACK,
    });
  }
}

function cabecalho(ctx: Ctx, data: DanfeViewData, pagina: number, totalPaginas: number) {
  avisoFiscal(ctx, data);

  const altura = 30 * MM * ctx.fontScale;
  const [colEmitente, colTitulo, colChave] = colunas(CONTENT_W, [67, 34, 74]);

  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
  linhaVertical(ctx, MARGIN + colEmitente, ctx.y, altura);
  linhaVertical(ctx, MARGIN + colEmitente + colTitulo, ctx.y, altura);

  // Emitente
  let topo = ctx.y + 2;
  texto(ctx, "IDENTIFICACAO DO EMITENTE", MARGIN + 2, topo, LABEL_SIZE, ctx.bold);
  topo += scaled(ctx, LABEL_SIZE + 4);
  wrapText(ctx, data.emitenteNome, ctx.bold, 8, colEmitente - 4).forEach((linha) => {
    textoCentro(ctx, linha, MARGIN, colEmitente, topo, 8, ctx.bold);
    topo += scaled(ctx, 9);
  });
  topo += 2;
  wrapText(ctx, data.emitenteEndereco, ctx.font, 6, colEmitente - 4).forEach((linha) => {
    texto(ctx, linha, MARGIN + 2, topo, 6, ctx.font);
    topo += scaled(ctx, 7);
  });
  wrapText(ctx, `CNPJ: ${fmtDoc(data.emitenteCnpj)} - IE: ${data.emitenteIe || "-"}`, ctx.font, 6, colEmitente - 4).forEach((linha) => {
    texto(ctx, linha, MARGIN + 2, topo, 6, ctx.font);
    topo += scaled(ctx, 7);
  });
  if (data.emitenteTelefone) {
    texto(ctx, `Fone: ${data.emitenteTelefone}`, MARGIN + 2, topo, 6, ctx.font);
  }

  // Titulo DANFE
  const xTitulo = MARGIN + colEmitente;
  let topoTitulo = ctx.y + 4;
  textoCentro(ctx, "DANFE", xTitulo, colTitulo, topoTitulo, 14, ctx.bold);
  topoTitulo += scaled(ctx, 16);
  wrapText(ctx, "Documento Auxiliar da Nota Fiscal Eletronica", ctx.bold, 5.5, colTitulo - 4).forEach((linha) => {
    textoCentro(ctx, linha, xTitulo, colTitulo, topoTitulo, 5.5, ctx.bold);
    topoTitulo += scaled(ctx, 6.5);
  });
  topoTitulo += 3;
  textoCentro(ctx, data.tipoOperacao === "ENTRADA" ? "0 - ENTRADA" : "1 - SAIDA", xTitulo, colTitulo, topoTitulo, 6.5, ctx.bold);
  topoTitulo += scaled(ctx, 9);
  textoCentro(ctx, `No ${String(data.nfe.numero).padStart(9, "0")}`, xTitulo, colTitulo, topoTitulo, 7, ctx.bold);
  topoTitulo += scaled(ctx, 9);
  textoCentro(ctx, `SERIE ${String(data.nfe.serie).padStart(3, "0")}`, xTitulo, colTitulo, topoTitulo, 7, ctx.bold);
  topoTitulo += scaled(ctx, 9);
  textoCentro(ctx, `FOLHA ${pagina}/${totalPaginas}`, xTitulo, colTitulo, topoTitulo, 6.5, ctx.bold);

  // Chave de acesso
  const xChave = MARGIN + colEmitente + colTitulo;
  codigoDeBarras(ctx, data.chaveAcesso, xChave + 3, ctx.y + 3, colChave - 6, 13 * MM);
  let topoChave = ctx.y + 3 + 13 * MM + 3;
  textoCentro(ctx, "CHAVE DE ACESSO", xChave, colChave, topoChave, LABEL_SIZE, ctx.bold);
  topoChave += scaled(ctx, LABEL_SIZE + 3);
  wrapText(ctx, data.chaveFormatada, ctx.bold, 6.5, colChave - 6).forEach((linha) => {
    textoCentro(ctx, linha, xChave, colChave, topoChave, 6.5, ctx.bold);
    topoChave += scaled(ctx, 7.5);
  });
  topoChave += 1;
  wrapText(
    ctx,
    "Consulta de autenticidade no Portal Nacional da NF-e (www.nfe.fazenda.gov.br/portal) ou no site da Sefaz autorizadora.",
    ctx.font, 4.6, colChave - 6,
  ).forEach((linha) => {
    textoCentro(ctx, linha, xChave, colChave, topoChave, 4.6, ctx.font);
    topoChave += scaled(ctx, 5.4);
  });

  ctx.y += altura + 1 * MM;

  // Identificacao da operacao
  const larguras = colunas(CONTENT_W, [2, 2, 1, 1.25, 1.35]);
  linhaDeCampos(ctx, [
    { label: "Natureza da operacao", valor: data.naturezaOperacao },
    { label: "Protocolo de autorizacao de uso", valor: data.nfe.protocolo ? `${data.nfe.protocolo} - ${fmtDate(data.nfe.dataautorizacao)}` : "-" },
    { label: "Inscricao estadual", valor: data.emitenteIe || "-" },
    { label: "Inscricao estadual do subst. tributario", valor: data.emitenteIest || "-" },
    { label: "CNPJ", valor: fmtDoc(data.emitenteCnpj) },
  ], larguras);
}

function destinatario(ctx: Ctx, data: DanfeViewData) {
  tituloBloco(ctx, "Destinatario / remetente");
  const larguras = colunas(CONTENT_W, [2.2, 1, 1]);
  linhaDeCampos(ctx, [
    { label: "Nome / Razao social", valor: data.destinatarioNome },
    { label: "CNPJ / CPF", valor: fmtDoc(data.destinatarioDoc) },
    { label: "Data de emissao", valor: fmtDate(data.dataEmissaoDanfe) },
  ], larguras);
  linhaDeCampos(ctx, [
    { label: "Endereco", valor: data.destinatarioEndereco },
    { label: "Municipio / UF", valor: data.destinatarioCidadeUf || "-" },
    { label: "CEP", valor: data.destinatarioCep || "-" },
  ], larguras);
  linhaDeCampos(ctx, [
    { label: "Inscricao estadual", valor: data.destinatarioIe || "-" },
    { label: "Data de saida / entrada", valor: fmtDate(data.dataSaidaEntrada) },
    { label: "", valor: "" },
  ], larguras);
}

function localDeEntrega(ctx: Ctx, data: DanfeViewData) {
  const entrega = data.entrega;
  if (!entrega) return;

  tituloBloco(ctx, "Local de entrega / retirada");
  const larguras = colunas(CONTENT_W, [2.2, 1, 1]);
  linhaDeCampos(ctx, [
    { label: "Nome / Razao social", valor: entrega.nome || "-" },
    { label: "CNPJ / CPF", valor: fmtDoc(entrega.documento) },
    { label: "Municipio / UF", valor: [entrega.municipio, entrega.uf].filter(Boolean).join("/") || "-" },
  ], larguras);
  linhaDeCampos(ctx, [
    { label: "Endereco", valor: [entrega.logradouro, entrega.numero].filter(Boolean).join(", ") || "-" },
    { label: "Bairro / Complemento", valor: [entrega.bairro, entrega.complemento].filter(Boolean).join(" - ") || "-" },
    { label: "CEP", valor: entrega.cep || "-" },
  ], larguras);
}

function calculoDoImposto(ctx: Ctx, data: DanfeViewData) {
  const t = data.totais;
  tituloBloco(ctx, "Calculo do imposto");

  const sete = colunas(CONTENT_W, [1, 1, 1, 1, 1, 1, 1]);
  linhaDeCampos(ctx, [
    { label: "Base de calculo do ICMS", valor: fmtMoney(t.vBC), alinhamento: "direita" },
    { label: "Valor do ICMS", valor: fmtMoney(t.vICMS), alinhamento: "direita" },
    { label: "Valor ICMS desonerado", valor: fmtMoney(t.vICMSDeson), alinhamento: "direita" },
    { label: "Valor do FCP", valor: fmtMoney(t.vFCP), alinhamento: "direita" },
    { label: "BC ICMS ST", valor: fmtMoney(t.vBCST), alinhamento: "direita" },
    { label: "Valor ICMS ST", valor: fmtMoney(t.vST), alinhamento: "direita" },
    { label: "Total dos produtos", valor: fmtMoney(t.vProd), alinhamento: "direita" },
  ], sete);
  linhaDeCampos(ctx, [
    { label: "Valor do frete", valor: fmtMoney(t.vFrete), alinhamento: "direita" },
    { label: "Valor do seguro", valor: fmtMoney(t.vSeg), alinhamento: "direita" },
    { label: "Desconto", valor: fmtMoney(t.vDesc), alinhamento: "direita" },
    { label: "Outras despesas", valor: fmtMoney(t.vOutro), alinhamento: "direita" },
    { label: "Valor do II", valor: fmtMoney(t.vII), alinhamento: "direita" },
    { label: "Valor do IPI", valor: fmtMoney(t.vIPI), alinhamento: "direita" },
    { label: "Valor total da nota", valor: fmtMoney(t.vNF), alinhamento: "direita" },
  ], sete);

  const seis = colunas(CONTENT_W, [1, 1, 1, 1, 1, 1]);
  linhaDeCampos(ctx, [
    { label: "Valor do PIS", valor: fmtMoney(t.vPIS), alinhamento: "direita" },
    { label: "Valor da COFINS", valor: fmtMoney(t.vCOFINS), alinhamento: "direita" },
    { label: "FCP ST", valor: fmtMoney(t.vFCPST), alinhamento: "direita" },
    { label: "FCP ST retido", valor: fmtMoney(t.vFCPSTRet), alinhamento: "direita" },
    { label: "IPI devolvido", valor: fmtMoney(t.vIPIDevol), alinhamento: "direita" },
    { label: "Tributos aproximados", valor: fmtMoney(t.vTotTrib), alinhamento: "direita" },
  ], seis);

  if (t.vBCIBSCBS || t.vIBS || t.vCBS || t.vIS) {
    tituloBloco(ctx, "Reforma tributaria (IBS / CBS / IS)");
    linhaDeCampos(ctx, [
      { label: "BC IBS/CBS", valor: fmtMoney(t.vBCIBSCBS), alinhamento: "direita" },
      { label: "IBS UF", valor: fmtMoney(t.vIBSUF), alinhamento: "direita" },
      { label: "IBS Municipio", valor: fmtMoney(t.vIBSMun), alinhamento: "direita" },
      { label: "Total IBS", valor: fmtMoney(t.vIBS), alinhamento: "direita" },
      { label: "Total CBS", valor: fmtMoney(t.vCBS), alinhamento: "direita" },
      { label: "Imposto seletivo", valor: fmtMoney(t.vIS), alinhamento: "direita" },
    ], seis);
  }
}

function transportador(ctx: Ctx, data: DanfeViewData) {
  const transporte = data.transporte;
  const volume = transporte.volumes[0];
  const quantidade = transporte.volumes.reduce((soma, item) => soma + item.quantidade, 0);
  const pesoLiquido = transporte.volumes.reduce((soma, item) => soma + item.pesoLiquido, 0);
  const pesoBruto = transporte.volumes.reduce((soma, item) => soma + item.pesoBruto, 0);

  tituloBloco(ctx, "Transportador / volumes transportados");
  const larguras = colunas(CONTENT_W, [2, 1.3, 1.3, 0.8, 0.6, 0.8]);
  linhaDeCampos(ctx, [
    { label: "Nome / Razao social", valor: transporte.nome || "-" },
    { label: "Frete por conta", valor: FRETE_LABEL[transporte.modFrete] || transporte.modFrete || "-" },
    { label: "CNPJ / CPF", valor: fmtDoc(transporte.documento) },
    { label: "Placa", valor: transporte.placa || "-" },
    { label: "UF", valor: transporte.ufVeiculo || "-" },
    { label: "RNTC", valor: transporte.rntc || "-" },
  ], larguras);
  linhaDeCampos(ctx, [
    { label: "Endereco", valor: transporte.endereco || "-" },
    { label: "Municipio", valor: transporte.municipio || "-" },
    { label: "UF", valor: transporte.uf || "-" },
    { label: "Quantidade", valor: volume ? fmtDecimal(quantidade) : "-" },
    { label: "Especie / Marca / Num.", valor: volume ? [volume.especie, volume.marca, volume.numeracao].filter(Boolean).join(" / ") : "-" },
    { label: "Peso liquido / bruto", valor: volume ? `${fmtDecimal(pesoLiquido, 3)} / ${fmtDecimal(pesoBruto, 3)}` : "-" },
  ], larguras);
}

const COLUNAS_ITENS = [
  { titulo: "Cod.", peso: 5, alinhamento: "esquerda" as const },
  { titulo: "Descricao", peso: 25, alinhamento: "esquerda" as const },
  { titulo: "NCM/SH", peso: 6, alinhamento: "esquerda" as const },
  { titulo: "CST", peso: 4, alinhamento: "esquerda" as const },
  { titulo: "CFOP", peso: 4.5, alinhamento: "esquerda" as const },
  { titulo: "UN", peso: 3.5, alinhamento: "esquerda" as const },
  { titulo: "Qtd.", peso: 6, alinhamento: "direita" as const },
  { titulo: "V. unit.", peso: 7, alinhamento: "direita" as const },
  { titulo: "V. total", peso: 7, alinhamento: "direita" as const },
  { titulo: "BC ICMS", peso: 7, alinhamento: "direita" as const },
  { titulo: "V. ICMS", peso: 6.5, alinhamento: "direita" as const },
  { titulo: "V. IPI", peso: 6, alinhamento: "direita" as const },
  { titulo: "% ICMS", peso: 5.5, alinhamento: "direita" as const },
  { titulo: "% IPI", peso: 5, alinhamento: "direita" as const },
];

function celulasDoItem(item: DanfeItem) {
  return [
    item.produtoid || "-",
    item.descricao,
    item.ncm || "-",
    `${item.origem || ""}${item.csosn || ""}` || "-",
    item.cfop,
    item.unidade,
    fmtDecimal(item.quantidade),
    fmtMoney(item.valor_unitario),
    fmtMoney(item.valor_total),
    fmtMoney(item.valor_bc_icms),
    fmtMoney(item.valor_icms),
    fmtMoney(item.valor_ipi),
    fmtDecimal(item.aliquotaicms, 2),
    fmtDecimal(item.aliquota_ipi, 2),
  ];
}

function detalheTributario(item: DanfeItem) {
  const partes = [
    `PIS ${item.cst_pis || "-"} (${fmtDecimal(item.aliquota_pis, 2)}%): ${fmtMoney(item.valor_pis)}`,
    `COFINS ${item.cst_cofins || "-"} (${fmtDecimal(item.aliquota_cofins, 2)}%): ${fmtMoney(item.valor_cofins)}`,
  ];
  if (item.cest) partes.push(`CEST ${item.cest}`);
  return partes.join(" - ");
}

function alturaDoItem(ctx: Ctx, item: DanfeItem, larguras: number[]) {
  const celulas = celulasDoItem(item);
  let linhas = 1;
  celulas.forEach((valor, indice) => {
    linhas = Math.max(linhas, wrapText(ctx, String(valor), ctx.font, ITEM_SIZE, larguras[indice] - 3).length);
  });
  const descricao = wrapText(ctx, item.descricao, ctx.bold, ITEM_SIZE, larguras[1] - 3).length;
  const detalhe = wrapText(ctx, detalheTributario(item), ctx.font, 4.4, larguras[1] - 3).length;
  const linhasDescricao = descricao + detalhe;
  return scaled(ctx, Math.max(linhas, linhasDescricao) * (ITEM_SIZE + 1.4) + 3);
}

function cabecalhoDaTabela(ctx: Ctx, larguras: number[]) {
  const alturaLinha = ITEM_HEAD_SIZE + 1;
  const titulos = COLUNAS_ITENS.map((coluna, indice) =>
    wrapText(ctx, coluna.titulo.toUpperCase(), ctx.bold, ITEM_HEAD_SIZE, larguras[indice] - 3),
  );
  const maxLinhas = Math.max(1, ...titulos.map((linhas) => linhas.length));
  const altura = Math.max(scaled(ctx, 9), scaled(ctx, 3 + maxLinhas * alturaLinha));
  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
  let x = MARGIN;
  COLUNAS_ITENS.forEach((_, indice) => {
    if (indice > 0) linhaVertical(ctx, x, ctx.y, altura);
    titulos[indice].forEach((linha, ordem) => {
      texto(ctx, linha, x + 1.5, ctx.y + scaled(ctx, 1.5 + ordem * alturaLinha), ITEM_HEAD_SIZE, ctx.bold);
    });
    x += larguras[indice];
  });
  ctx.y += altura;
}

function desenharItem(ctx: Ctx, item: DanfeItem, larguras: number[], altura: number) {
  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
  const celulas = celulasDoItem(item);

  let x = MARGIN;
  celulas.forEach((valor, indice) => {
    if (indice > 0) linhaVertical(ctx, x, ctx.y, altura);

    if (indice === 1) {
      let topo = ctx.y + 2;
      wrapText(ctx, item.descricao, ctx.bold, ITEM_SIZE, larguras[1] - 3).forEach((linha) => {
        texto(ctx, linha, x + 1.5, topo, ITEM_SIZE, ctx.bold);
        topo += scaled(ctx, ITEM_SIZE + 1.4);
      });
      wrapText(ctx, detalheTributario(item), ctx.font, 4.4, larguras[1] - 3).forEach((linha) => {
        texto(ctx, linha, x + 1.5, topo, 4.4, ctx.font);
        topo += scaled(ctx, 5.4);
      });
    } else {
      wrapText(ctx, String(valor), ctx.font, ITEM_SIZE, larguras[indice] - 3).forEach((linha, ordem) => {
        const topo = ctx.y + 2 + ordem * scaled(ctx, ITEM_SIZE + 1.4);
        if (COLUNAS_ITENS[indice].alinhamento === "direita") {
          textoDireita(ctx, linha, x + larguras[indice] - 1.5, topo, ITEM_SIZE, ctx.font);
        } else {
          texto(ctx, linha, x + 1.5, topo, ITEM_SIZE, ctx.font);
        }
      });
    }

    x += larguras[indice];
  });

  ctx.y += altura;
}

const COLUNAS_RTC = [
  "Item", "CST IBS/CBS", "Class. tributaria", "BC IBS/CBS", "% IBS UF", "V. IBS UF",
  "% IBS Mun.", "V. IBS Mun.", "V. IBS", "% CBS", "V. CBS", "CST IS", "V. IS",
];

function tabelaRtc(ctx: Ctx, itens: DanfeItem[]) {
  if (!itens.length) return;
  tituloBloco(ctx, "Detalhamento IBS / CBS / IS por item");

  const larguras = colunas(CONTENT_W, [3, 6, 8, 7, 5.5, 7, 6, 7, 7, 5, 7, 5, 6]);
  const alturaLinha = ITEM_HEAD_SIZE + 1;
  const titulos = COLUNAS_RTC.map((titulo, indice) =>
    wrapText(ctx, titulo.toUpperCase(), ctx.bold, ITEM_HEAD_SIZE, larguras[indice] - 3),
  );
  const maxLinhas = Math.max(1, ...titulos.map((linhas) => linhas.length));
  const alturaCabecalho = Math.max(scaled(ctx, 9), scaled(ctx, 3 + maxLinhas * alturaLinha));
  caixa(ctx, MARGIN, ctx.y, CONTENT_W, alturaCabecalho);
  let x = MARGIN;
  COLUNAS_RTC.forEach((_, indice) => {
    if (indice > 0) linhaVertical(ctx, x, ctx.y, alturaCabecalho);
    titulos[indice].forEach((linha, ordem) => {
      texto(ctx, linha, x + 1.5, ctx.y + scaled(ctx, 1.5 + ordem * alturaLinha), ITEM_HEAD_SIZE, ctx.bold);
    });
    x += larguras[indice];
  });
  ctx.y += alturaCabecalho;

  for (const item of itens) {
    const valores = [
      String(item.n_item),
      item.cst_ibs_cbs || "-",
      item.classificacao_tributaria || "-",
      fmtMoney(item.base_ibs_cbs),
      fmtDecimal(item.aliquota_ibs_uf, 2),
      fmtMoney(item.valor_ibs_uf),
      fmtDecimal(item.aliquota_ibs_municipio, 2),
      fmtMoney(item.valor_ibs_municipio),
      fmtMoney(item.valor_ibs),
      fmtDecimal(item.aliquota_cbs, 2),
      fmtMoney(item.valor_cbs),
      item.cst_is || "-",
      fmtMoney(item.valor_is),
    ];
    const altura = scaled(ctx, ITEM_SIZE + 5);
    if (ctx.y + altura > BOTTOM_LIMIT) ctx.novaPagina();

    caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
    let coluna = MARGIN;
    valores.forEach((valor, indice) => {
      if (indice > 0) linhaVertical(ctx, coluna, ctx.y, altura);
      const linha = wrapText(ctx, valor, ctx.font, ITEM_SIZE, larguras[indice] - 3)[0] ?? "";
      if (indice >= 3) textoDireita(ctx, linha, coluna + larguras[indice] - 1.5, ctx.y + 2, ITEM_SIZE, ctx.font);
      else texto(ctx, linha, coluna + 1.5, ctx.y + 2, ITEM_SIZE, ctx.font);
      coluna += larguras[indice];
    });
    ctx.y += altura;
  }
}

function rodape(ctx: Ctx, data: DanfeViewData) {
  const temFatura = Boolean(data.fatura) || data.duplicatas.length > 0;

  if (temFatura) {
    tituloBloco(ctx, "Fatura / duplicatas");
    const campos: Campo[] = [];
    if (data.fatura) {
      campos.push({
        label: `Fatura ${data.fatura.numero || ""}`.trim(),
        valor: `Original ${fmtMoney(data.fatura.valorOriginal)} - Desconto ${fmtMoney(data.fatura.desconto)} - Liquido ${fmtMoney(data.fatura.valorLiquido)}`,
      });
    }
    data.duplicatas.forEach((duplicata, indice) => {
      campos.push({
        label: `Duplicata ${duplicata.numero || indice + 1}`,
        valor: `${fmtDateOnly(duplicata.vencimento)} - ${fmtMoney(duplicata.valor)}`,
      });
    });
    emGrupos(ctx, campos, 3);
  }

  if (data.pagamentos.length > 0) {
    tituloBloco(ctx, "Pagamento");
    const campos: Campo[] = data.pagamentos.map((pagamento, indice) => ({
      label: pagamento.descricao || PAGAMENTO_LABEL[pagamento.tipo] || `Meio ${pagamento.tipo}`,
      valor: [
        fmtMoney(pagamento.valor),
        pagamento.bandeira ? `Bandeira ${pagamento.bandeira}` : "",
        pagamento.cnpjCredenciadora ? `Credenciadora ${fmtDoc(pagamento.cnpjCredenciadora)}` : "",
        pagamento.autorizacao ? `Aut. ${pagamento.autorizacao}` : "",
      ].filter(Boolean).join(" - ") || String(indice + 1),
    }));
    emGrupos(ctx, campos, 3);
  }

  const totais = data.totais;
  if (totais.vServ !== 0 || totais.vBCISS !== 0 || totais.vISS !== 0) {
    tituloBloco(ctx, "Calculo do ISSQN");
    linhaDeCampos(ctx, [
      { label: "Inscricao municipal", valor: data.emitenteIm || "-" },
      { label: "Valor total dos servicos", valor: fmtMoney(totais.vServ), alinhamento: "direita" },
      { label: "Base de calculo do ISSQN", valor: fmtMoney(totais.vBCISS), alinhamento: "direita" },
      { label: "Valor do ISSQN", valor: fmtMoney(totais.vISS), alinhamento: "direita" },
    ], colunas(CONTENT_W, [1, 1, 1, 1]));
  }

  tituloBloco(ctx, "Dados adicionais");
  const [colInfo, colFisco] = colunas(CONTENT_W, [2, 1]);

  const avisos: string[] = [];
  if (data.xmlError) avisos.push("Falha ao ler o XML: visualizacao complementada com dados do banco.");
  if (!data.xmlBaseAvailable) avisos.push("XML nao armazenado: esta visualizacao nao substitui um DANFE originado do XML autorizado.");

  const linhasInfo = wrapText(ctx, data.infCpl || "-", ctx.font, VALUE_SIZE, colInfo - 4);
  const linhasAviso = avisos.flatMap((aviso) => wrapText(ctx, aviso, ctx.bold, VALUE_SIZE, colInfo - 4));
  const linhasFisco = wrapText(ctx, data.infAdFisco || "-", ctx.font, VALUE_SIZE, colFisco - 4);
  const linhasNecessarias = Math.max(linhasInfo.length + linhasAviso.length, linhasFisco.length);
  const altura = Math.max(22 * MM, scaled(ctx, LABEL_SIZE + 6 + linhasNecessarias * (VALUE_SIZE + 1.4)));

  if (ctx.y + altura > BOTTOM_LIMIT) ctx.novaPagina();

  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
  linhaVertical(ctx, MARGIN + colInfo, ctx.y, altura);

  texto(ctx, "INFORMACOES COMPLEMENTARES", MARGIN + 2, ctx.y + 2, LABEL_SIZE, ctx.bold);
  let topo = ctx.y + scaled(ctx, LABEL_SIZE + 5);
  linhasInfo.forEach((linha) => {
    texto(ctx, linha, MARGIN + 2, topo, VALUE_SIZE, ctx.font);
    topo += scaled(ctx, VALUE_SIZE + 1.4);
  });
  linhasAviso.forEach((linha) => {
    texto(ctx, linha, MARGIN + 2, topo, VALUE_SIZE, ctx.bold);
    topo += scaled(ctx, VALUE_SIZE + 1.4);
  });

  texto(ctx, "RESERVADO AO FISCO", MARGIN + colInfo + 2, ctx.y + 2, LABEL_SIZE, ctx.bold);
  let topoFisco = ctx.y + scaled(ctx, LABEL_SIZE + 5);
  linhasFisco.forEach((linha) => {
    texto(ctx, linha, MARGIN + colInfo + 2, topoFisco, VALUE_SIZE, ctx.font);
    topoFisco += scaled(ctx, VALUE_SIZE + 1.4);
  });

  ctx.y += altura;
}

/** Fatura, duplicatas e pagamentos sao listas de tamanho variavel. */
function emGrupos(ctx: Ctx, campos: Campo[], porLinha: number) {
  for (let indice = 0; indice < campos.length; indice += porLinha) {
    const grupo = campos.slice(indice, indice + porLinha);
    while (grupo.length < porLinha) grupo.push({ label: "", valor: "" });
    if (ctx.y + scaled(ctx, 20) > BOTTOM_LIMIT) ctx.novaPagina();
    linhaDeCampos(ctx, grupo, colunas(CONTENT_W, grupo.map(() => 1)));
  }
}

async function montar(data: DanfeViewData, totalDeclarado: number, fontScale: DanfeFontScale) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(`DANFE NF-e ${String(data.nfe.numero).padStart(9, "0")}`);
  pdf.setProducer("ERP Oficina");
  pdf.setCreator("ERP Oficina");

  const larguras = colunas(CONTENT_W, COLUNAS_ITENS.map((coluna) => coluna.peso));
  const itens = data.itensDisplay;
  const mostrarRtc = itens.some((item) => item.cst_ibs_cbs || item.cst_is);

  const ctx: Ctx = {
    page: pdf.addPage([PAGE_W, PAGE_H]),
    font,
    bold,
    fontScale,
    y: MARGIN,
    novaPagina: () => {},
  };

  let paginaAtual = 1;
  ctx.novaPagina = () => {
    paginaAtual += 1;
    ctx.page = pdf.addPage([PAGE_W, PAGE_H]);
    ctx.y = MARGIN;
    cabecalho(ctx, data, paginaAtual, Math.max(totalDeclarado, paginaAtual));
    cabecalhoDaTabela(ctx, larguras);
  };

  canhoto(ctx, data);
  cabecalho(ctx, data, 1, totalDeclarado);
  destinatario(ctx, data);
  localDeEntrega(ctx, data);
  calculoDoImposto(ctx, data);
  transportador(ctx, data);

  tituloBloco(ctx, "Dados dos produtos / servicos");
  cabecalhoDaTabela(ctx, larguras);

  if (!itens.length) {
    const altura = scaled(ctx, 12);
    caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
    texto(ctx, "Nenhum item localizado.", MARGIN + 3, ctx.y + 3.5, ITEM_SIZE, ctx.font);
    ctx.y += altura;
  }

  for (const item of itens) {
    const altura = alturaDoItem(ctx, item, larguras);
    if (ctx.y + altura > BOTTOM_LIMIT) ctx.novaPagina();
    desenharItem(ctx, item, larguras, altura);
  }

  if (mostrarRtc) tabelaRtc(ctx, itens);
  rodape(ctx, data);

  return { pdf, paginas: paginaAtual };
}

export async function gerarDanfePdf(
  data: DanfeViewData,
  options: { fontScale?: DanfeFontScale } = {},
): Promise<Uint8Array> {
  const fontScale = options.fontScale ?? DANFE_DEFAULT_FONT_SCALE;
  // Duas passadas: o cabecalho precisa do "FOLHA x/y" antes de sabermos quantas
  // folhas o documento tera. A primeira so conta; a segunda desenha para valer.
  const contagem = await montar(data, 1, fontScale);
  if (contagem.paginas === 1) return contagem.pdf.save();

  const definitivo = await montar(data, contagem.paginas, fontScale);
  return definitivo.pdf.save();
}
