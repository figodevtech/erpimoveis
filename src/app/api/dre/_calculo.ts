// src/app/api/dre/_calculo.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { montarArvore, num, type LinhaDre } from "./_arvore";

export type { LinhaDre };

type Registro = Record<string, unknown>;

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

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Período no formato em que a tela o envia: dois dias AAAA-MM-DD. */
export function periodoValido(de: string, ate: string) {
  return DATA_ISO.test(de) && DATA_ISO.test(ate);
}

/** Período imediatamente anterior, com a mesma quantidade de dias: a coluna "Anterior". */
export function periodoAnterior(de: string, ate: string) {
  const inicio = new Date(`${de}T00:00:00.000Z`);
  const fim = new Date(`${ate}T00:00:00.000Z`);
  const dias = Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / 86_400_000) + 1);

  const fimAnterior = new Date(inicio);
  fimAnterior.setUTCDate(fimAnterior.getUTCDate() - 1);
  const inicioAnterior = new Date(fimAnterior);
  inicioAnterior.setUTCDate(inicioAnterior.getUTCDate() - (dias - 1));

  return {
    de: inicioAnterior.toISOString().slice(0, 10),
    ate: fimAnterior.toISOString().slice(0, 10),
  };
}

/**
 * A DRE de um período com o comparativo, como a tela e a folha impressa a leem.
 *
 * Os limites do dia e o período anterior são decididos aqui, uma vez só. Se a
 * impressão fizesse a própria conta, bastaria um ajuste de fuso de um dos lados
 * para o papel divergir da tela.
 */
export async function apurarDre(de: string, ate: string) {
  const anterior = periodoAnterior(de, ate);

  const dre = await calcularDre({
    de: `${de}T00:00:00.000Z`,
    ate: `${ate}T23:59:59.999Z`,
    deAnterior: `${anterior.de}T00:00:00.000Z`,
    ateAnterior: `${anterior.ate}T23:59:59.999Z`,
  });

  return { periodo: { de, ate, anterior }, ...dre };
}
