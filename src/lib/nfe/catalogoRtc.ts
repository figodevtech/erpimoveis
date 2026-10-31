/** Versões publicadas do IT 2025.002. O sufixo é a publicação, não dIniVig. */
export function selecionarVersaoCatalogoRtc(
  linhas: ReadonlyArray<{ versao_fonte: string }>,
  dataEmissao: string,
): string | null {
  const candidatas = [...new Set(linhas.map((linha) => linha.versao_fonte))]
    .flatMap((versao) => {
      const partes = /^IT2025\.002-v(\d+)\.(\d+)-(\d{4}-\d{2}-\d{2})$/.exec(versao);
      if (!partes || partes[3] > dataEmissao) return [];
      return [{ versao, publicacao: partes[3], major: Number(partes[1]), minor: Number(partes[2]) }];
    })
    .sort((a, b) => b.publicacao.localeCompare(a.publicacao) || b.major - a.major || b.minor - a.minor);
  return candidatas[0]?.versao ?? null;
}

/** A tabela oficial tem indicadores separados para os modelos 55 e 65. */
export function classificacaoPermiteModeloRtc(
  linha: { permite_nfe: boolean; indicadores?: Record<string, unknown> | null },
  modelo: '55' | '65' | 55 | 65,
): boolean {
  return String(modelo) === '65'
    ? Number(linha.indicadores?.indNFCe) === 1
    : linha.permite_nfe;
}
