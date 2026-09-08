/**
 * Forma do grupo na resposta da API. O contrato antigo — id, codigo, nome,
 * descricao, ativo — segue igual; o resto é aditivo.
 */

export type LinhaVisaoGrupo = {
  grupo_id: number;
  codigo: string | null;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  origem: string;
  codigo_sistema: string | null;
  versao: number;
  classificacao: string | null;
  classificacao_nome: string | null;
  familia: string | null;
  tratamento: string | null;
  naturezas: string[] | null;
  linha_codigo: string | null;
  linha_nome: string | null;
  motivo: string | null;
  situacao: string;
  contas: number | string;
  contas_ativas: number | string;
};

export function mapearGrupo(linha: LinhaVisaoGrupo) {
  return {
    id: Number(linha.grupo_id),
    codigo: String(linha.codigo ?? ""),
    nome: linha.nome,
    descricao: linha.descricao ?? null,
    ativo: Boolean(linha.ativo),

    origem_cadastro: linha.origem,
    codigo_sistema: linha.codigo_sistema ?? null,
    versao_registro: Number(linha.versao ?? 1),
    classificacao: linha.classificacao
      ? {
          codigo: linha.classificacao,
          nome: linha.classificacao_nome ?? linha.classificacao,
          familia: linha.familia ?? null,
          tratamento: linha.tratamento ?? null,
          naturezas: linha.naturezas ?? [],
        }
      : null,
    destino: {
      situacao: linha.situacao,
      linha_codigo: linha.linha_codigo ?? null,
      linha_nome: linha.linha_nome ?? null,
      motivo: linha.motivo ?? null,
    },
    contas: Number(linha.contas ?? 0),
    contas_ativas: Number(linha.contas_ativas ?? 0),
  };
}
