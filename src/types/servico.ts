// types/servico.ts
export interface Servico {
  id: number;
  codigo: string;
  descricao: string;
  precohora: number;                  // numeric
  codigoservicomunicipal: string;
  aliquotaiss?: number | null;        // numeric
  cnae?: string | null;
  itemlistaservico: string;
  tiposervicoid?: number | null;      // FK -> tiposervico(id)
  permite_agendamento?: boolean | null;
  /** Quando false, realizadores deste serviço não recebem comissão. */
  gera_comissao?: boolean | null;
  createdat?: string | null;
  updatedat?: string | null;
}
