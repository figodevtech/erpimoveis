import { chaveServicoNFSe } from "@/lib/services/fiscais/nfse-selecao";
import type { ServicoOS, ValoresServicosForm } from "./types";

export function chaveDoServico(servico: ServicoOS) {
  return chaveServicoNFSe(servico.ordemservicoid, servico.servicoid);
}

export function servicoDisponivel(servico: ServicoOS) {
  return !servico.pendenciasCadastro?.length && ![
    "PROCESSANDO", "PROCESSANDO_AUTORIZACAO", "AUTORIZADA", "AUTORIZADO", "EMITIDA", "DENEGADA",
  ].includes(String(servico.notaFiscalStatus ?? "").toUpperCase());
}

export function valorDoServico(servico: ServicoOS, valores: ValoresServicosForm) {
  return Math.round(Number((valores[chaveDoServico(servico)] ?? "").replace(",", ".")) * 100) / 100;
}

export function totalDosServicos(servicos: ServicoOS[], valores: ValoresServicosForm) {
  return servicos.reduce((centavos, servico) => {
    const valor = valorDoServico(servico, valores);
    return centavos + (Number.isFinite(valor) ? Math.round(valor * 100) : 0);
  }, 0) / 100;
}

export function selecaoParaRevisao(servicos: ServicoOS[]) {
  return servicos.map((servico) => ({ ordemservicoId: servico.ordemservicoid, osservicoId: servico.servicoid }));
}

export function selecaoParaEmissao(servicos: ServicoOS[], valores: ValoresServicosForm) {
  return servicos.map((servico) => ({
    ordemservicoId: servico.ordemservicoid,
    osservicoId: servico.servicoid,
    valor: valorDoServico(servico, valores),
  }));
}

export function ancoraDaSelecao(osIds: number[], servicos: ServicoOS[]) {
  return osIds.find((id) => servicos.some((servico) => servico.ordemservicoid === id)) ?? null;
}
