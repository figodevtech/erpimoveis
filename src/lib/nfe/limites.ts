/**
 * Tamanhos de campo do leiaute da NF-e 4.00.
 *
 * Ficam aqui, num módulo sem dependência de banco nem de React, porque o mesmo
 * número precisa valer nos dois lados: o input limita o que a pessoa digita e
 * o servidor recusa o que passar. Um limite só na tela é um limite que some
 * quando o payload vem de outro lugar.
 */

/** xProd — descrição do item. */
export const LIMITE_XPROD = 120;
