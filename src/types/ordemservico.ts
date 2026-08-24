// types/ordemservico.ts
import type { EnumStatusOS, EnumStatusAprovacao, EnumTipoOS } from './enum';
import type { OrdemVehicleSnapshot } from '@/lib/ordens/vehicle-snapshot';

export interface OrdemServico {
  id: number;
  clienteid?: number | null;         // FK -> cliente(id)
  veiculoid?: number | null;         // FK -> veiculo(id)
  tipoos: EnumTipoOS;                // USER-DEFINED
  usuariocriadorid?: string | null;  // uuid FK -> usuario(id)
  setorid?: number | null;           // FK -> setor(id)
  status?: EnumStatusOS | null;      // default 'ABERTA'
  statusaprovacao?: EnumStatusAprovacao | null; // default 'PENDENTE'
  descricao?: string | null;
  dataentrada?: string | null;       // timestamp
  datasaidaprevista?: string | null;
  datasaida?: string | null;
  pagamento_concluido_em?: string | null;
  finalizado_em?: string | null;
  orcamentototal?: number | null;    // numeric
  valor_frete?: number | null;       // numeric; compõe o total comercial
  observacoes?: string | null;
  createdat?: string | null;
  updatedat?: string | null;
  migracao_referencia?: string | null;
  veiculo_snapshot?: OrdemVehicleSnapshot | null;
}
