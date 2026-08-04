/**
 * Conversões de data entre a API, o `<input type="date">` e o estado do form.
 *
 * A API devolve tanto timestamps com fuso (`...Z`) quanto strings sem fuso. Ler
 * as segundas com `new Date()` direto faz o navegador assumir UTC e a data
 * "andar" um dia para trás no horário de Fortaleza — por isso o parse manual.
 */

export function parseLocalDateTime(valor: string): Date | undefined {
  if (!valor) return undefined;

  const [parteData, parteHora] = valor.split("T");
  if (!parteData || !parteHora) return undefined;

  const [ano, mes, dia] = parteData.split("-").map(Number);
  const [hora, minuto] = parteHora.split(":").map(Number);

  if (!ano || !mes || !dia) return undefined;
  if (hora == null || minuto == null) return undefined;

  return new Date(ano, mes - 1, dia, hora, minuto, 0, 0);
}

export function paraValorDeInputDate(data: Date | undefined): string {
  if (!data) return "";
  const zero = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${zero(data.getMonth() + 1)}-${zero(data.getDate())}`;
}

export function paraDataDaApi(valor: unknown): Date | undefined {
  if (!valor) return undefined;
  if (valor instanceof Date) return valor;
  if (typeof valor !== "string") return undefined;

  const temFuso = valor.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(valor);
  if (temFuso) return new Date(valor);

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor)) {
    return parseLocalDateTime(valor.slice(0, 16));
  }

  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? undefined : data;
}
