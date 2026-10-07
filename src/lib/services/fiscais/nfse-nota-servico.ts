export type NotaDoServicoNFSe = {
  id: number;
  ordemservicoid: number;
  status: string;
  referencia?: string | null;
  erros?: unknown;
  modelo_emissao?: string | null;
  servico_ids?: number[] | null;
  itens?: Array<{ servicoid: number; ordemservicoid?: number; valor: number }> | null;
};

export type VinculoServicoNFSe = {
  nfse_id: number;
  ordemservico_id: number;
  servico_id: number;
  ativo: boolean;
};

/** Um vínculo ativo vence uma tentativa rejeitada posterior da mesma linha. */
export function notaDoServicoNFSe(
  osId: number,
  servicoId: number,
  notas: NotaDoServicoNFSe[],
  vinculos: VinculoServicoNFSe[],
) {
  const daLinha = vinculos.filter((v) => Number(v.ordemservico_id) === osId && Number(v.servico_id) === servicoId);
  const ids = new Set(daLinha.map((v) => Number(v.nfse_id)));
  const candidatas = notas.filter((n) => {
    if (ids.has(Number(n.id))) return true;
    if (Array.isArray(n.itens) && n.itens.length) {
      return n.itens.some((i) => Number(i.ordemservicoid ?? n.ordemservicoid) === osId && Number(i.servicoid) === servicoId);
    }
    return Number(n.ordemservicoid) === osId && n.servico_ids?.map(Number).includes(servicoId);
  });
  const ativos = new Set(daLinha.filter((v) => v.ativo).map((v) => Number(v.nfse_id)));
  const ocupa = (n: NotaDoServicoNFSe) => ativos.has(Number(n.id))
    || ["PROCESSANDO", "AUTORIZADA", "DENEGADA"].includes(n.status.toUpperCase());
  candidatas.sort((a, b) => Number(ocupa(b)) - Number(ocupa(a)) || Number(b.id) - Number(a.id));
  const nota = candidatas[0] ?? null;
  const item = nota?.itens?.find((i) => Number(i.ordemservicoid ?? nota.ordemservicoid) === osId && Number(i.servicoid) === servicoId);
  return { nota, item };
}
