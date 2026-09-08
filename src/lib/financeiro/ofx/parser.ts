/**
 * Leitura de arquivos OFX de banco brasileiro.
 *
 * Atende as duas gerações do formato com o mesmo código:
 *
 *   OFXSGML 1.x .... cabeçalho `CHAVE:VALOR`, tags de folha sem fechamento
 *   OFX 2.x (XML) .. prólogo `<?xml?>`, tudo fechado
 *
 * Não usar parser de XML é decisão, não preguiça: o 1.x — que é o que os bancos
 * daqui exportam — não é XML válido, e qualquer parser estrito recusa o arquivo
 * inteiro por causa de um `<MEMO>` sem `</MEMO>`.
 */

import { ErroDeOfx, type OfxCabecalho, type OfxExtrato, type OfxMovimento } from "./types";
import { parseDataOfx, parseValorParaCentavos } from "./normalize";

/** Um nó do documento: folhas guardam texto, containers guardam filhos. */
interface No {
  nome: string;
  valor: string | null;
  filhos: No[];
}

/**
 * Texto do arquivo, decidindo a codificação pelo conteúdo.
 *
 * O cabeçalho do 1.x declara `CHARSET:1252`, mas nem todo banco respeita o que
 * declarou — há arquivo com cabeçalho 1252 e corpo em UTF-8. Então a declaração
 * é só o desempate: primeiro se tenta UTF-8 estrito, e só quando ele falha o
 * texto é lido como Windows-1252, que aceita qualquer byte.
 *
 * Errar aqui não perde movimento nenhum, mas embaralha acento em MEMO — e MEMO
 * entra no fingerprint, então o mesmo movimento reimportado geraria chave
 * diferente.
 */
export function decodificarOfx(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("windows-1252").decode(buffer);
    } catch {
      return new TextDecoder("latin1").decode(buffer);
    }
  }
}

/** Cabeçalho `CHAVE:VALOR` do OFXSGML, antes do primeiro `<`. */
function lerCabecalhoSgml(conteudo: string): Record<string, string> {
  const inicio = conteudo.indexOf("<");
  const bruto = inicio >= 0 ? conteudo.slice(0, inicio) : conteudo;
  const saida: Record<string, string> = {};

  for (const linha of bruto.split(/\r?\n/)) {
    const casado = /^([A-Z0-9]+):(.*)$/i.exec(linha.trim());
    if (casado) saida[casado[1].toUpperCase()] = casado[2].trim();
  }

  return saida;
}

/** As poucas entidades que aparecem em OFX de banco. */
function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, codigo) => String.fromCodePoint(Number(codigo)))
    .replace(/&amp;/gi, "&");
}

/**
 * Monta a árvore do corpo.
 *
 * A regra que resolve os dois dialetos de uma vez: uma tag seguida de texto é
 * folha e não entra na pilha; uma tag seguida de espaço em branco é container e
 * entra. O `</TAG>` de uma folha (que só o 2.x escreve) não acha par na pilha e
 * é ignorado — é isso que faz o mesmo código ler os dois formatos.
 */
function montarArvore(corpo: string): No {
  const raiz: No = { nome: "#raiz", valor: null, filhos: [] };
  const pilha: No[] = [raiz];

  const tags = /<(\/?)([A-Za-z0-9._:-]+)\s*>([^<]*)/g;
  let casado: RegExpExecArray | null;

  while ((casado = tags.exec(corpo)) != null) {
    const fechamento = casado[1] === "/";
    const nome = casado[2].toUpperCase();
    const conteudo = casado[3].trim();

    if (fechamento) {
      // Fecha o container mais próximo com esse nome. Sem procurar na pilha, a
      // árvore desmontaria em qualquer arquivo com tag de folha fechada.
      for (let i = pilha.length - 1; i > 0; i -= 1) {
        if (pilha[i].nome === nome) {
          pilha.length = i;
          break;
        }
      }
      continue;
    }

    if (conteudo) {
      pilha[pilha.length - 1].filhos.push({
        nome,
        valor: decodificarEntidades(conteudo),
        filhos: [],
      });
      continue;
    }

    const container: No = { nome, valor: null, filhos: [] };
    pilha[pilha.length - 1].filhos.push(container);
    pilha.push(container);
  }

  return raiz;
}

/** Primeiro descendente com esse nome, em largura. */
function primeiro(no: No, nome: string): No | null {
  const fila: No[] = [...no.filhos];
  while (fila.length) {
    const atual = fila.shift()!;
    if (atual.nome === nome) return atual;
    fila.push(...atual.filhos);
  }
  return null;
}

/** Todos os descendentes com esse nome, na ordem do arquivo. */
function todos(no: No, nome: string): No[] {
  const saida: No[] = [];
  for (const filho of no.filhos) {
    if (filho.nome === nome) saida.push(filho);
    saida.push(...todos(filho, nome));
  }
  return saida;
}

