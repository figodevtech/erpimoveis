// Destino da mercadoria no destinatário e o indFinal que ele determina.
//
// Venda e OS não dizem, sozinhas, se o comprador vai revender ou consumir. Ser
// venda, ser OS, ter CNPJ ou ter IE também não dizem: contribuinte do ICMS pode
// comprar para uso próprio. Por isso o indFinal da NF-e sai de uma escolha
// explícita, feita na emissão, e nunca de inferência.
//
// A única regra estrutural é a do não contribuinte (indIEDest 9): ele é sempre
// consumidor final, então revenda não é opção para ele.

export type DestinoMercadoria =
  | 'REVENDA_INDUSTRIALIZACAO'
  | 'USO_CONSUMO'
  | 'ATIVO_IMOBILIZADO'
  | 'OUTRO';

export const DESTINO_MERCADORIA_OPCOES: Array<{
  value: DestinoMercadoria;
  label: string;
  descricao: string;
  indFinal: 0 | 1 | null;
}> = [
  {
    value: 'REVENDA_INDUSTRIALIZACAO',
    label: 'Revenda ou industrialização',
    descricao: 'O destinatário vai revender a mercadoria ou usá-la na produção (indFinal 0).',
    indFinal: 0,
  },
  {
    value: 'USO_CONSUMO',
    label: 'Uso e consumo',
    descricao: 'O destinatário vai consumir a mercadoria (indFinal 1).',
    indFinal: 1,
  },
  {
    value: 'ATIVO_IMOBILIZADO',
    label: 'Ativo imobilizado',
    descricao: 'A mercadoria entra no ativo do destinatário (indFinal 1).',
    indFinal: 1,
  },
  {
    value: 'OUTRO',
    label: 'Outro',
    descricao: 'Informe se a operação é com consumidor final.',
    indFinal: null,
  },
];

export function normalizarDestinoMercadoria(value: unknown): DestinoMercadoria | null {
  const texto = String(value ?? '').trim().toUpperCase();
  return DESTINO_MERCADORIA_OPCOES.some((opcao) => opcao.value === texto)
    ? (texto as DestinoMercadoria)
    : null;
}

/**
 * indFinal da operação. `null` quando a emissão ainda não tem informação para
 * decidir — quem chama deve cobrar a escolha do usuário, não presumir.
 */
export function indFinalDoDestino(
  destino: unknown,
  consumidorFinalInformado?: boolean | null,
): 0 | 1 | null {
  const normalizado = normalizarDestinoMercadoria(destino);
  if (!normalizado) return null;
  const opcao = DESTINO_MERCADORIA_OPCOES.find((item) => item.value === normalizado)!;
  if (opcao.indFinal !== null) return opcao.indFinal;
  return typeof consumidorFinalInformado === 'boolean' ? (consumidorFinalInformado ? 1 : 0) : null;
}
