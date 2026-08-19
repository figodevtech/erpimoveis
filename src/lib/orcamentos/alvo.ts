// Alvo do orcamento avulso — veiculo, peca ou equipamento.
//
// Mesma escolha da OS (ordemservico.alvo_tipo), com uma diferenca: aqui a peca
// mora em colunas do proprio orcamento, e nao em public.peca. Um orcamento pode
// nunca virar OS, e cadastrar a peca ao cotar deixaria registro orfao para cada
// proposta recusada — a linha de public.peca so nasce na conversao.
//
// O alvo e exclusivo: escolher um tipo limpa os campos dos outros dois. A mesma
// regra esta como CHECK no banco; normalizar aqui e o que evita que o usuario
// veja um erro cru de constraint.

import { OrcamentoInvalidoError } from "./itens";

export const ALVOS_ORCAMENTO = ["VEICULO", "PECA", "EQUIPAMENTO"] as const;
export type AlvoTipoOrcamento = (typeof ALVOS_ORCAMENTO)[number];

/** As colunas de alvo, prontas para o insert/update de public.orcamento. */
export type ColunasAlvoOrcamento = {
  alvo_tipo: AlvoTipoOrcamento;
  veiculoid: number | null;
  peca_titulo: string | null;
  peca_descricao: string | null;
  peca_lacre: string | null;
  equipamento_nome: string | null;
  equipamento_patrimonio: string | null;
  equipamento_ano: number | null;
  equipamento_horimetro: number | null;
};

export type AlvoEntrada = {
  alvoTipo?: unknown;
  veiculoid?: unknown;
  peca?: { titulo?: unknown; descricao?: unknown; lacre?: unknown } | null;
  equipamento?: {
    nome?: unknown;
    patrimonio?: unknown;
    ano?: unknown;
    horimetro?: unknown;
  } | null;
};

const VAZIO: Omit<ColunasAlvoOrcamento, "alvo_tipo"> = {
  veiculoid: null,
  peca_titulo: null,
  peca_descricao: null,
  peca_lacre: null,
  equipamento_nome: null,
  equipamento_patrimonio: null,
  equipamento_ano: null,
  equipamento_horimetro: null,
};

function texto(valor: unknown): string | null {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

export function sanitizarAlvoTipo(valor: unknown): AlvoTipoOrcamento {
  const bruto = String(valor ?? "").trim().toUpperCase();
  return (ALVOS_ORCAMENTO as readonly string[]).includes(bruto)
    ? (bruto as AlvoTipoOrcamento)
    : "VEICULO";
}

export function normalizarAlvoOrcamento(body: AlvoEntrada): ColunasAlvoOrcamento {
  const alvo_tipo = sanitizarAlvoTipo(body?.alvoTipo);

  if (alvo_tipo === "VEICULO") {
    const bruto = body?.veiculoid;
    const veiculoid = bruto === null || bruto === undefined || bruto === "" ? null : Number(bruto);
    if (veiculoid !== null && (!Number.isInteger(veiculoid) || veiculoid <= 0)) {
      throw new OrcamentoInvalidoError("Veículo inválido.");
    }
    return { ...VAZIO, alvo_tipo, veiculoid };
  }

  if (alvo_tipo === "PECA") {
    const peca_titulo = texto(body?.peca?.titulo);
    if (!peca_titulo) {
      throw new OrcamentoInvalidoError("Informe o nome da peça que será atendida.");
    }
    return {
      ...VAZIO,
      alvo_tipo,
      peca_titulo,
      peca_descricao: texto(body?.peca?.descricao),
      peca_lacre: texto(body?.peca?.lacre),
    };
  }

  const equipamento_nome = texto(body?.equipamento?.nome);
  if (!equipamento_nome) {
    throw new OrcamentoInvalidoError("Informe o nome da máquina ou equipamento.");
  }

  const anoBruto = body?.equipamento?.ano;
  const equipamento_ano =
    anoBruto === null || anoBruto === undefined || anoBruto === "" ? null : Number(anoBruto);
  if (
    equipamento_ano !== null &&
    (!Number.isInteger(equipamento_ano) || equipamento_ano < 1900 || equipamento_ano > 3000)
  ) {
    throw new OrcamentoInvalidoError("Ano do equipamento inválido.");
  }

  const horimetroBruto = body?.equipamento?.horimetro;
  const equipamento_horimetro =
    horimetroBruto === null || horimetroBruto === undefined || horimetroBruto === ""
      ? null
      : Number(horimetroBruto);
  if (
    equipamento_horimetro !== null &&
    (!Number.isFinite(equipamento_horimetro) || equipamento_horimetro < 0)
  ) {
    throw new OrcamentoInvalidoError("Horímetro inválido.");
  }

  return {
    ...VAZIO,
    alvo_tipo,
    equipamento_nome,
    equipamento_patrimonio: texto(body?.equipamento?.patrimonio),
    equipamento_ano,
    equipamento_horimetro,
  };
}
