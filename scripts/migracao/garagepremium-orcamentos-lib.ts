export type TipoItemHistorico = "PRODUTO" | "SERVICO";

export type MotivoClassificacao =
  | "CODIGO_65"
  | "MAO_OU_SERVICO"
  | "ATIVIDADE"
  | "SUBSTITUICAO"
  | "ACAO"
  | "REPARO_EXECUTADO"
  | "PADRAO_PRODUTO";

export type ClassificacaoItem = {
  tipo: TipoItemHistorico;
  motivo: MotivoClassificacao;
};

export function texto(valor: unknown) {
  return valor == null ? "" : String(valor).trim();
}

export function normalizarTexto(valor: unknown) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function removerPrefixoMarca(descricao: string) {
  return descricao.replace(/^(GP|BR|SVGP)\s+/, "");
}

export function classificarItem(codigo: unknown, descricao: unknown): ClassificacaoItem {
  const codigoNormalizado = normalizarTexto(codigo);
  if (codigoNormalizado === "65") {
    return { tipo: "SERVICO", motivo: "CODIGO_65" };
  }

  const descricaoNormalizada = removerPrefixoMarca(normalizarTexto(descricao));
  if (/^(M O\b|MAO (DE|DO|D E) ?OBRA\b|SERVICO\b)/.test(descricaoNormalizada)) {
    return { tipo: "SERVICO", motivo: "MAO_OU_SERVICO" };
  }
  if (
    /^(ALINHAMENTO|BALANCEAMENTO|CAMBAGEM|DIAGNOSTICO|SCANNER|HIGIENIZACAO|LAVAGEM|POLIMENTO|CRISTALIZACAO|PROGRAMACAO|CODIFICACAO|REGULAGEM|MONTAGEM|DESMONTAGEM|INSTALACAO|REMOCAO|RETIFICA|SOLDA|PASSE |ABASTECIMENTO|REBOQUE|GUINCHO|CARGA DE GAS|LIMPEZA )/.test(
      descricaoNormalizada,
    )
  ) {
    return { tipo: "SERVICO", motivo: "ATIVIDADE" };
  }
  if (/^(SUBSTITUICAO|SUBSTITUIR|SUBST |SUBSTI |SUBSTITU )/.test(descricaoNormalizada)) {
    return { tipo: "SERVICO", motivo: "SUBSTITUICAO" };
  }
  if (/^(TROCA|TESTE)\b/.test(descricaoNormalizada)) {
    return { tipo: "SERVICO", motivo: "ACAO" };
  }
  if (/^REPARO (DO|DA|DOS|DAS|DE|NA|NO)\b/.test(descricaoNormalizada)) {
    return { tipo: "SERVICO", motivo: "REPARO_EXECUTADO" };
  }
  return { tipo: "PRODUTO", motivo: "PADRAO_PRODUTO" };
}

export function descricaoHistorica(descricao: unknown, codigo: unknown) {
  const original = texto(descricao);
  return original || `Item legado sem descrição — código ${texto(codigo) || "não informado"}`;
}

export function arredondarMoeda(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}
