// Alvo do reparo de uma OS, no formato que os emissores usam para montar o
// bloco de observação da nota.
//
// `alvo_tipo` decide onde o dado mora: VEICULO e PECA apontam para outra tabela,
// EQUIPAMENTO é snapshot na própria OS. A constraint `ordemservico_alvo_consistente`
// garante que só um dos três está preenchido.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AlvoFiscal, AlvoTipoFiscal } from "@/lib/fiscal/blocosDeObservacao";

export const CAMPOS_ALVO_OS =
  "alvo_tipo, veiculoid, pecaid, equipamento_nome, equipamento_patrimonio, equipamento_ano, equipamento_horimetro";

export type OrdemComAlvo = {
  alvo_tipo?: string | null;
  veiculoid?: number | null;
  pecaid?: number | null;
  equipamento_nome?: string | null;
  equipamento_patrimonio?: string | null;
  equipamento_ano?: number | string | null;
  equipamento_horimetro?: number | string | null;
};

export async function carregarAlvoDaOs(os: OrdemComAlvo): Promise<AlvoFiscal | null> {
  // OS antiga pode ter `alvo_tipo` nulo; o padrão histórico é veículo, o mesmo
  // que a rota de detalhe da OS assume.
  const tipo = (os.alvo_tipo ?? "VEICULO") as AlvoTipoFiscal;

  if (tipo === "VEICULO") {
    if (!os.veiculoid) return null;
    const { data } = await supabaseAdmin
      .from("veiculo")
      .select("tipo, placa, marca, modelo, versao, ano, ano_modelo, cor, combustivel, transmissao, chassi, kmatual")
      .eq("id", os.veiculoid)
      .maybeSingle();
    return data ? { tipo, veiculo: data } : null;
  }

  if (tipo === "PECA") {
    if (!os.pecaid) return null;
    const { data } = await supabaseAdmin
      .from("peca")
      .select("titulo, descricao, fabricante, modelo, lacre")
      .eq("id", os.pecaid)
      .maybeSingle();
    return data ? { tipo, peca: data } : null;
  }

  if (!os.equipamento_nome) return null;
  return {
    tipo,
    equipamento: {
      nome: os.equipamento_nome,
      patrimonio: os.equipamento_patrimonio ?? null,
      ano: os.equipamento_ano ?? null,
      horimetro: os.equipamento_horimetro ?? null,
    },
  };
}
