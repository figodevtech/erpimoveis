// Consumidor Final: o cliente do sistema para a venda sem cliente
// identificado. Sem documento, intocável e só nas telas de venda — a OS, o
// veículo, o aluguel e o financeiro continuam pedindo um cliente de verdade.
// A trava vale no banco (migration 20261026220000); aqui ficam as regras que a
// tela e as rotas consultam antes de chegar lá.

export const CONSUMIDOR_FINAL = "consumidor_final";

/**
 * Documento do pagador num título de quem não tem documento (o Consumidor
 * Final). É a convenção dos títulos já gravados e das funções de lançamento;
 * `transacao.cpfcnpjpagador` não aceita vazio.
 */
export const DOCUMENTO_NAO_INFORMADO = "NÃO INFORMADO";

export const MENSAGEM_CLIENTE_DO_SISTEMA =
  "O Consumidor Final é um cadastro do sistema e não pode ser alterado nem excluído.";

/** Cadastro mantido pelo sistema (hoje, só o Consumidor Final). */
export function ehClienteDoSistema(cliente?: { codigo_sistema?: string | null } | null): boolean {
  return Boolean(cliente?.codigo_sistema);
}
