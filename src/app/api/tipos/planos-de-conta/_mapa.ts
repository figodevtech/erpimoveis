/**
 * Forma da conta na resposta da API.
 *
 * O contrato antigo é preservado campo a campo — inclusive `icone`, que a tela
 * de tipos usa, e `codigo_sistema`, que antes vinha sempre nulo e agora carrega
 * a chave real quando a conta veio do catálogo. Os campos novos são aditivos.
 */

export type LinhaVisaoConta = {
  conta_id: number;
  conta_codigo: string | null;
  conta_nome: string;
  conta_descricao: string | null;
  conta_ativo: boolean;
  conta_origem: string;
  conta_codigo_sistema: string | null;
  conta_versao: number;
  grupo_id: number;
  grupo_codigo: string | null;
  grupo_nome: string;
  grupo_ativo: boolean;
  grupo_origem: string;
  grupo_codigo_sistema: string | null;
  grupo_versao: number;
  classificacao_especifica: string | null;
  classificacao: string | null;
  classificacao_nome: string | null;
  classificacao_origem: string | null;
  familia: string | null;
  tratamento: string | null;
  naturezas: string[] | null;
  linha_codigo: string | null;
  linha_nome: string | null;
  motivo: string | null;
  situacao: string;
  transacoes: number | string;
};

export function mapearConta(linha: LinhaVisaoConta) {
  return {
    id: Number(linha.conta_id),
    codigo: linha.conta_codigo ?? null,
    nome: linha.conta_nome,
    descricao: linha.conta_descricao ?? null,
    grupo_id: Number(linha.grupo_id),
    grupo: {
      id: Number(linha.grupo_id),
      codigo: linha.grupo_codigo ?? "",
      nome: linha.grupo_nome,
      descricao: null,
      ativo: Boolean(linha.grupo_ativo),
      origem_cadastro: linha.grupo_origem,
      codigo_sistema: linha.grupo_codigo_sistema ?? null,
      versao_registro: Number(linha.grupo_versao ?? 1),
    },
    icone: "other",
    codigo_sistema: linha.conta_codigo_sistema ?? null,
    ativo: Boolean(linha.conta_ativo),

    origem_cadastro: linha.conta_origem,
    versao_registro: Number(linha.conta_versao ?? 1),
    /** Preenchido só quando a conta tem exceção; nulo significa herdar o grupo. */
    classificacao_especifica: linha.classificacao_especifica ?? null,
    classificacao: linha.classificacao
      ? {
          codigo: linha.classificacao,
          nome: linha.classificacao_nome ?? linha.classificacao,
          familia: linha.familia ?? null,
          tratamento: linha.tratamento ?? null,
          naturezas: linha.naturezas ?? [],
          herdada: !linha.classificacao_especifica,
          origem: linha.classificacao_origem ?? null,
        }
      : null,
    destino: {
      situacao: linha.situacao,
      linha_codigo: linha.linha_codigo ?? null,
      linha_nome: linha.linha_nome ?? null,
      motivo: linha.motivo ?? null,
    },
    transacoes: Number(linha.transacoes ?? 0),
  };
}

export type ContaDaApi = ReturnType<typeof mapearConta>;
