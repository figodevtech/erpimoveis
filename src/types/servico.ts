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
  /** Quando false, realizadores deste serviço não recebem comissão. */
  gera_comissao?: boolean | null;
  /** Serviço usado pelo próprio sistema (LIMPEZA): não sai do catálogo, não fica inativo nem muda de código. */
  chave_sistema?: string | null;
  createdat?: string | null;
  updatedat?: string | null;
}
