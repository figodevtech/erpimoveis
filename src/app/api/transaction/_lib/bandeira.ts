import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calcularTaxaDaBandeira, taxaDaFaixa } from "@/lib/financeiro/bandeira";

/**
 * Campos da bandeira de cartao em uma transacao.
 *
 * Vive aqui pela mesma razao que `documento.ts`: as rotas de criacao sao duas
 * (`/api/transaction` e `/api/transaction/os`) e a de edicao e uma terceira.
 *
 * O QUE ESTA ROTA NAO ACEITA DO CLIENTE
 * O percentual e o liquido. A tela calcula os dois para mostrar, mas quem grava
 * releR a tabela da bandeira e refaz a conta — senao bastaria um POST na mao
 * para registrar 0,5% onde a adquirente cobra 8,9%, e o dinheiro que "faltou"
 * viraria prejuizo silencioso no fluxo de caixa.
 *
 * A tela e o servidor usam a MESMA funcao (`calcularTaxaDaBandeira`). Isso nao e
 * elegancia: a soma das parcelas e conferida contra o liquido total, e um
 * centavo de divergencia entre os dois lados derrubaria o cadastro inteiro com
 * "a soma das parcelas deve ser igual ao valor liquido".
 */

export const CAMPOS_BANDEIRA = [
  "bandeira_id",
  "bandeira_parcelas",
  "bandeira_taxa_percentual",
  "bandeira_taxa_ajustada",
] as const;

function inteiroOuNulo(valor: unknown): number | null {
  if (valor == null || (typeof valor === "string" && valor.trim() === "")) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : null;
}

/**
 * Copia para `saida` os campos de bandeira presentes em `body`, ja coeridos.
 *
 * Chave ausente continua ausente, como em `aplicarCamposDocumento`: num PATCH
 * isso e o que impede apagar a bandeira de uma transacao so porque a tela nao
 * mandou o campo.
 *
 * O percentual nao entra: ele e derivado em `resolverBandeira`.
 */
export function aplicarCamposBandeira(body: unknown, saida: Record<string, unknown>) {
  if (!body || typeof body !== "object") return saida;
  const origem = body as Record<string, unknown>;

  if ("bandeira_id" in origem) saida.bandeira_id = inteiroOuNulo(origem.bandeira_id);
  if ("bandeira_parcelas" in origem) {
    saida.bandeira_parcelas = inteiroOuNulo(origem.bandeira_parcelas);
  }
  if ("bandeira_taxa_ajustada" in origem) {
    saida.bandeira_taxa_ajustada = origem.bandeira_taxa_ajustada === true;
  }

  return saida;
}

export type ResolucaoDaBandeira =
  | { ok: true; liquido: number | null }
  | { ok: false; erro: string; status: number };

/**
 * Fecha os campos de bandeira e devolve o liquido que deve ser gravado.
 *
 * `liquido: null` significa "nao mexa no liquido" — ou nao ha bandeira, ou o
 * usuario destravou o campo e o numero dele vale.
 *
 * O `valorBruto` e o da transacao inteira, nao o da parcela: a taxa da maquineta
 * incide sobre a venda, e o rateio entre as parcelas ja e feito por
 * `distribuirPorPesos` na rota de criacao.
 */
