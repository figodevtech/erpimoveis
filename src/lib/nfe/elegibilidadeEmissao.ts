// Quando uma OS ou uma venda pode originar nota fiscal.
//
// A regra estava escrita inline em dois menus de ação (`osTable.tsx` e
// `vendasTable.tsx`). Com a emissão em lote ela passa a ser consultada também
// pela seleção múltipla, e três cópias da mesma condição divergem no primeiro
// ajuste: o menu ofereceria emitir onde o lote não deixa marcar, ou o
// contrário.

/** O recorte de `config` de que esta decisão depende. */
export type ConfigEmissao = {
  habilitar_emissao_nfe?: boolean | null;
  emissao_nf_ordens_nao_pagas?: boolean | null;
  emissao_nf_vendas_nao_pagas?: boolean | null;
} | null | undefined;

/**
 * Status de OS que aceitam emissão.
 *
 * Fora do padrão, a OS só emite depois de concluída. Com
 * `emissao_nf_ordens_nao_pagas`, a oficina fatura antes de receber — é comum
 * quando a nota é o que o cliente leva para pagar.
 */
export function osPodeEmitirNota(status: unknown, config: ConfigEmissao) {
  if (!config?.habilitar_emissao_nfe) return false;
  const atual = String(status ?? "").trim().toUpperCase();
  return config?.emissao_nf_ordens_nao_pagas
    ? atual === "PAGAMENTO" || atual === "FATURAMENTO" || atual === "CONCLUIDO"
    : atual === "CONCLUIDO";
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
