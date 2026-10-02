import { EMPTY_CODIGOS, type CodigosFiscaisForm, type ModeloEmissao, type ServicoOS } from "./types";

/** O valor que todos os serviços têm em comum, ou vazio se divergem. */
export function valorComum(values: Array<string | number | null | undefined>) {
  const normalizados = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (normalizados.length === 0 || new Set(normalizados).size !== 1) return "";
  return normalizados[0];
}

/**
 * Os códigos com que a etapa de revisão abre.
 *
 * Recebe o modelo e o padrão JÁ resolvidos para os serviços selecionados (rota
 * `contexto-emissao`), e não os da abertura da OS. A ordem é a do fluxo:
 * seleção → política → modelo final → padrão do modelo final → formulário.
 *
 * No padrão Nacional os códigos do cadastro de serviço não entram: item da LC
 * 116, CNAE e código municipal são do emissor antigo, e a alíquota de
 * município conveniado vem parametrizada do Sistema Nacional. Sem padrão
 * Nacional cadastrado, os campos abrem vazios — e a tela avisa.
 */
export function montarCodigosDaRevisao({
  modelo,
  padraoFiscal,
  servicos,
  observacoes,
}: {
  modelo: ModeloEmissao;
  padraoFiscal: Partial<CodigosFiscaisForm> | null | undefined;
  servicos: ServicoOS[];
  /** Texto livre já composto (observação da OS, padrão e garantia). */
  observacoes: string;
}): CodigosFiscaisForm {
  const padrao = padraoFiscal ?? {};
  const nacional = modelo === "NACIONAL";
  const doCadastro = (valores: Array<string | number | null | undefined>) => nacional ? "" : valorComum(valores);
  return {
    ...EMPTY_CODIGOS,
    ...padrao,
    itemListaServico: doCadastro(servicos.map((item) => item.servico?.itemlistaservico)) || padrao.itemListaServico || "",
    codigoCnae: doCadastro(servicos.map((item) => item.servico?.cnae)) || padrao.codigoCnae || "",
    aliquotaIss: doCadastro(servicos.map((item) => item.servico?.aliquotaiss)) || padrao.aliquotaIss || "",
    // Continua editável, e apagar o campo é uma escolha explícita que o
    // servidor respeita.
    informacoesComplementares: observacoes || padrao.informacoesComplementares || "",
  };
}
