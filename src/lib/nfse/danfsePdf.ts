import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { DanfseViewData } from "@/lib/nfse/danfseDados";

/**
 * DANFSe vetorial montado com pdf-lib.
 *
 * Existe porque nem toda prefeitura entrega o PDF da nota: Cabedelo e a NFS-e
 * Nacional publicam so um link de consulta, e sem um arquivo nao havia o que
 * anexar na OS. O documento aqui e auxiliar — quem vale e a nota registrada na
 * prefeitura —, entao o rodape traz sempre o endereco de consulta e o codigo de
 * verificacao, que sao o que permite conferir a autenticidade.
 */

const MM = 2.834645669;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 10 * MM;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_H - MARGIN;

const LABEL_SIZE = 6;
const VALUE_SIZE = 8;

const BLACK = rgb(0, 0, 0);
const CINZA = rgb(0.45, 0.45, 0.45);
const FUNDO = rgb(0.93, 0.93, 0.93);
const LINE = 0.6;

/** WinAnsi nao cobre tipografia unicode; troca o que costuma vir do cadastro. */
function safe(value: unknown) {
  return String(value ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

function fmtMoney(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "-";
}

function fmtQuantidade(value: number) {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function fmtDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR");
}

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  /** Cursor medido a partir do topo da folha. */
  y: number;
};

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const limpo = safe(text).replace(/\s+/g, " ").trim();
  if (!limpo) return [""];

  const linhas: string[] = [];
  let atual = "";

  for (const palavra of limpo.split(" ")) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (font.widthOfTextAtSize(tentativa, size) <= maxWidth) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);

    // Palavra sozinha maior que a coluna (URL, codigo): quebra por caractere.
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

/** Respeita as quebras de linha do texto original antes de quebrar por largura. */
function wrapParagrafos(text: string, font: PDFFont, size: number, maxWidth: number) {
  return safe(text)
    .split(/\r?\n/)
    .flatMap((paragrafo) => wrap(paragrafo, font, size, maxWidth));
}

function texto(ctx: Ctx, value: string, x: number, top: number, size: number, font: PDFFont, cor = BLACK) {
  ctx.page.drawText(safe(value), { x, y: PAGE_H - top - size, size, font, color: cor });
}

function textoDireita(ctx: Ctx, value: string, xFim: number, top: number, size: number, font: PDFFont) {
  texto(ctx, value, xFim - font.widthOfTextAtSize(safe(value), size), top, size, font);
}

function textoCentro(ctx: Ctx, value: string, x: number, largura: number, top: number, size: number, font: PDFFont, cor = BLACK) {
  const w = font.widthOfTextAtSize(safe(value), size);
  texto(ctx, value, x + (largura - w) / 2, top, size, font, cor);
}

function caixa(ctx: Ctx, x: number, top: number, largura: number, altura: number, fundo?: ReturnType<typeof rgb>) {
  ctx.page.drawRectangle({
    x,
    y: PAGE_H - top - altura,
    width: largura,
    height: altura,
    borderWidth: LINE,
    borderColor: BLACK,
    ...(fundo ? { color: fundo } : {}),
  });
}

function novaPagina(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = MARGIN;
}

/** Abre outra folha quando o bloco nao cabe inteiro no que sobrou desta. */
function garantirEspaco(ctx: Ctx, altura: number) {
  if (ctx.y + altura > BOTTOM_LIMIT) novaPagina(ctx);
}

type Campo = { label: string; valor: string; peso: number };

/** Uma faixa de celulas rotuladas, com bordas — o bloco padrao do documento. */
function linhaDeCampos(ctx: Ctx, campos: Campo[]) {
  const pesoTotal = campos.reduce((soma, campo) => soma + campo.peso, 0);
  const larguras = campos.map((campo) => (campo.peso / pesoTotal) * CONTENT_W);
  const layouts = campos.map((campo, indice) => ({
    valores: wrap(campo.valor || "-", ctx.font, VALUE_SIZE, larguras[indice] - 6),
  }));
  const maxLinhas = Math.max(1, ...layouts.map((layout) => layout.valores.length));
  const altura = 6 + LABEL_SIZE + 2 + maxLinhas * (VALUE_SIZE + 2);

  garantirEspaco(ctx, altura);
  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);

  let x = MARGIN;
  campos.forEach((campo, indice) => {
    if (indice > 0) {
      ctx.page.drawLine({
        start: { x, y: PAGE_H - ctx.y },
        end: { x, y: PAGE_H - ctx.y - altura },
        thickness: LINE,
        color: BLACK,
      });
    }
    texto(ctx, campo.label.toUpperCase(), x + 3, ctx.y + 3, LABEL_SIZE, ctx.bold, CINZA);
    layouts[indice].valores.forEach((linha, ordem) => {
      texto(ctx, linha, x + 3, ctx.y + 5 + LABEL_SIZE + 2 + ordem * (VALUE_SIZE + 2), VALUE_SIZE, ctx.font);
    });
    x += larguras[indice];
  });

  ctx.y += altura;
}

