// Quando uma OS ou uma venda pode originar nota fiscal.
//
// A regra estava escrita inline em dois menus de ação (`osTable.tsx` e
// `vendasTable.tsx`). Com a emissão em lote ela passa a ser consultada também
// pela seleção múltipla, e três cópias da mesma condição divergem no primeiro
// ajuste: o menu ofereceria emitir onde o lote não deixa marcar, ou o
// contrário.

import { STATUS_OS_VALIDOS, type StatusOSValido } from "@/lib/ordens/destaque";

/** O recorte de `config` de que esta decisão depende. */
export type ConfigEmissao = {
  habilitar_emissao_nfe?: boolean | null;
  /** Status de OS em que a emissão é liberada, escolhidos em Configurações Gerais. */
  emissao_nf_status_os?: readonly string[] | null;
  /** Legado: só decide quando `emissao_nf_status_os` ainda não existe no banco. */
  emissao_nf_ordens_nao_pagas?: boolean | null;
  emissao_nf_vendas_nao_pagas?: boolean | null;
} | null | undefined;

/** Status que a tela oferece. OS cancelada não tem o que documentar. */
export const STATUS_OS_EMISSAO_OPCOES = STATUS_OS_VALIDOS.filter(
  (status) => status !== "CANCELADO",
) as readonly StatusOSValido[];

/** Padrão de instalação nova — o mesmo default da coluna no banco. */
export const STATUS_OS_EMISSAO_PADRAO: readonly StatusOSValido[] = ["PAGAMENTO", "FATURAMENTO", "CONCLUIDO"];

export function statusOSEmissaoValido(valor: unknown): valor is StatusOSValido {
  return (STATUS_OS_EMISSAO_OPCOES as readonly string[]).includes(String(valor ?? "").trim().toUpperCase());
}

/**
 * Lista efetiva de status que liberam a emissão da OS.
 *
 * Descarta o que não é status emitível. Lista ausente ou vazia vem de banco
 * sem a migration: aí vale o switch antigo, que só conhecia duas regras —
 * concluída, ou também em pagamento/faturamento.
 */
export function normalizarStatusEmissaoOS(
  valor: unknown,
  legadoNaoPagas?: boolean | null,
): StatusOSValido[] {
  const lista = Array.isArray(valor)
    ? [...new Set(valor.map((item) => String(item ?? "").trim().toUpperCase()))].filter(statusOSEmissaoValido)
    : [];
  if (lista.length > 0) return lista;
  return legadoNaoPagas ? [...STATUS_OS_EMISSAO_PADRAO] : ["CONCLUIDO"];
}

/** Status de OS que aceitam emissão, conforme a escolha em Configurações Gerais. */
export function osPodeEmitirNota(status: unknown, config: ConfigEmissao) {
  if (!config?.habilitar_emissao_nfe) return false;
  const atual = String(status ?? "").trim().toUpperCase();
  return (normalizarStatusEmissaoOS(config.emissao_nf_status_os, config.emissao_nf_ordens_nao_pagas) as string[])
    .includes(atual);
}

export function vendaPodeEmitirNota(status: unknown, config: ConfigEmissao) {
  if (!config?.habilitar_emissao_nfe) return false;
  const atual = String(status ?? "").trim().toUpperCase();
  return config?.emissao_nf_vendas_nao_pagas
    ? atual === "PAGAMENTO" || atual === "FINALIZADA"
    : atual === "FINALIZADA";
}

/**
 * Se o documento pode entrar numa seleção de emissão em lote.
 *
 * Além de poder emitir, ele não pode já ter nota viva: `notaNumero` vem
 * preenchido pela listagem quando existe nota para a origem. Marcar uma OS já
 * faturada só produziria um 422 no fim do fluxo.
 */
export function podeEntrarNaEmissaoEmLote(
  documento: { status?: unknown; notaNumero?: unknown },
  config: ConfigEmissao,
  tipo: "OS" | "VENDA",
) {
  const emitivel =
    tipo === "OS"
      ? osPodeEmitirNota(documento.status, config)
      : vendaPodeEmitirNota(documento.status, config);
  if (!emitivel) return false;
  return !documento.notaNumero;
}

/** Por que a linha não pode ser marcada, para o `title` do checkbox. */
export function motivoForaDaEmissaoEmLote(
  documento: { status?: unknown; notaNumero?: unknown },
  config: ConfigEmissao,
  tipo: "OS" | "VENDA",
) {
  if (!config?.habilitar_emissao_nfe) return "A emissão de NF-e está desligada nas configurações.";
  if (documento.notaNumero) return `Já existe nota fiscal (nº ${documento.notaNumero}) para este documento.`;
  const emitivel =
    tipo === "OS"
      ? osPodeEmitirNota(documento.status, config)
      : vendaPodeEmitirNota(documento.status, config);
  if (!emitivel) {
    return tipo === "OS"
      ? "A OS ainda não está num status que permite emitir nota."
      : "A venda ainda não está num status que permite emitir nota.";
  }
  return undefined;
}
