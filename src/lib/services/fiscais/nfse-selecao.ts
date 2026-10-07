import type { NFSeItemEmissao } from "./nfse-service";

export class SelecaoNFSeError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "SelecaoNFSeError";
  }
}

export function chaveServicoNFSe(osId: number, servicoId: number) {
  return `${osId}:${servicoId}`;
}

export function grupoOsNFSe(osId: number, adicionais: unknown = []) {
  if (!Array.isArray(adicionais)) throw new SelecaoNFSeError("Informe uma lista de OS válida.");
  const ids = [osId, ...adicionais.map(Number)];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new SelecaoNFSeError("ID da OS inválido.");
  }
  return [...new Set(ids)];
}

export type ServicoSelecionadoNFSe = {
  ordemservicoId: number;
  osservicoId: number;
  valor?: number;
};

export type SelecaoServicosNFSe = {
  servicos: ServicoSelecionadoNFSe[];
  osIds: number[];
  osIdsInteiras: number[];
};

/** O formato antigo seleciona a âncora e inclui as adicionais inteiras. */
export function normalizarSelecaoNFSe(
  osId: number,
  body: Record<string, unknown> | null,
  exigirValor = false,
): SelecaoServicosNFSe {
  grupoOsNFSe(osId);
  const raw = body?.servicos;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SelecaoNFSeError("Selecione ao menos um serviço para emitir a NFS-e.");
  }
  const explicita = raw.some((item) => item && typeof item === "object" && "ordemservicoId" in item);
  const adicionais = grupoOsNFSe(osId, body?.osIdsAdicionais ?? []).slice(1);
  if (explicita && adicionais.length) {
    throw new SelecaoNFSeError("Envie os serviços selecionados por OS sem inclusão automática de outras ordens.");
  }
  const vistos = new Set<string>();
  const servicos = raw.map((item, index): ServicoSelecionadoNFSe => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const ordemservicoId = explicita ? Number(record?.ordemservicoId) : osId;
    const osservicoId = Number(record?.osservicoId ?? (!exigirValor ? item : undefined));
    const chave = chaveServicoNFSe(ordemservicoId, osservicoId);
    if (!Number.isInteger(ordemservicoId) || ordemservicoId <= 0
      || !Number.isInteger(osservicoId) || osservicoId <= 0 || vistos.has(chave)) {
      throw new SelecaoNFSeError(`O serviço ${index + 1} possui um identificador inválido ou duplicado.`);
    }
    vistos.add(chave);
    if (!exigirValor) return { ordemservicoId, osservicoId };
    const bruto = Number(record?.valor);
    const valor = Math.round(bruto * 100) / 100;
    if (!Number.isFinite(bruto) || valor <= 0 || valor > 9999999999999.99) {
      throw new SelecaoNFSeError(`Informe um valor válido e maior que zero para o serviço ${index + 1}.`);
    }
    return { ordemservicoId, osservicoId, valor };
  });
  if (!servicos.some((item) => item.ordemservicoId === osId)) {
    throw new SelecaoNFSeError("A OS principal da NFS-e precisa ter um serviço selecionado.");
  }
  return {
    servicos,
    osIds: grupoOsNFSe(osId, [...servicos.map((item) => item.ordemservicoId), ...adicionais]),
    osIdsInteiras: adicionais,
  };
}

export type LinhaServicoNFSe = {
  servicoid: number;
  quantidade: number | string | null;
  precounitario?: number | string | null;
  subtotal?: number | string | null;
  descricao?: string | null;
  servico?: {
    descricao?: string | null;
    itemlistaservico?: string | null;
  } | null;
};

export type OrdemSelecaoNFSe = {
  id: number;
  cliente?: { id: number } | null;
  osservico?: LinhaServicoNFSe[] | null;
};

export function validarGrupoOsNFSe<T extends OrdemSelecaoNFSe>(osIds: number[], ordens: T[]): T[] {
  const porId = new Map(ordens.map((os) => [Number(os.id), os]));
  const grupo = osIds.map((id) => {
    const os = porId.get(id);
    if (!os) throw new SelecaoNFSeError(`A OS ${id} não foi encontrada.`, 404);
    if (!os.cliente?.id) throw new SelecaoNFSeError(`Vincule um cliente à OS ${id} antes de emitir a NFS-e.`);
    return os;
  });
  if (grupo.some((os) => Number(os.cliente!.id) !== Number(grupo[0].cliente!.id))) {
    throw new SelecaoNFSeError("As OS pertencem a clientes diferentes. Uma NFS-e tem um único tomador.");
  }
  return grupo;
}

/** Compartilhado pela revisão e emissão: nenhum item extra no formato explícito. */
export function resolverServicosNFSe<T extends OrdemSelecaoNFSe>(selecao: SelecaoServicosNFSe, ordens: T[]) {
  const osDoGrupo = validarGrupoOsNFSe(selecao.osIds, ordens);
  const porId = new Map(osDoGrupo.map((os) => [Number(os.id), os]));
  const montar = (ordemservicoId: number, linha: LinhaServicoNFSe, valor?: number): NFSeItemEmissao => ({
    servicoid: Number(linha.servicoid),
    quantidade: Number(linha.quantidade),
    valor: valor ?? Number(linha.subtotal ?? 0),
    descricaoItem: linha.descricao,
    servico: linha.servico,
    ordemServicoId: ordemservicoId,
  });
  const itensSelecionados = selecao.servicos.map((item) => {
    const linha = porId.get(item.ordemservicoId)?.osservico?.find((linha) => Number(linha.servicoid) === item.osservicoId);
    if (!linha) throw new SelecaoNFSeError(`O serviço ${item.osservicoId} não pertence à OS ${item.ordemservicoId}.`);
    return montar(item.ordemservicoId, linha, item.valor);
  });
  for (const id of selecao.osIdsInteiras) {
    const linhas = porId.get(id)?.osservico ?? [];
    if (!linhas.length) throw new SelecaoNFSeError(`A OS ${id} não tem serviços para faturar.`);
    itensSelecionados.push(...linhas.map((linha) => montar(id, linha)));
  }
  return { os: osDoGrupo[0], osDoGrupo, itensSelecionados };
}