function tituloSecao(ctx: Ctx, titulo: string) {
  const altura = LABEL_SIZE + 8;
  // Reserva o titulo mais uma faixa de campos: titulo sozinho no pe da folha,
  // com o conteudo na seguinte, e pior que quebrar antes.
  garantirEspaco(ctx, altura + 34);
  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura, FUNDO);
  texto(ctx, titulo.toUpperCase(), MARGIN + 3, ctx.y + 4, LABEL_SIZE + 0.5, ctx.bold);
  ctx.y += altura;
}

/** Bloco de texto livre com moldura, usado na discriminacao e nas observacoes. */
function blocoTexto(ctx: Ctx, conteudo: string) {
  const linhas = wrapParagrafos(conteudo, ctx.font, VALUE_SIZE, CONTENT_W - 8);
  const alturaLinha = VALUE_SIZE + 2.5;

  let restantes = linhas;
  while (restantes.length) {
    const disponivel = Math.floor((BOTTOM_LIMIT - ctx.y - 8) / alturaLinha);
    if (disponivel < 1) {
      novaPagina(ctx);
      continue;
    }
    const bloco = restantes.slice(0, disponivel);
    restantes = restantes.slice(disponivel);

    const altura = 8 + bloco.length * alturaLinha;
    caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
    bloco.forEach((linha, ordem) => {
      texto(ctx, linha, MARGIN + 4, ctx.y + 4 + ordem * alturaLinha, VALUE_SIZE, ctx.font);
    });
    ctx.y += altura;

    if (restantes.length) novaPagina(ctx);
  }
}

function avisoFiscal(ctx: Ctx, data: DanfseViewData) {
  const mensagens: string[] = [];
  if (data.homologacao) mensagens.push("EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL");
  if (data.isCancelada) mensagens.push("NOTA FISCAL DE SERVICO CANCELADA");
  else if (!data.isAutorizada) mensagens.push(`SEM VALOR FISCAL - ${data.status || "NAO AUTORIZADA"}`);
  if (!mensagens.length) return;

  for (const mensagem of mensagens) {
    const altura = 16;
    garantirEspaco(ctx, altura + 4);
    ctx.page.drawRectangle({
      x: MARGIN,
      y: PAGE_H - ctx.y - altura,
      width: CONTENT_W,
      height: altura,
      borderWidth: 1.5,
      borderColor: BLACK,
    });
    textoCentro(ctx, mensagem, MARGIN, CONTENT_W, ctx.y + 5, 8.5, ctx.bold);
    ctx.y += altura + 3;
  }
}

async function qrDaConsulta(ctx: Ctx, url: string) {
  if (!url) return null;
  try {
    const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 0, width: 240 });
    const base64 = dataUrl.split(",")[1] ?? "";
    return await ctx.doc.embedPng(Buffer.from(base64, "base64"));
  } catch {
    // Sem QR o documento continua conferivel pelo endereco impresso no rodape.
    return null;
  }
}

/**
 * Cabecalho: prestador a esquerda, identificacao da nota e QR a direita.
 *
 * A altura sai da medicao das duas colunas, nunca de um valor fixo — razao
 * social longa e endereco completo quebram em varias linhas, e com moldura fixa
 * o texto escapava da caixa.
 */
