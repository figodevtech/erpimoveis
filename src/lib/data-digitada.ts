/**
 * Data digitada no teclado, em pt-BR, sem passar pelo calendário.
 *
 * Escolher no calendário é bom para uma data perto de hoje e péssimo para trinta:
 * reparcelar um título para daqui a dois anos é navegar 24 meses, uma parcela de
 * cada vez. Digitar "21/09/2026" resolve em oito teclas, e o calendário continua
 * ali para quem quer olhar o mês.
 *
 * O formato de ida e volta é o mesmo do resto do app: "AAAA-MM-DD", sem hora e
 * sem fuso — quem monta `Date` a partir dele já faz o parse manual, porque
 * `new Date("2026-09-21")` seria lido como UTC e voltaria um dia em Fortaleza.
 */

/** Só dígitos, no máximo oito: DDMMAAAA. */
function digitosDe(texto: string): string {
  return texto.replace(/\D/g, "").slice(0, 8);
}

/**
 * Põe as barras enquanto a pessoa digita, sem nunca inventar dígito.
 *
 * Apagar também passa por aqui: "21/09/2" perde o "2" e vira "21/09/", que a
 * máscara devolve como "21/09" — a barra sozinha não sobra no campo.
 */
export function mascararDataDigitada(bruto: string): string {
  const digitos = digitosDe(bruto);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

/**
 * O que a pessoa digitou vira "AAAA-MM-DD" — ou `null`, se não for data.
 *
 * Aceita o ano em dois dígitos ("21/09/26") porque é como se escreve data à mão
 * e economiza duas teclas por parcela; 00–99 viram 2000–2099, que cobre a vida
 * inteira de um parcelamento. Quem precisa de 1998 digita os quatro dígitos.
 *
 * Dia que não existe no mês é recusado em vez de transbordar: 31/02 seria 02/03
 * se fosse direto para `new Date`, e o usuário só descobriria depois de salvo.
 */
export function interpretarDataDigitada(texto: string): string | null {
  const digitos = digitosDe(texto);
  if (digitos.length !== 6 && digitos.length !== 8) return null;

  const dia = Number(digitos.slice(0, 2));
  const mes = Number(digitos.slice(2, 4));
  const ano =
    digitos.length === 8 ? Number(digitos.slice(4)) : 2000 + Number(digitos.slice(4, 6));

  if (!dia || !mes || mes > 12) return null;
  // Ano de dois dígitos nunca cai aqui; o de quatro segura digitação pela metade
  // ("21/09/0026") e datas absurdas que só atrapalhariam relatório.
  if (ano < 1900 || ano > 2999) return null;

  const ultimoDiaDoMes = new Date(ano, mes, 0).getDate();
  if (dia > ultimoDiaDoMes) return null;

  const zero = (n: number) => String(n).padStart(2, "0");
  return `${ano}-${zero(mes)}-${zero(dia)}`;
}

/** "AAAA-MM-DD" de volta para o campo, como "DD/MM/AAAA". */
export function formatarDataDigitada(valor: string | undefined | null): string {
  if (!valor) return "";
  const [ano, mes, dia] = valor.split("-");
  if (!ano || !mes || !dia) return "";
  return `${dia}/${mes}/${ano}`;
}
