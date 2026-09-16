export type TarefaTipo = "TAREFA" | "NOTA";
export type TarefaStatus = "ABERTA" | "CONCLUIDA";
export type TarefaPrioridade = "BAIXA" | "NORMAL" | "ALTA";

export interface TarefaUsuario {
  id: string;
  usuario_id: string;
  tipo: TarefaTipo;
  titulo: string;
  descricao: string | null;
  status: TarefaStatus;
  prioridade: TarefaPrioridade;
  data_prevista: string | null; // "YYYY-MM-DD"
  lembrete_em: string | null;
  fixada: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type MainTabType = "TAREFAS" | "NOTAS";

export type TaskSubFilter =
  | "hoje"
  | "proximas"
  | "todas"
  | "concluidas"
  | "favoritas";

export type NoteSubFilter = "todas" | "favoritas";

export type TarefasViewFilter =
  | "hoje"
  | "proximas"
  | "todas"
  | "notas"
  | "concluidas"
  | "favoritas";