async function cabecalho(ctx: Ctx, data: DanfseViewData) {
  const larguraDireita = 62 * MM;
  const larguraEsquerda = CONTENT_W - larguraDireita;
  const alturaInfo = VALUE_SIZE + 2.5;

  const linhasNome = wrap(data.prestador.nome || "-", ctx.bold, 10, larguraEsquerda - 8);
  const linhasPrestador = [
    `CNPJ: ${data.prestador.documento || "-"}`,
    `Inscricao municipal: ${data.prestador.inscricaoMunicipal || "-"}`,
    data.prestador.endereco,
    data.prestador.municipio,
    [data.prestador.telefone, data.prestador.email].filter(Boolean).join(" - "),
  ]
    .filter(Boolean)
    .flatMap((linha) => wrap(linha, ctx.font, VALUE_SIZE, larguraEsquerda - 8));

  const linhasCodigo = wrap(data.codigoVerificacao || "-", ctx.bold, VALUE_SIZE, larguraDireita - 8);
  const linhasEmissao = wrap(fmtDate(data.dataEmissao), ctx.font, VALUE_SIZE, larguraDireita - 8);

  const alturaEsquerda = 5 + (LABEL_SIZE + 4) + linhasNome.length * 12 + linhasPrestador.length * alturaInfo + 5;
  const alturaTextoDireita = 5 + 14 + 15
    + (LABEL_SIZE + 2) + linhasEmissao.length * alturaInfo + 3
    + (LABEL_SIZE + 2) + linhasCodigo.length * alturaInfo + 4;
  const ladoQr = data.urlConsulta ? 20 * MM : 0;
  const altura = Math.max(alturaEsquerda, alturaTextoDireita + ladoQr + 5, 30 * MM);

  garantirEspaco(ctx, altura);
  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
  ctx.page.drawLine({
    start: { x: MARGIN + larguraEsquerda, y: PAGE_H - ctx.y },
    end: { x: MARGIN + larguraEsquerda, y: PAGE_H - ctx.y - altura },
    thickness: LINE,
    color: BLACK,
  });

  let topo = ctx.y + 5;
  texto(ctx, "PRESTADOR DE SERVICOS", MARGIN + 4, topo, LABEL_SIZE, ctx.bold, CINZA);
  topo += LABEL_SIZE + 4;

  linhasNome.forEach((linha) => {
    texto(ctx, linha, MARGIN + 4, topo, 10, ctx.bold);
    topo += 12;
  });
  linhasPrestador.forEach((linha) => {
    texto(ctx, linha, MARGIN + 4, topo, VALUE_SIZE, ctx.font);
    topo += alturaInfo;
  });

  const xDireita = MARGIN + larguraEsquerda;
  let topoDireita = ctx.y + 5;
  textoCentro(ctx, "NFS-e", xDireita, larguraDireita, topoDireita, 11, ctx.bold);
  topoDireita += 14;
  textoCentro(ctx, `Numero ${data.numero || "-"}`, xDireita, larguraDireita, topoDireita, 12, ctx.bold);
  topoDireita += 15;

  const rotulado = (rotulo: string, linhas: string[]) => {
    textoCentro(ctx, rotulo, xDireita, larguraDireita, topoDireita, LABEL_SIZE, ctx.bold, CINZA);
    topoDireita += LABEL_SIZE + 2;
    linhas.forEach((linha) => {
      textoCentro(ctx, linha, xDireita, larguraDireita, topoDireita, VALUE_SIZE, ctx.bold);
      topoDireita += alturaInfo;
    });
    topoDireita += 3;
  };

  rotulado("EMISSAO", linhasEmissao);
  rotulado("CODIGO DE VERIFICACAO", linhasCodigo);

  const qr = ladoQr ? await qrDaConsulta(ctx, data.urlConsulta) : null;
  if (qr) {
    const lado = Math.min(ladoQr, ctx.y + altura - topoDireita - 4);
    if (lado > 0) {
      ctx.page.drawImage(qr, {
        x: xDireita + (larguraDireita - lado) / 2,
        y: PAGE_H - topoDireita - lado,
        width: lado,
        height: lado,
      });
    }
  }

  ctx.y += altura;
}

function tabelaDeServicos(ctx: Ctx, data: DanfseViewData) {
  const pesos = [58, 10, 16, 16];
  const larguras = pesos.map((peso) => (peso / pesos.reduce((a, b) => a + b, 0)) * CONTENT_W);
  const alturaCabecalho = LABEL_SIZE + 8;

  const desenharCabecalho = () => {
    caixa(ctx, MARGIN, ctx.y, CONTENT_W, alturaCabecalho, FUNDO);
    const rotulos = ["DISCRIMINACAO", "QTD", "VALOR UNIT.", "VALOR TOTAL"];
    let x = MARGIN;
    rotulos.forEach((rotulo, indice) => {
      if (indice === 0) texto(ctx, rotulo, x + 3, ctx.y + 4, LABEL_SIZE, ctx.bold);
      else textoDireita(ctx, rotulo, x + larguras[indice] - 3, ctx.y + 4, LABEL_SIZE, ctx.bold);
      x += larguras[indice];
    });
    ctx.y += alturaCabecalho;
  };

  garantirEspaco(ctx, alturaCabecalho + 30);
  desenharCabecalho();

  for (const item of data.itens) {
    const linhas = wrap(item.descricao, ctx.font, VALUE_SIZE, larguras[0] - 6);
    const altura = 6 + linhas.length * (VALUE_SIZE + 2);

    if (ctx.y + altura > BOTTOM_LIMIT) {
      novaPagina(ctx);
      desenharCabecalho();
    }

    caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
    linhas.forEach((linha, ordem) => {
      texto(ctx, linha, MARGIN + 3, ctx.y + 3 + ordem * (VALUE_SIZE + 2), VALUE_SIZE, ctx.font);
    });

    let x = MARGIN + larguras[0];
    const valores = [fmtQuantidade(item.quantidade), fmtMoney(item.valorUnitario), fmtMoney(item.valorTotal)];
    valores.forEach((valor, indice) => {
      textoDireita(ctx, valor, x + larguras[indice + 1] - 3, ctx.y + 3, VALUE_SIZE, ctx.font);
      x += larguras[indice + 1];
    });

    ctx.y += altura;
  }
}

