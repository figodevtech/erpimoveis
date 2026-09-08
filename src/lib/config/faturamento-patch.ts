/** Não enviar a flag de uma tela antiga quando o usuário editou outro campo. */
export function prepararConfigParaSalvar<T extends { habilitar_faturamento_os?: boolean }>(
  values: T, faturamentoAlterado: boolean, valorAnterior: boolean,
) {
  const { habilitar_faturamento_os, ...demais } = values;
  return faturamentoAlterado
    ? { ...demais, habilitar_faturamento_os, habilitar_faturamento_os_anterior: valorAnterior }
    : demais;
}

/** Telas anteriores ao controle de conflito podem salvar campos não relacionados. */
export function validarAlteracaoFaturamento(
  proximo: boolean | undefined, anterior: unknown, atual: boolean,
): "omitir" | "comparar" | "conflito" {
  if (proximo === undefined) return "omitir";
  if (typeof anterior !== "boolean") return proximo === atual ? "omitir" : "conflito";
  return anterior === atual ? "comparar" : "conflito";
}
