/**
 * Qual regra fiscal decide o total da NF-e — a parte que muda com o leiaute.
 *
 * O total de uma NF-e não sai de uma fórmula só. A composição clássica vale para
 * a nota comum, mas o faturamento direto de veículo novo (`tpOp = 2`) e a
 * importação (CFOP iniciado em 3) têm exceções previstas nas próprias validações
 * da SEFAZ, e a Reforma Tributária acrescenta grupos que ainda NÃO entram no
 * total durante a transição.
 *
 * Tudo que depende de "qual regra vale hoje" mora aqui, num ponto só, para ser
 * trocado quando a Nota Técnica vigente mandar — em vez de espalhar `if (ano >=
 * 2027)` pelo código de cálculo.
 */

/** Um centavo. Abaixo disso é arredondamento do emissor, não divergência. */
export const TOLERANCIA_EM_CENTAVOS = 1;

/**
 * A partir de quando IBS/CBS/IS passam a compor o valor total da NF-e.
 *
 * Durante 2026 (e no piloto de 2025) a NT 2025.002 manda informar os grupos novos
 * SEM somá-los ao `vNF` — somar aqui cobraria o imposto duas vezes na entrada.
 * A data é configurável por ambiente porque a virada depende da NT efetivamente
 * publicada, não do calendário: `NFE_REFORMA_COMPOE_TOTAL_DESDE=2027-01-01`.
 */
export const REFORMA_TRIBUTARIA_COMPOE_TOTAL_DESDE =
  process.env.NFE_REFORMA_COMPOE_TOTAL_DESDE ?? "2027-01-01";

export type RegraDeTotal =
  /** Composição clássica, com o ICMS desonerado reduzindo o total. */
  | "CLASSICA"
  /**
   * Mesma composição, mas sem subtrair `vICMSDeson`. Exceção histórica: há
   * emissor cujo `vNF` nunca teve a desoneração descontada, e a própria validação
   * da SEFAZ aceita os dois.
   */
  | "CLASSICA_SEM_DESONERACAO"
  /** `tpOp = 2`: ST e FCP-ST informados no faturamento direto não entram no total. */
  | "VEICULO_NOVO"
  /** Igual à anterior, com o IPI devolvido também fora do total. */
  | "VEICULO_NOVO_SEM_IPI_DEVOLVIDO";

export function ehFaturamentoDiretoDeVeiculoNovo(tpOp: unknown): boolean {
  return Number(tpOp) === 2;
}

/**
 * CFOP iniciado em 3 é entrada do exterior. A validação do somatório tem exceções
 * nessas operações, então uma divergência ali é prevista — não é erro de leitura.
 */
export function ehImportacao(cfops: Array<string | null>): boolean {
  return cfops.some((cfop) => String(cfop ?? "").trim().startsWith("3"));
}

export function reformaCompoeTotal(contexto: {
  dataEmissao?: string | null;
  versaoLeiaute?: string | null;
}): boolean {
  const dia = String(contexto.dataEmissao ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  return dia >= REFORMA_TRIBUTARIA_COMPOE_TOTAL_DESDE;
}

/**
 * Se `vNFTot` já é o valor fiscal final em algum leiaute.
 *
 * Hoje não é em nenhum, e por isso vem desligado. A chave existe para virar num
 * ponto só quando a Nota Técnica mandar: `NFE_VNFTOT_E_A_REFERENCIA=1`.
 */
export const VNFTOT_E_A_REFERENCIA = process.env.NFE_VNFTOT_E_A_REFERENCIA === "1";

/**
 * Qual campo do XML é o valor fiscal final.
 *
 * Hoje é sempre `ICMSTot/vNF`. `vNFTot` é reconhecido e guardado, mas trocar a
 * referência por ele exige que a regra vigente diga isso — a existência do campo
 * no XML não basta.
 */
export function campoDeReferenciaDoTotal(contexto: {
  dataEmissao?: string | null;
  versaoLeiaute?: string | null;
  temVNFTot: boolean;
}): "vNF" | "vNFTot" {
  return VNFTOT_E_A_REFERENCIA && contexto.temVNFTot ? "vNFTot" : "vNF";
}