function rodape(ctx: Ctx, data: DanfseViewData) {
  const aviso = data.urlConsulta
    ? `Documento auxiliar gerado pelo sistema a partir da NFS-e registrada em ${data.municipioLabel || "sua prefeitura"}. `
      + `A nota valida e a que consta no portal: confira pelo codigo de verificacao em ${data.urlConsulta}`
    : `Documento auxiliar gerado pelo sistema a partir da NFS-e registrada em ${data.municipioLabel || "sua prefeitura"}. `
      + "A nota valida e a que consta no portal da prefeitura, conferivel pelo codigo de verificacao.";

  const linhas = wrap(aviso, ctx.font, 6.5, CONTENT_W - 8);
  const altura = 8 + linhas.length * 9;

  garantirEspaco(ctx, altura);
  caixa(ctx, MARGIN, ctx.y, CONTENT_W, altura);
  linhas.forEach((linha, ordem) => {
    texto(ctx, linha, MARGIN + 4, ctx.y + 4 + ordem * 9, 6.5, ctx.font, CINZA);
  });
  ctx.y += altura;
}

export async function gerarDanfsePdf(data: DanfseViewData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const ctx: Ctx = { doc, page, font, bold, y: MARGIN };

  textoCentro(
    ctx,
    "DANFSe - DOCUMENTO AUXILIAR DA NOTA FISCAL DE SERVICO ELETRONICA",
    MARGIN,
    CONTENT_W,
    ctx.y,
    9.5,
    bold,
  );
  ctx.y += 14;
  if (data.municipioLabel) {
    textoCentro(ctx, data.municipioLabel, MARGIN, CONTENT_W, ctx.y, 8, font, CINZA);
    ctx.y += 12;
  }

  avisoFiscal(ctx, data);
  await cabecalho(ctx, data);

  tituloSecao(ctx, "Tomador de servicos");
  linhaDeCampos(ctx, [
    { label: "Nome / Razao social", valor: data.tomador.nome, peso: 62 },
    { label: "CPF / CNPJ", valor: data.tomador.documento, peso: 38 },
  ]);
  linhaDeCampos(ctx, [
    { label: "Endereco", valor: data.tomador.endereco, peso: 62 },
    { label: "Municipio / UF", valor: data.tomador.municipio, peso: 38 },
  ]);
  linhaDeCampos(ctx, [
    { label: "Telefone", valor: data.tomador.telefone, peso: 38 },
    { label: "E-mail", valor: data.tomador.email, peso: 62 },
  ]);

  tituloSecao(ctx, "Servicos prestados");
  tabelaDeServicos(ctx, data);

  if (data.discriminacao) {
    tituloSecao(ctx, "Discriminacao dos servicos");
    blocoTexto(ctx, data.discriminacao);
  }

  tituloSecao(ctx, "Tributacao do ISS");
  linhaDeCampos(ctx, [
    { label: "Item da lista de servico", valor: data.itemListaServico, peso: 26 },
    { label: "CNAE", valor: data.codigoCnae, peso: 24 },
    { label: "Natureza da operacao", valor: data.naturezaOperacao, peso: 50 },
  ]);
  linhaDeCampos(ctx, [
    { label: "Valor dos servicos (R$)", valor: fmtMoney(data.valorServicos), peso: 30 },
    { label: "Aliquota ISS", valor: data.aliquotaIss == null ? "-" : `${fmtMoney(data.aliquotaIss)}%`, peso: 20 },
    { label: "Valor do ISS (R$)", valor: data.valorIss == null ? "-" : fmtMoney(data.valorIss), peso: 25 },
    { label: "ISS retido", valor: data.issRetido ? "Sim" : "Nao", peso: 25 },
  ]);
  linhaDeCampos(ctx, [
    {
      label: "Valor liquido da nota (R$)",
      valor: fmtMoney(data.issRetido && data.valorIss != null ? data.valorServicos - data.valorIss : data.valorServicos),
      peso: 100,
    },
  ]);

  if (data.informacoesComplementares) {
    tituloSecao(ctx, "Informacoes complementares");
    blocoTexto(ctx, data.informacoesComplementares);
  }

  tituloSecao(ctx, "Outras informacoes");
  linhaDeCampos(ctx, [
    { label: "Ordem de servico", valor: data.ordemServicoId ? `#${data.ordemServicoId}` : "-", peso: 25 },
    { label: "Situacao", valor: data.status || "-", peso: 25 },
    { label: "Referencia", valor: data.referencia, peso: 50 },
  ]);

  ctx.y += 4;
  rodape(ctx, data);

  return doc.save();
}
