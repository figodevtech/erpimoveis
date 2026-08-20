import { requireAuthenticated } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { faixasOrdenadas, type FaixaDeParcela } from "@/lib/financeiro/bandeira";

/**
 * Peças comuns das duas rotas de bandeira.
 *
 * A tabela de faixas é gravada nas duas (POST e PUT) e lida nas duas; a cópia
 * separada divergiria na primeira correção, que foi exatamente o que motivou
 * `_lib/documento.ts` a existir no lado das transações.
 */

export const SELECT_BANDEIRA =
  "id, nome, descricao, banco_id, metodopagamento, ativo";

export const SELECT_COM_FAIXAS = `${SELECT_BANDEIRA}, parcelas:bandeira_cartao_parcela ( id, parcelas, taxa_percentual )`;


export async function ensureAuth() {
  await requireAuthenticated();
}

export function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export type BandeiraApi = {
  id: number;
  nome: string;
  descricao: string | null;
  bancoId: number | null;
  metodoPagamento: string;
  ativo: boolean;
  parcelas: FaixaDeParcela[];
};

/**
 * Numeric do Postgres chega como string; `faixasOrdenadas` já sabe converter e
 * já descarta faixa com taxa ilegível — deixá-la ordenar aqui garante que a tela
 * e o cálculo do servidor vejam exatamente a mesma tabela.
 */
export function mapBandeira(row: any): BandeiraApi {
  return {
    id: Number(row.id),
    nome: String(row.nome ?? ""),
    descricao: (row.descricao as string | null) ?? null,
    bancoId: row.banco_id == null ? null : Number(row.banco_id),
    metodoPagamento: String(row.metodopagamento ?? ""),
    ativo: typeof row.ativo === "boolean" ? row.ativo : true,
    parcelas: faixasOrdenadas(
      (row.parcelas ?? []).map((faixa: any) => ({
        parcelas: faixa?.parcelas,
        taxaPercentual: faixa?.taxa_percentual,
      })),
    ),
  };
}

export type FaixasValidadas =
  | { ok: true; faixas: FaixaDeParcela[] }
  | { ok: false; erro: string };

/**
 * A tabela de faixas que veio do formulário, pronta para gravar.
 *
 * Recusa a lista vazia: uma bandeira sem nenhuma faixa não pode ser escolhida em
 * lançamento nenhum — apareceria no seletor e não ofereceria nenhuma opção de
 * parcelamento, que é pior do que não existir.
 */
export function validarFaixas(bruto: unknown): FaixasValidadas {
  if (!Array.isArray(bruto)) {
    return { ok: false, erro: "Informe ao menos uma faixa de parcelamento." };
  }

  const informadas = bruto.length;
  const faixas = faixasOrdenadas(
    bruto.map((faixa: any) => ({
      parcelas: faixa?.parcelas,
      taxaPercentual: faixa?.taxaPercentual ?? faixa?.taxa_percentual,
    })),
  );

  if (faixas.length === 0) {
    return { ok: false, erro: "Informe ao menos uma faixa de parcelamento." };
  }

  // `faixasOrdenadas` remove em silêncio o que não dá para usar. Silêncio serve
  // para a leitura; na gravação, sumir com uma linha que a pessoa digitou seria
  // perder trabalho sem avisar.
  if (faixas.length !== informadas) {
    return {
      ok: false,
      erro:
        "Há faixa com parcela ou taxa inválida. Use de 1 a 36 parcelas e taxa entre 0% e 100%, sem repetir a mesma quantidade.",
    };
  }

  return { ok: true, faixas };
}

/**
 * Troca a tabela de faixas inteira.
 *
 * Apagar e reinserir, e não fazer diff: a tabela tem no máximo algumas dezenas
 * de linhas e nenhuma delas é referenciada de fora — a transação guarda o
 * percentual congelado, não o id da faixa. O diff só traria chance de erro.
 */
export async function regravarFaixas(bandeiraId: number, faixas: FaixaDeParcela[]) {
  const { error: erroAoLimpar } = await supabaseAdmin
    .from("bandeira_cartao_parcela")
    .delete()
    .eq("bandeira_id", bandeiraId);
  if (erroAoLimpar) throw erroAoLimpar;

  const { error: erroAoInserir } = await supabaseAdmin
    .from("bandeira_cartao_parcela")
    .insert(
      faixas.map((faixa) => ({
        bandeira_id: bandeiraId,
        parcelas: faixa.parcelas,
        taxa_percentual: faixa.taxaPercentual,
      })),
    );
  if (erroAoInserir) throw erroAoInserir;
}

/** Status HTTP a partir da mensagem crua do Postgres/auth. */
export function statusDoErro(mensagem: string): number {
  if (/auth|unauth|não autenticado/i.test(mensagem)) return 401;
  if (/duplicate|unique|bandeira_cartao_unica_por_conta/i.test(mensagem)) return 409;
  if (/invalid input value for enum/i.test(mensagem)) return 400;
  if (/foreign key|violates foreign key/i.test(mensagem)) return 409;
  return 500;
}

export function mensagemAmigavel(mensagem: string, alternativa: string): string {
  if (/bandeira_cartao_unica_por_conta|duplicate|unique/i.test(mensagem)) {
    return "Já existe uma bandeira com esse nome nesta conta e forma de pagamento.";
  }
  if (/invalid input value for enum/i.test(mensagem)) {
    return "Esta forma de pagamento não existe neste banco de dados.";
  }
  if (/foreign key/i.test(mensagem)) {
    return "A conta bancária informada não existe.";
  }
  return alternativa;
}
