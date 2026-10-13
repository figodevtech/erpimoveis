import type { StatusAluguel, TipoItemAluguel } from "@/lib/alugueis/status";

export type ClienteCadastrado = {
  id: number;
  nomerazaosocial: string;
  cpfcnpj?: string | null;
  telefone?: string | null;
  email?: string | null;
};

export type ItemAluguelResumo = {
  id: number;
  tipo: TipoItemAluguel;
  descricao: string;
  identificacao?: string | null;
  quantidade: number;
  valor: number;
  devolvido_em?: string | null;
};

export type AluguelLista = {
  id: number;
  status: StatusAluguel;
  data_inicio: string;
  data_limite: string;
  pausado_em?: string | null;
  encerrado_em?: string | null;
  cliente_id?: number | null;
  cliente_nome?: string | null;
  cliente_documento?: string | null;
  cliente_telefone?: string | null;
  cliente_email?: string | null;
  observacao?: string | null;
  valor_total: number;
  created_at: string;
  cliente?: ClienteCadastrado | null;
  itens: ItemAluguelResumo[];
  checklists?: { id: number; tipo: "SAIDA" | "RETORNO" }[];
};

export type ItemAluguelDetalhe = ItemAluguelResumo & {
  produto_id?: number | null;
  usoconsumo_item_id?: number | null;
  veiculo_id?: number | null;
  estoque_saida_id?: number | null;
  usoconsumo_saida_id?: number | null;
  produto?: { id: number; titulo: string; referencia?: string | null; estoque?: number | null } | null;
  usoconsumo?: { id: number; titulo: string; referencia?: string | null; estoque?: number | null; escopo?: string } | null;
  veiculo?: { id: number; placa?: string | null; marca?: string | null; modelo?: string | null } | null;
};

export type ChecklistAluguelItem = {
  id: number;
  titulo: string;
  descricao?: string | null;
  status?: "OK" | "ALERTA" | "FALHA" | null;
  observacao?: string | null;
  ordem: number;
  modelo_item_id?: number | null;
  imagens?: { id: number; url: string; descricao?: string | null }[];
};

export type ChecklistAluguel = {
  id: number;
  tipo: "SAIDA" | "RETORNO";
  checklist_modelo_id?: number | null;
  observacao?: string | null;
  realizado_em: string;
  realizador?: { id: string; nome: string } | null;
  itens: ChecklistAluguelItem[];
};

export type EventoAluguel = {
  id: number;
  tipo:
    | "CRIADO"
    | "EDITADO"
    | "PAUSADO"
    | "REINICIADO"
    | "ENCERRADO"
    | "EXCLUIDO"
    | "CHECKLIST_SAIDA"
    | "CHECKLIST_RETORNO";
  dados: Record<string, any>;
  created_at: string;
  usuario?: { id: string; nome: string } | null;
};

export type AluguelDetalhe = Omit<AluguelLista, "itens" | "checklists"> & {
  observacao_encerramento?: string | null;
  updated_at: string;
  criador?: { id: string; nome: string } | null;
  encerrador?: { id: string; nome: string } | null;
  itens: ItemAluguelDetalhe[];
  checklists: ChecklistAluguel[];
  eventos: EventoAluguel[];
};

/** Linha do formulário de criar/editar. `id` existe só para item já gravado. */
export type ItemAluguelForm = {
  chave: string;
  id?: number;
  tipo: TipoItemAluguel;
  produto_id?: number | null;
  usoconsumo_item_id?: number | null;
  veiculo_id?: number | null;
  descricao: string;
  identificacao: string;
  quantidade: number;
  valor: number;
  /** Saldo do estoque no momento da escolha, para avisar falta antes de salvar. */
  disponivel?: number | null;
};

export type AluguelPayload = {
  data_inicio: string;
  data_limite: string;
  cliente_id: number | null;
  cliente?: { nome: string; documento?: string; telefone?: string; email?: string };
  observacao?: string;
  itens: Array<Omit<ItemAluguelForm, "chave" | "disponivel">>;
};

export function nomeDoCliente(aluguel: Pick<AluguelLista, "cliente" | "cliente_nome">): string {
  return aluguel.cliente?.nomerazaosocial || aluguel.cliente_nome || "—";
}
