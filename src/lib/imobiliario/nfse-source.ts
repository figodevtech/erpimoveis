import type { NFSeCodigosFiscais } from "@/lib/services/fiscais/nfse-service";

export type FiscalSource = { tipo: "TAXA_ADMIN" | "COMISSAO"; id: number; proprietario_id: number; imovel_id: number; valor: number; pendente?: boolean; is_deleted?: boolean; descricao?: string; nfse_id?: number | null };

/** Rentals and pass-through receipts are deliberately outside the service invoice source. */
export function validateServiceSources(sources: FiscalSource[]) {
  if (!sources.length) throw new Error("Selecione ao menos uma taxa de administração ou comissão recebida.");
  const seen = new Set<string>(); const owners = new Set<number>(); let cents = 0;
  for (const source of sources) {
    if (!["TAXA_ADMIN", "COMISSAO"].includes(source.tipo) || source.is_deleted || source.pendente === true) throw new Error("Somente taxas de administração e comissões efetivamente recebidas podem compor a NFS-e.");
    if (!Number.isSafeInteger(Number(source.id)) || Number(source.id) <= 0 || !Number.isSafeInteger(Number(source.proprietario_id)) || Number(source.proprietario_id) <= 0) throw new Error("A origem fiscal está incompleta.");
    const amount = Math.round(Number(source.valor) * 100); if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("A origem fiscal deve possuir valor positivo.");
    const key = `${source.tipo}-${source.id}`; if (seen.has(key)) throw new Error("Há origens repetidas na seleção da NFS-e."); seen.add(key); owners.add(Number(source.proprietario_id)); cents += amount;
  }
  if (owners.size !== 1) throw new Error("Selecione serviços de um único proprietário por NFS-e.");
  return { total: cents / 100, proprietarioId: [...owners][0] };
}

const aliases: Record<string, keyof NFSeCodigosFiscais> = { itemListaServico: "item_lista_servico", codigoCnae: "codigo_cnae", codigoTributarioMunicipio: "codigo_tributario_municipio", codigoTributacaoNacionalIss: "codigo_tributacao_nacional_iss", codigoTributacaoMunicipalIss: "codigo_tributacao_municipal_iss", situacaoTributariaPisCofins: "situacao_tributaria_pis_cofins", codigoNbs: "codigo_nbs", aliquotaIss: "aliquota_iss", naturezaOperacao: "natureza_operacao", issRetido: "iss_retido", tributacaoIss: "tributacao_iss", tipoRetencaoIss: "tipo_retencao_iss", regimeEspecialTributacao: "regime_especial_tributacao", regimeApuracaoSimplesNacional: "regime_apuracao_simples_nacional", finalidadeEmissao: "finalidade_emissao", consumidorFinal: "consumidor_final", indicadorDestinatario: "indicador_destinatario", codigoIndicadorOperacao: "codigo_indicador_operacao", ibsCbsSituacaoTributaria: "ibs_cbs_situacao_tributaria", ibsCbsClassificacaoTributaria: "ibs_cbs_classificacao_tributaria", informacoesComplementares: "informacoes_complementares" };
const numericFields = new Set(["aliquota_iss", "natureza_operacao", "tributacao_iss", "tipo_retencao_iss", "regime_especial_tributacao", "regime_apuracao_simples_nacional", "finalidade_emissao", "consumidor_final", "indicador_destinatario"]);
export function normalizeFiscalCodes(input: Record<string, unknown> = {}): NFSeCodigosFiscais {
  const output: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    const key = aliases[field] ?? field;
    if (!Object.values(aliases).includes(key as keyof NFSeCodigosFiscais) || value == null || value === "") continue;
    output[key] = key === "iss_retido" ? value === true || value === "true" : numericFields.has(key) ? Number(value) : String(value).trim();
  }
  return output as NFSeCodigosFiscais;
}
