import { valorDeFace } from "@/lib/financeiro/transacao";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Títulos de uma OS para efeito de titularidade.
 *
 * Uma OS é cobrada por dois caminhos: o vínculo direto (`transacao.ordemservicoid`)
 * e o pagamento múltiplo, onde uma transação é só o dinheiro e `pagamento_multiplo_rateio`
 * diz quanto coube a cada documento. Olhar só a FK escalar faz uma OS paga
 * parecer sem título nenhum.
 *
 * A diferença importa na hora de trocar o pagador: um rateio que cobre outros
 * documentos é dinheiro de quem pagou aquele conjunto, e trocar o titular de um
 * dos documentos não reescreve de quem veio o dinheiro. Por isso o rateio só
 * acompanha a troca quando é exclusivo desta OS.
 */
export type TituloDaOs = {
  id: string;
  descricao: string | null;
  data: string | null;
  pendente: boolean;
  /** Valor considerado para esta OS: a fatia, quando vem de rateio. */
  valorFace: number;
  vinculo: "DIRETO" | "RATEIO_EXCLUSIVO" | "RATEIO_COMPARTILHADO";
  /** Outros documentos cobertos pelo mesmo dinheiro. */
  outrosDocumentos: string[];
};

function ordenar(titulos: TituloDaOs[]) {
  return titulos.sort((a, b) => {
    if (a.pendente !== b.pendente) return a.pendente ? -1 : 1;
    return Number(a.id) - Number(b.id);
  });
}

export async function levantarTitulosDaOs(osId: number): Promise<TituloDaOs[]> {
  const diretos = await supabaseAdmin
    .from("transacao")
    .select("id, descricao, valor, valor_acrescimos, pendente, data")
    .eq("ordemservicoid", osId)
    .eq("is_deleted", false);
  if (diretos.error) throw diretos.error;

  const fatiasDaOs = await supabaseAdmin
    .from("pagamento_multiplo_rateio")
    .select("transacao_id, valor")
    .eq("tipo_documento", "OS")
    .eq("documento_id", osId);
  if (fatiasDaOs.error) throw fatiasDaOs.error;

  const titulos: TituloDaOs[] = (diretos.data ?? []).map((transacao: any) => ({
    id: String(transacao.id),
    descricao: transacao.descricao ?? null,
    data: transacao.data ?? null,
    pendente: transacao.pendente === true,
    valorFace: valorDeFace(transacao),
    vinculo: "DIRETO",
    outrosDocumentos: [],
  }));

  const idsRateio = Array.from(
    new Set((fatiasDaOs.data ?? []).map((fatia: any) => String(fatia.transacao_id))),
  );
  if (idsRateio.length === 0) return ordenar(titulos);

  const [transacoesRateio, todasAsFatias] = await Promise.all([
    supabaseAdmin
      .from("transacao")
      .select("id, descricao, valor, valor_acrescimos, pendente, data")
      .in("id", idsRateio)
      .eq("is_deleted", false),
    supabaseAdmin
      .from("pagamento_multiplo_rateio")
      .select("transacao_id, tipo_documento, documento_id, valor")
      .in("transacao_id", idsRateio),
  ]);
  if (transacoesRateio.error) throw transacoesRateio.error;
  if (todasAsFatias.error) throw todasAsFatias.error;

  const fatiasPorTransacao = new Map<string, any[]>();
  for (const fatia of todasAsFatias.data ?? []) {
    const chave = String(fatia.transacao_id);
    fatiasPorTransacao.set(chave, [...(fatiasPorTransacao.get(chave) ?? []), fatia]);
  }

  for (const transacao of transacoesRateio.data ?? []) {
    const fatias = fatiasPorTransacao.get(String(transacao.id)) ?? [];
    const desteDocumento = fatias.filter(
      (fatia) =>
        String(fatia.tipo_documento).toUpperCase() === "OS" &&
        Number(fatia.documento_id) === osId,
    );
    const outros = fatias.filter((fatia) => !desteDocumento.includes(fatia));
    const fatiaDaOs =
      Math.round(
        desteDocumento.reduce((total, fatia) => total + Number(fatia.valor ?? 0), 0) * 100,
      ) / 100;

    titulos.push({
      id: String(transacao.id),
      descricao: transacao.descricao ?? null,
      data: transacao.data ?? null,
      pendente: transacao.pendente === true,
      valorFace: fatiaDaOs,
      vinculo: outros.length ? "RATEIO_COMPARTILHADO" : "RATEIO_EXCLUSIVO",
      outrosDocumentos: outros.map(
        (fatia) =>
          `${String(fatia.tipo_documento).toUpperCase() === "VENDA" ? "Venda" : "OS"} #${fatia.documento_id}`,
      ),
    });
  }

  return ordenar(titulos);
}

/** Títulos cujo pagador acompanha a troca de titularidade. */
export function titulosQueAcompanham(titulos: TituloDaOs[]) {
  return titulos.filter((titulo) => titulo.vinculo !== "RATEIO_COMPARTILHADO");
}
