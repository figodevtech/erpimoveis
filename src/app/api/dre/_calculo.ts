// src/app/api/dre/_calculo.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type LinhaDre = {
  id: number;
  codigo: string;
  nome: string;
  nivel: number;
  parentId: number | null;
  tipo: "GRUPO" | "DETALHE" | "SUBTOTAL" | "FORMULA";
  naturezaDre: string | null;
  formula: string | null;
  sinal: number;
  semFonte: boolean;
  valor: number;
  valorAnterior: number;
  variacao: number;
  variacaoPercentual: number | null;
  percentualReceitaLiquida: number | null;
  lancamentos: number;
  filhos: LinhaDre[];
};

type Registro = Record<string, unknown>;

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Soma dos eventos por linha, resolvendo tanto o vínculo direto quanto o mapeamento por origem. */
async function somarPorLinha(templateId: number, de: string, ate: string) {
  const { data, error } = await supabaseAdmin.rpc("dre_somar_por_linha", {
    p_template_id: templateId,
    p_de: de,
    p_ate: ate,
  });

  if (error) throw error;

  const soma = new Map<number, { valor: number; lancamentos: number }>();
  for (const row of (data ?? []) as Registro[]) {
    const id = Number(row.linha_id);
    if (!Number.isFinite(id)) continue;
    soma.set(id, { valor: num(row.valor), lancamentos: Number(row.lancamentos ?? 0) });
  }
  return soma;
}

/**
 * Avalia expressoes do tipo "9 + 10 + 11" sobre os codigos ja calculados.
 *
 * Deliberadamente restrito a soma e subtracao de codigos: nao ha eval, nao ha
 * parenteses, e qualquer token desconhecido zera o termo em vez de quebrar o
 * relatorio inteiro. Formula de DRE nao precisa de mais que isso.
 */
function avaliarFormula(formula: string, porCodigo: Map<string, number>): number {
  const tokens = formula.replace(/\s+/g, " ").trim().split(" ");
  let total = 0;
  let sinal = 1;

  for (const token of tokens) {
    if (token === "+") { sinal = 1; continue; }
    if (token === "-") { sinal = -1; continue; }
    total += sinal * (porCodigo.get(token) ?? 0);
  }

  return Number(total.toFixed(2));
}

function montarArvore(
  linhas: Registro[],
  soma: Map<number, { valor: number; lancamentos: number }>,
  somaAnterior: Map<number, { valor: number; lancamentos: number }>,
) {
  const base: LinhaDre[] = linhas.map((l) => ({
    id: Number(l.id),
    codigo: String(l.codigo),
    nome: String(l.nome),
    nivel: Number(l.nivel ?? 1),
    parentId: l.parent_id == null ? null : Number(l.parent_id),
    tipo: String(l.tipo) as LinhaDre["tipo"],
    naturezaDre: (l.natureza_dre as string | null) ?? null,
    formula: (l.formula as string | null) ?? null,
    sinal: Number(l.sinal ?? 1),
    semFonte: l.sem_fonte === true,
    valor: soma.get(Number(l.id))?.valor ?? 0,
    valorAnterior: somaAnterior.get(Number(l.id))?.valor ?? 0,
    variacao: 0,
    variacaoPercentual: null,
    percentualReceitaLiquida: null,
    lancamentos: soma.get(Number(l.id))?.lancamentos ?? 0,
    filhos: [],
  }));

  const porId = new Map(base.map((l) => [l.id, l]));
  const raizes: LinhaDre[] = [];

  for (const linha of base) {
    if (linha.parentId != null && porId.has(linha.parentId)) porId.get(linha.parentId)!.filhos.push(linha);
    else raizes.push(linha);
  }

  // Pais somam os filhos. Percorre do nivel mais fundo para o mais raso.
  const porNivel = [...base].sort((a, b) => b.nivel - a.nivel);
  for (const linha of porNivel) {
    if (!linha.filhos.length) continue;
    linha.valor = Number(linha.filhos.reduce((acc, f) => acc + f.valor, 0).toFixed(2));
    linha.valorAnterior = Number(linha.filhos.reduce((acc, f) => acc + f.valorAnterior, 0).toFixed(2));
    linha.lancamentos = linha.filhos.reduce((acc, f) => acc + f.lancamentos, 0);
  }

  // Formulas dependem dos totais acima; resolvidas na ordem do template.
  const porCodigo = new Map(base.map((l) => [l.codigo, l.valor]));
  const anteriorPorCodigo = new Map(base.map((l) => [l.codigo, l.valorAnterior]));

  for (const linha of base) {
    if (linha.tipo !== "FORMULA" || !linha.formula) continue;
    linha.valor = avaliarFormula(linha.formula, porCodigo);
    linha.valorAnterior = avaliarFormula(linha.formula, anteriorPorCodigo);
    porCodigo.set(linha.codigo, linha.valor);
    anteriorPorCodigo.set(linha.codigo, linha.valorAnterior);
  }

  const receitaLiquida = porCodigo.get("3") ?? 0;

  for (const linha of base) {
    linha.variacao = Number((linha.valor - linha.valorAnterior).toFixed(2));
    linha.variacaoPercentual =
      linha.valorAnterior === 0 ? null : Number(((linha.variacao / Math.abs(linha.valorAnterior)) * 100).toFixed(2));
    // Sem receita liquida nao existe percentual: devolver 0 sugeriria "nada",
    // quando o correto e "indefinido".
    linha.percentualReceitaLiquida =
      receitaLiquida === 0 ? null : Number(((linha.valor / receitaLiquida) * 100).toFixed(2));
  }

  return { raizes, plano: base };
}

export async function calcularDre(params: { de: string; ate: string; deAnterior: string; ateAnterior: string }) {
  const { data: template, error: erroTemplate } = await supabaseAdmin
    .from("dre_template")
    .select("id, codigo, nome, versao")
    .eq("ativo", true)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erroTemplate) throw erroTemplate;
  if (!template) throw new Error("Nenhum template de DRE configurado.");

  const templateId = Number((template as Registro).id);

  const { data: linhas, error: erroLinhas } = await supabaseAdmin
    .from("dre_linha")
    .select("id, codigo, nome, nivel, parent_id, tipo, natureza_dre, formula, sinal, sem_fonte")
    .eq("template_id", templateId)
    .eq("ativo", true)
    .order("ordem");

  if (erroLinhas) throw erroLinhas;

  const [soma, somaAnterior] = await Promise.all([
    somarPorLinha(templateId, params.de, params.ate),
    somarPorLinha(templateId, params.deAnterior, params.ateAnterior),
  ]);

  const { raizes, plano } = montarArvore((linhas ?? []) as Registro[], soma, somaAnterior);

  return {
    template: {
      id: templateId,
      codigo: String((template as Registro).codigo),
      nome: String((template as Registro).nome),
      versao: Number((template as Registro).versao),
    },
    linhas: raizes,
    indicadorPorCodigo: Object.fromEntries(plano.map((l) => [l.codigo, l.valor])),
  };
}
