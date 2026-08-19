import type {
  ItemProduto,
  ItemProdutoAvulso,
  ItemServico,
  TipoDesconto,
} from "../ordens/components/orcamento/tipos";
import type { AlvoTipoOrcamento } from "@/lib/orcamentos/alvo";

export type { AlvoTipoOrcamento };

/** Espelha o CHECK de public.orcamento.status. */
export type SituacaoOrcamento = "ABERTO" | "CONVERTIDO";

export type ClienteResumo = {
  id: number;
  nomerazaosocial?: string | null;
  cpfcnpj?: string | null;
  telefone?: string | null;
  email?: string | null;
};

export type VeiculoResumo = {
  id: number;
  placa?: string | null;
  modelo?: string | null;
  marca?: string | null;
  ano?: number | null;
  cor?: string | null;
};

export type PecaOrcamento = {
  titulo: string;
  descricao?: string | null;
  lacre?: string | null;
};

export type EquipamentoOrcamento = {
  nome: string;
  patrimonio?: string | null;
  ano?: number | null;
  horimetro?: number | null;
};

/** Colunas de alvo como o banco devolve — a lista repassa a linha crua. */
export type AlvoOrcamentoColunas = {
  alvo_tipo?: AlvoTipoOrcamento | null;
  peca_titulo?: string | null;
  peca_descricao?: string | null;
  peca_lacre?: string | null;
  equipamento_nome?: string | null;
  equipamento_patrimonio?: string | null;
  equipamento_ano?: number | null;
  equipamento_horimetro?: number | null;
};

export type OrcamentoLinha = AlvoOrcamentoColunas & {
  id: number;
  status: SituacaoOrcamento;
  descricao?: string | null;
  observacoes?: string | null;
  subtotal: number;
  desconto_tipo?: TipoDesconto | null;
  desconto: number;
  valor_frete: number;
  total: number;
  created_at: string;
  updated_at?: string | null;
  cliente?: ClienteResumo | null;
  veiculo?: VeiculoResumo | null;
  criador?: { id: string; nome?: string | null } | null;
};

export type OrcamentoDetalhe = OrcamentoLinha & {
  clienteid?: number | null;
  veiculoid?: number | null;
  produtos: ItemProduto[];
  produtosAvulsos: ItemProdutoAvulso[];
  servicos: ItemServico[];
  descontoTipo: TipoDesconto | null;
  valorFrete: number;
  /** Aliases em camelCase: é o formato que o formulário monta e devolve. */
  alvoTipo: AlvoTipoOrcamento;
  peca: PecaOrcamento | null;
  equipamento: EquipamentoOrcamento | null;
  ordensGeradas: Array<{ id: number; status?: string | null }>;
};

export type ListaOrcamentos = {
  items: OrcamentoLinha[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  counters: Record<SituacaoOrcamento, number>;
};

export type PayloadOrcamento = {
  clienteid: number | null;
  /** Só é considerado quando alvoTipo é VEICULO; nos demais o banco exige null. */
  veiculoid: number | null;
  alvoTipo: AlvoTipoOrcamento;
  peca: PecaOrcamento | null;
  equipamento: EquipamentoOrcamento | null;
  descricao: string | null;
  observacoes: string | null;
  produtos: Array<{
    produtoid: number;
    quantidade: number;
    precounitario: number;
    descontoTipo: TipoDesconto | null;
    desconto: number;
  }>;
  servicos: Array<{
    servicoid: number;
    descricao: string | null;
    quantidade: number;
    precounitario: number;
    descontoTipo: TipoDesconto | null;
    desconto: number;
  }>;
  produtosAvulsos: Array<{
    titulo: string;
    quantidade: number;
    precounitario: number;
    descontoTipo: TipoDesconto | null;
    desconto: number;
  }>;
  descontoTipo: TipoDesconto | null;
  desconto: number;
  valorFrete: number;
};

export type AlvoGerarOS =
  | { tipo: "VEICULO"; veiculoid?: number | null; veiculo?: { placa?: string; modelo?: string; marca?: string } }
  | { tipo: "PECA"; peca: { nome: string; descricao?: string | null; lacre?: string | null } }
  | {
      tipo: "EQUIPAMENTO";
      equipamento: { nome: string; patrimonio?: string | null; ano?: number | null; horimetro?: number | null };
    };

export type PayloadGerarOS = {
  setorid: number;
  clienteid: number | null;
  prioridade: "BAIXA" | "NORMAL" | "ALTA";
  status: "ORCAMENTO" | "AGUARDANDO_CHECKLIST";
  alvo: AlvoGerarOS;
};