export async function resolverBandeira(
  saida: Record<string, unknown>,
  valorBruto: number,
): Promise<ResolucaoDaBandeira> {
  const bandeiraId = saida.bandeira_id as number | null | undefined;

  // Sem bandeira nao ha parcelamento de maquineta nem taxa congelada. Zerar em
  // vez de so omitir tambem conserta a linha que ja tenha sido gravada com
  // bandeira antes de alguem trocar a forma de pagamento — e e o que o CHECK
  // `transacao_bandeira_coerente` exige.
  if (bandeiraId == null) {
    if ("bandeira_id" in saida) {
      saida.bandeira_id = null;
      saida.bandeira_parcelas = null;
      saida.bandeira_taxa_percentual = null;
      saida.bandeira_taxa_ajustada = false;
    }
    return { ok: true, liquido: null };
  }

  const parcelas = saida.bandeira_parcelas as number | null | undefined;
  if (parcelas == null || parcelas < 1) {
    return {
      ok: false,
      erro: "Informe em quantas vezes o pagamento foi passado no cartão.",
      status: 400,
    };
  }

  const { data: bandeira, error } = await supabaseAdmin
    .from("bandeira_cartao")
    .select("id, nome, ativo, parcelas:bandeira_cartao_parcela ( parcelas, taxa_percentual )")
    .eq("id", bandeiraId)
    .maybeSingle();

  if (error) throw error;

  if (!bandeira) {
    return { ok: false, erro: "Bandeira inexistente.", status: 400 };
  }

  // Bandeira desativada continua valendo para o que ja foi lancado, mas nao pode
  // entrar em lancamento novo — senao desativar nao desativaria nada.
  if (bandeira.ativo === false) {
    return {
      ok: false,
      erro: `A bandeira ${bandeira.nome} está desativada e não pode ser usada em novos lançamentos.`,
      status: 409,
    };
  }

  const faixas = ((bandeira.parcelas ?? []) as any[]).map((faixa) => ({
    parcelas: faixa?.parcelas,
    taxaPercentual: faixa?.taxa_percentual,
  }));

  const percentualDaTabela = taxaDaFaixa(faixas, parcelas);
  if (percentualDaTabela == null) {
    return {
      ok: false,
      erro: `A bandeira ${bandeira.nome} não tem taxa cadastrada para ${parcelas}x.`,
      status: 400,
    };
  }

  /*
   * O escape: a adquirente as vezes cobra diferente do combinado, e a tela tem
   * um botao que destrava o liquido. Quando isso acontece o numero digitado
   * manda, e o percentual gravado passa a ser o que de fato foi aplicado — nao o
   * da tabela.
   *
   * Guardar o efetivo, e nao o esperado, mantem um invariante unico:
   * `valor * percentual / 100` sempre da a taxa daquela linha. Quem quiser saber
   * se ela saiu da tabela ou foi digitada olha `bandeira_taxa_ajustada`.
   */
  if (saida.bandeira_taxa_ajustada === true) {
    const liquidoDigitado = Number(saida.valorLiquido ?? valorBruto);

    if (!Number.isFinite(liquidoDigitado) || liquidoDigitado < 0) {
      return { ok: false, erro: "Valor líquido inválido.", status: 400 };
    }

    if (Math.round(liquidoDigitado * 100) > Math.round(valorBruto * 100)) {
      return {
        ok: false,
        erro: "O valor líquido não pode ser maior que o bruto.",
        status: 400,
      };
    }

    const taxaEmReais = Math.round((valorBruto - liquidoDigitado) * 100) / 100;
    const efetivo =
      valorBruto > 0 ? Math.round((taxaEmReais / valorBruto) * 1_000_000) / 10_000 : 0;

    saida.bandeira_taxa_percentual = efetivo;
    return { ok: true, liquido: liquidoDigitado };
  }

  const { liquido } = calcularTaxaDaBandeira(valorBruto, percentualDaTabela);

  saida.bandeira_taxa_percentual = percentualDaTabela;
  saida.bandeira_taxa_ajustada = false;

  return { ok: true, liquido };
}

/**
 * Mensagem de recusa, ou `null` quando os campos estao coerentes.
 *
 * Espelha o CHECK `transacao_bandeira_coerente`: o banco garante o dado, a rota
 * garante a frase.
 */
export function erroDeBandeira(saida: Record<string, unknown>): string | null {
  if (saida.bandeira_id != null) return null;

  const temResto =
    saida.bandeira_parcelas != null ||
    saida.bandeira_taxa_percentual != null ||
    saida.bandeira_taxa_ajustada === true;

  return temResto ? "Selecione a bandeira do cartão." : null;
}
