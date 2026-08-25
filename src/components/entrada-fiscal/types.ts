import type { NF } from "@/app/(app)/(pages)/estoque/components/dialog-entrada/types";
import type { UsoConsumoItemOption } from "@/app/(app)/(pages)/usoconsumo/components/item-select-dialog";
import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";

/** Para onde o item da NF-e vai. A escolha é obrigatória por item. */
export type DestinoEntrada = "ESTOQUE" | "USOCONSUMO";

export const DESTINO_LABEL: Record<DestinoEntrada, string> = {
  ESTOQUE: "Estoque de revenda",
  USOCONSUMO: "Uso e consumo",
};

/**
 * Linha da NF-e no fluxo compartilhado. Cada linha carrega o destino escolhido e o
 * vínculo do catálogo correspondente — produto quando vai para revenda, item de
 * uso/consumo quando vai para o outro estoque.
 */
export type LinhaFiscal = NF["itens"][number] & {
  destino?: DestinoEntrada;
  itemReferenciaId?: number;
  itemReferencia?: UsoConsumoItemOption;
};

export type NotaFiscalParseada = Omit<NF, "itens"> & { itens: LinhaFiscal[] };

export type Parcela = { id: number; dataVencimento?: string; valor: number };

/**
 * Custo de entrada da linha: o que veio NA linha, e só.
 *
 * ICMS-ST, imposto de importação e IPI devolvido são lidos do XML mas ficam de
 * fora daqui de propósito — como o frete que o emitente não repartiu, são dívida
 * com o fornecedor, não preço de mercadoria. Aparecem na linha de acréscimos da
 * nota e entram no que se paga, nunca no custo do produto.
 *
 * Em centavos porque em float `0.1 + 0.2 !== 0.3` e um centavo de diferença
 * derruba a conferência das parcelas.
 */
export function totalDaLinha(item: LinhaFiscal) {
  return paraReais(
    paraCentavos(Number(item.quantidade) * Number(item.valorUnitario))
    - paraCentavos(item.valorDesconto ?? 0)
    + paraCentavos(item.valorFrete ?? 0)
    + paraCentavos(item.valorSeguro ?? 0)
    + paraCentavos(item.outrasDespesas ?? 0)
    + paraCentavos(item.valorIpi ?? 0),
  );
}

const UNIDADES = ["UN", "JGO", "KIT", "PAR", "CX", "PCT"];

export function unidadeNormalizada(value: unknown) {
  const unit = String(value ?? "").toUpperCase();
  return UNIDADES.includes(unit) ? unit : "UN";
}

export function apenasDigitos(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/** O vínculo do catálogo depende do destino: cada um tem a sua própria coluna. */
export function linhaVinculada(linha: LinhaFiscal) {
  if (linha.destino === "ESTOQUE") return Boolean(linha.produtoReferenciaId);
  if (linha.destino === "USOCONSUMO") return Boolean(linha.itemReferenciaId);
  return false;
}

export function rotuloVinculo(linha: LinhaFiscal) {
  if (linha.destino === "ESTOQUE") {
    return linha.produtoReferenciaId
      ? `Produto vinculado: ${linha.produtoReferencia?.titulo ?? `#${linha.produtoReferenciaId}`}`
      : "Produto não vinculado ao estoque";
  }
  if (linha.destino === "USOCONSUMO") {
    return linha.itemReferenciaId
      ? `Item vinculado: ${linha.itemReferencia?.titulo ?? `#${linha.itemReferenciaId}`}`
      : "Item não vinculado ao uso e consumo";
  }
  return "Escolha o destino para vincular";
}
