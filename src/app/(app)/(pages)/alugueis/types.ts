import type { StatusAluguel, TipoItemAluguel } from "@/lib/alugueis/status";

export type ClienteCadastrado = {
  id: number;
  nomerazaosocial: string;
  cpfcnpj?: string | null;
  telefone?: string | null;
  email?: string | null;
};

/** Usuário do sistema que pode receber um aluguel. */
export type UsuarioDestinatario = {
  id: string;
  nome: string | null;
  email?: string | null;
  setor?: { id: number; nome: string } | null;
};

export type ItemAluguelResumo = {
  id: number;
  tipo: TipoItemAluguel;
  descricao: string;
  identificacao?: string | null;
  quantidade: number;
  /** Quanto voltou no encerramento; nulo enquanto aberto (ou encerrado antes do retorno por item). */
  quantidade_devolvida?: number | null;
  valor: number;
  devolvido_em?: string | null;
};

export type AluguelLista = {
  id: number;
  status: StatusAluguel;
  data_inicio: string;
  /** Nula: prazo indeterminado. */
  data_limite: string | null;
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
  /** Usuário do sistema como destinatário; exclusivo com cliente e avulso. */
  usuario_id?: string | null;
  destinatario?: UsuarioDestinatario | null;
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
  data_limite: string | null;
  indeterminado: boolean;
  cliente_id: number | null;
  usuario_id: string | null;
  cliente?: { nome: string; documento?: string; telefone?: string; email?: string };
  observacao?: string;
  itens: Array<Omit<ItemAluguelForm, "chave" | "disponivel">>;
};

/** Quanto voltou do item: a quantidade gravada no encerramento ou, sem ela, tudo. */
export function quantidadeQueVoltou(item: Pick<ItemAluguelResumo, "quantidade" | "quantidade_devolvida">): number {
  return item.quantidade_devolvida ?? item.quantidade;
}

/** Itens encerrados com falta no retorno. */
export function itensQueNaoVoltaram<T extends Pick<ItemAluguelResumo, "quantidade" | "quantidade_devolvida">>(itens: T[]): T[] {
  return itens.filter((item) => quantidadeQueVoltou(item) < item.quantidade);
}

export type TipoDestinatario = "cliente" | "usuario" | "avulso";

/** Quem recebeu o aluguel: cliente do cadastro, usuário do sistema ou avulso. */
export function tipoDestinatario(aluguel: Pick<AluguelLista, "cliente_id" | "usuario_id">): TipoDestinatario {
  if (aluguel.cliente_id) return "cliente";
  if (aluguel.usuario_id) return "usuario";
  return "avulso";
}

export function nomeDoCliente(aluguel: Pick<AluguelLista, "cliente" | "cliente_nome" | "destinatario">): string {
  return (
    aluguel.cliente?.nomerazaosocial ||
    aluguel.destinatario?.nome ||
    aluguel.destinatario?.email ||
    aluguel.cliente_nome ||
    "—"
  );
}