/** Valor de uma tag de folha descendente deste nó. */
function valorDe(no: No | null, nome: string): string | null {
  if (!no) return null;
  const achado = primeiro(no, nome);
  const valor = achado?.valor?.trim();
  return valor ? valor : null;
}

/**
 * Lê o arquivo inteiro.
 *
 * Recusa com `ErroDeOfx` o que o usuário precisa corrigir (arquivo que não é
 * OFX, extrato sem movimento). Movimento individual defeituoso — sem data ou
 * sem valor — é descartado em silêncio: o resto do extrato continua útil, e a
 * linha a menos aparece na contagem que a tela mostra.
 */
export function parseOfx(conteudo: string): OfxExtrato {
  if (!conteudo || !conteudo.includes("<")) {
    throw new ErroDeOfx("O arquivo não parece ser um extrato OFX.");
  }

  const cabecalhoSgml = lerCabecalhoSgml(conteudo);
  const inicioCorpo = conteudo.search(/<OFX[\s>]/i);
  const corpo = inicioCorpo >= 0 ? conteudo.slice(inicioCorpo) : conteudo;
  const raiz = montarArvore(corpo);

  const stmtrs = primeiro(raiz, "STMTRS") ?? primeiro(raiz, "CCSTMTRS") ?? raiz;
  const acctFrom = primeiro(raiz, "BANKACCTFROM") ?? primeiro(raiz, "CCACCTFROM");
  const tranList = primeiro(raiz, "BANKTRANLIST") ?? primeiro(raiz, "CCTRANLIST");
  const ledgerBal = primeiro(raiz, "LEDGERBAL");

  const cabecalho: OfxCabecalho = {
    bankId: valorDe(acctFrom, "BANKID"),
    branchId: valorDe(acctFrom, "BRANCHID"),
    acctId: valorDe(acctFrom, "ACCTID"),
    acctType: valorDe(acctFrom, "ACCTTYPE"),
    moeda: valorDe(stmtrs, "CURDEF") ?? cabecalhoSgml.CURDEF ?? null,
    periodoInicio: parseDataOfx(valorDe(tranList, "DTSTART")),
    periodoFim: parseDataOfx(valorDe(tranList, "DTEND")),
    saldoFinalCentavos: parseValorParaCentavos(valorDe(ledgerBal, "BALAMT")),
    saldoFinalEm: parseDataOfx(valorDe(ledgerBal, "DTASOF")),
  };

  const movimentos: OfxMovimento[] = [];
  for (const trn of todos(raiz, "STMTTRN")) {
    const dataPostagem = parseDataOfx(valorDe(trn, "DTPOSTED"));
    const valorCentavos = parseValorParaCentavos(valorDe(trn, "TRNAMT"));
    if (!dataPostagem || valorCentavos == null) continue;

    movimentos.push({
      sequencia: movimentos.length + 1,
      tipoOfx: valorDe(trn, "TRNTYPE"),
      dataPostagem,
      dataDisponivel: parseDataOfx(valorDe(trn, "DTAVAIL")),
      valorCentavos,
      fitid: valorDe(trn, "FITID"),
      checknum: valorDe(trn, "CHECKNUM"),
      refnum: valorDe(trn, "REFNUM"),
      nome: valorDe(trn, "NAME"),
      memo: valorDe(trn, "MEMO"),
    });
  }

  if (movimentos.length === 0) {
    throw new ErroDeOfx("O extrato não tem nenhum movimento para conciliar.");
  }

  // Período ausente é comum em arquivo de banco: vale o intervalo dos próprios
  // movimentos, que é o que a tela precisa mostrar.
  if (!cabecalho.periodoInicio || !cabecalho.periodoFim) {
    const datas = movimentos.map((movimento) => movimento.dataPostagem).sort();
    cabecalho.periodoInicio = cabecalho.periodoInicio ?? datas[0];
    cabecalho.periodoFim = cabecalho.periodoFim ?? datas[datas.length - 1];
  }

  return { cabecalho, movimentos };
}

/**
 * Saldo do início do período, deduzido do saldo final.
 *
 * O OFX 1.x quase nunca traz saldo inicial; o que ele traz é o `LEDGERBAL`, que
 * é o do fim. Como todos os movimentos do período estão no arquivo, o inicial é
 * o final menos a soma deles.
 */
export function saldoInicialCentavos(extrato: OfxExtrato): number | null {
  const { saldoFinalCentavos } = extrato.cabecalho;
  if (saldoFinalCentavos == null) return null;

  const soma = extrato.movimentos.reduce((total, movimento) => total + movimento.valorCentavos, 0);
  return saldoFinalCentavos - soma;
}
