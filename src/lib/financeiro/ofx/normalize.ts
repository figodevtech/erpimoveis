/**
 * Normalizações do extrato: texto, data e dinheiro.
 *
 * Tudo aqui é função pura e sem dependência de Node — o matcher roda nas rotas
 * e os testes rodam sem banco.
 */

/**
 * Texto pronto para comparação: sem acento, sem pontuação, caixa alta e com os
 * espaços colapsados.
 *
 * O extrato escreve a mesma contraparte de três jeitos ("PIX ENVIADO - JOÃO",
 * "Pix enviado  Joao", "PIX  ENVIADO/JOAO") e a semelhança de descrição só
 * significa alguma coisa depois que essas diferenças somem.
 */
export function normalizarTexto(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Palavras com significado, para comparar duas descrições. */
function tokens(valor: string | null | undefined): string[] {
  const normalizado = normalizarTexto(valor);
  if (!normalizado) return [];
  // Palavras de uma letra e conectivos não distinguem nada, e o extrato é
  // cheio deles ("DE", "DA", "P/", "REF").
  const vazias = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "REF", "P", "PARA", "EM", "NO", "NA"]);
  return normalizado
    .split(" ")
    .filter((token) => token.length > 1 && !vazias.has(token));
}

/**
 * Quanto duas descrições se parecem, de 0 a 1.
 *
 * Coeficiente de Dice sobre o conjunto de palavras: mede quantas palavras as
 * duas compartilham, sem se importar com a ordem. Serve exatamente para o caso
 * que interessa — "PAGAMENTO BOLETO ENERGISA" contra "ENERGISA AGOSTO" — e não
 * pretende ser mais do que um dos ingredientes do score.
 */
export function similaridadeDeTexto(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const tokensA = new Set(tokens(a));
  const tokensB = new Set(tokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let comuns = 0;
  for (const token of tokensA) if (tokensB.has(token)) comuns += 1;

  return (2 * comuns) / (tokensA.size + tokensB.size);
}

/**
 * Data OFX reduzida ao dia local.
 *
 * O formato é `YYYYMMDDHHMMSS[.mmm][-3:BRT]`, e os oito primeiros dígitos JÁ
 * são o dia no fuso que o banco declarou logo depois. Converter para UTC e
 * voltar só criaria a chance de o movimento andar um dia — que é justamente o
 * erro que quebraria toda a conciliação por data.
 */
export function parseDataOfx(valor: string | null | undefined): string | null {
  const bruto = String(valor ?? "").trim();
  const casado = /^(\d{4})(\d{2})(\d{2})/.exec(bruto);
  if (!casado) return null;

  const [, ano, mes, dia] = casado;
  const mesNumero = Number(mes);
  const diaNumero = Number(dia);
  if (mesNumero < 1 || mesNumero > 12 || diaNumero < 1 || diaNumero > 31) return null;

  return `${ano}-${mes}-${dia}`;
}

/** Distância em dias entre duas datas `yyyy-mm-dd`. */
export function diferencaEmDias(a: string, b: string): number {
  const inicio = Date.parse(`${a}T12:00:00Z`);
  const fim = Date.parse(`${b}T12:00:00Z`);
  if (Number.isNaN(inicio) || Number.isNaN(fim)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(fim - inicio) / 86_400_000);
}

/** Soma dias a uma data `yyyy-mm-dd`, devolvendo outra `yyyy-mm-dd`. */
export function somarDias(data: string, dias: number): string {
  const base = new Date(`${data}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return data;
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/**
 * Valor monetário em centavos inteiros.
 *
 * Feito por texto, nunca por `Number()`: 0.1 + 0.2 basta para explicar por quê,
 * e comparação de extrato com título é igualdade exata.
 *
 * O OFX não usa separador de milhar em `TRNAMT`, mas alguns bancos brasileiros
 * escrevem no padrão local. Por isso a regra é sempre "o último separador é o
 * decimal, os anteriores são milhar" — que acerta `-1234.56`, `-1.234,56` e
 * `-1234,56` sem precisar saber de qual banco veio.
 */
export function parseValorParaCentavos(valor: string | number | null | undefined): number | null {
  if (valor == null) return null;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    return Math.round(valor * 100);
  }

  let texto = String(valor).trim();
  if (!texto) return null;

  const negativo = texto.startsWith("-") || /^\(.*\)$/.test(texto);
  texto = texto.replace(/[^\d.,]/g, "");
  if (!texto) return null;

  const ultimoSeparador = Math.max(texto.lastIndexOf("."), texto.lastIndexOf(","));
  let inteiros: string;
  let decimais: string;

  if (ultimoSeparador < 0) {
    inteiros = texto;
    decimais = "";
  } else {
    inteiros = texto.slice(0, ultimoSeparador).replace(/[.,]/g, "");
    decimais = texto.slice(ultimoSeparador + 1).replace(/[.,]/g, "");
  }

  if (!/^\d*$/.test(inteiros) || !/^\d*$/.test(decimais)) return null;
  if (!inteiros && !decimais) return null;

  // Arredonda na terceira casa em vez de truncar: extrato com mais de duas
  // casas é raro, mas descartar a fração calada muda o valor do movimento.
  const milesimos = Number(`${inteiros || "0"}${(decimais + "000").slice(0, 3)}`);
  if (!Number.isFinite(milesimos)) return null;
  const centavos = Math.round(milesimos / 10);

  return negativo ? -centavos : centavos;
}

/** Centavos inteiros a partir de um valor em reais vindo do banco de dados. */
export function reaisParaCentavos(valor: number | string | null | undefined): number {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero)) return 0;
  return Math.round(numero * 100);
}

/** Reais a partir de centavos, para gravar em coluna `numeric(14,2)`. */
export function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100;
}
