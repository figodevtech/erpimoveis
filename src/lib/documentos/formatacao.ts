// Formatação dos valores que entram nos documentos. Tudo já sai como texto
// pronto: o modelo não formata nada, só posiciona.

import { formatCpfCnpj, onlyDigits } from "@/lib/ordens/checklist-documento";

export const FUSO_DOCUMENTO = "America/Fortaleza";

const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function texto(valor: unknown): string {
  if (valor == null) return "";
  return String(valor).trim();
}

export function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export function arredondar(valor: number) {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;
}

export function moeda(valor: unknown): string {
  return numero(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function quantidade(valor: unknown): string {
  return numero(valor).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Dia (AAAA-MM-DD) no fuso da operação. Coluna `date` não muda de dia. */
function diaNoFuso(valor: unknown): string | null {
  if (valor == null || valor === "") return null;
  if (typeof valor === "string" && DIA_ISO.test(valor)) return valor;
  const data = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DOCUMENTO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

export function data(valor: unknown): string {
  const dia = diaNoFuso(valor);
  if (!dia) return "";
  const [, ano, mes, d] = DIA_ISO.exec(dia)!;
  return `${d}/${mes}/${ano}`;
}

export function dataHora(valor: unknown): string {
  if (valor == null || valor === "") return "";
  if (typeof valor === "string" && DIA_ISO.test(valor)) return data(valor);
  const instante = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(instante.getTime())) return "";
  return instante.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO_DOCUMENTO });
}

/** "14 de outubro de 2026"; o primeiro dia sai como "1º". */
export function dataPorExtenso(valor: unknown): string {
  const dia = diaNoFuso(valor);
  if (!dia) return "";
  const [, ano, mes, d] = DIA_ISO.exec(dia)!;
  const numeroDoDia = Number(d);
  return `${numeroDoDia === 1 ? "1º" : numeroDoDia} de ${MESES[Number(mes) - 1]} de ${ano}`;
}

/** Ano (AAAA) no fuso da operação. */
export function ano(valor: unknown): string {
  const dia = diaNoFuso(valor);
  return dia ? dia.slice(0, 4) : "";
}

export function documento(valor: unknown): string {
  return texto(valor) ? formatCpfCnpj(valor) : "";
}

export function telefone(valor: unknown): string {
  const digitos = onlyDigits(valor);
  if (digitos.length === 11) return digitos.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (digitos.length === 10) return digitos.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return texto(valor);
}

export function cep(valor: unknown): string {
  const digitos = onlyDigits(valor);
  return digitos.length === 8 ? digitos.replace(/^(\d{5})(\d{3})$/, "$1-$2") : texto(valor);
}

/** `EM_ANDAMENTO` → "Em andamento". */
export function rotuloDeEnum(valor: unknown): string {
  const t = texto(valor).replace(/_/g, " ").toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

export function juntar(partes: unknown[], separador = ", "): string {
  return partes.map(texto).filter(Boolean).join(separador);
}

/* ---------------------------- valor por extenso ---------------------------- */

const UNIDADES = [
  "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos",
];

/** 1 a 999. */
function ateMil(n: number): string {
  if (n === 100) return "cem";
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

const ESCALAS: Array<[number, string, string]> = [
  [1_000_000_000, "bilhão", "bilhões"],
  [1_000_000, "milhão", "milhões"],
  [1_000, "mil", "mil"],
];

/** Inteiro positivo por extenso: "mil duzentos e cinquenta", "dois milhões e quinhentos mil". */
function inteiroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const grupos: Array<{ valor: number; texto: string }> = [];
  let resto = n;
  for (const [escala, singular, plural] of ESCALAS) {
    const q = Math.floor(resto / escala);
    resto %= escala;
    if (!q) continue;
    const nome = q === 1 ? singular : plural;
    // "mil", não "um mil".
    grupos.push({ valor: q, texto: escala === 1_000 && q === 1 ? nome : `${ateMil(q)} ${nome}` });
  }
  if (resto) grupos.push({ valor: resto, texto: ateMil(resto) });

  return grupos.reduce((frase, grupo, i) => {
    if (i === 0) return grupo.texto;
    // O "e" só liga o último grupo quando ele é redondo ou pequeno:
    // "mil e cem", "mil e vinte", mas "mil duzentos e cinquenta".
    const ultimo = i === grupos.length - 1;
    const liga = ultimo && (grupo.valor < 100 || grupo.valor % 100 === 0);
    return `${frase}${liga ? " e " : " "}${grupo.texto}`;
  }, "");
}

/** R$ 1.250,50 → "mil duzentos e cinquenta reais e cinquenta centavos". */
export function valorPorExtenso(valor: unknown): string {
  const centavosTotais = Math.round(Math.abs(numero(valor)) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;

  const parteReais = reais
    ? `${inteiroPorExtenso(reais)}${reais % 1_000_000 === 0 ? " de" : ""} ${reais === 1 ? "real" : "reais"}`
    : "";
  const parteCentavos = centavos ? `${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}` : "";

  if (parteReais && parteCentavos) return `${parteReais} e ${parteCentavos}`;
  return parteReais || parteCentavos || "zero reais";
}
