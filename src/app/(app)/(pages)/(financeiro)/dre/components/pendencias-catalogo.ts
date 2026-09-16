/**
 * O que cada pendência da DRE quer dizer, em português de oficina.
 *
 * O banco descreve os motivos sem acento — as migrations são ASCII — e em
 * linguagem de quem escreveu a consulta ("Lancamento de OS ainda em execucao: a
 * competencia so e carimbada no encerramento"). Isso serve de rastro no SQL, não
 * de texto de tela. Aqui fica a versão que a pessoa lê, junto do tom: nem toda
 * pendência é defeito, e tratar aviso como erro faz a tarja virar paisagem.
 *
 * A tarja e o diálogo leem deste mesmo lugar, para não divergirem.
 */
import {
  CalendarClock,
  CircleHelp,
  Clock,
  FolderTree,
  Link2Off,
  PackageSearch,
  Receipt,
  ScanSearch,
  Scale,
  type LucideIcon,
} from "lucide-react";

export type TomPendencia = "PROBLEMA" | "AVISO";

export type MotivoPendencia = {
  titulo: string;
  /** Uma linha, para o cartão da tarja. */
  resumo: string;
  /** Parágrafo, no topo do diálogo: o que é e o que fazer. */
  explicacao: string;
  icone: LucideIcon;
  tom: TomPendencia;
  /** Verbo do botão de cada item. Ausente quando não há conserto por aqui. */
  acao?: string;
};

export const MOTIVOS: Record<string, MotivoPendencia> = {
  GRUPO_SEM_DESTINO: {
    titulo: "Grupo sem linha da DRE",
    resumo: "O que for lançado nas contas deste grupo não aparece em nenhuma linha.",
    explicacao:
      "Um grupo sem linha não tem para onde mandar o que é lançado nas contas dele. Escolha a linha do grupo — as contas sem linha própria passam a segui-la, e os lançamentos já feitos são refeitos na hora.",
    icone: FolderTree,
    tom: "PROBLEMA",
    acao: "Escolher linha",
  },
  CONTA_SEM_REGRA: {
    titulo: "Conta sem linha da DRE",
    resumo: "Nem a conta nem o grupo dela dizem para onde o lançamento vai.",
    explicacao:
      "Estas contas não têm linha própria nem herdam uma do grupo. Escolha a linha de cada uma — ou marque várias e defina a mesma linha de uma vez. Vale para todo o histórico.",
    icone: FolderTree,
    tom: "PROBLEMA",
    acao: "Escolher linha",
  },
  EVENTO_SEM_LINHA: {
    titulo: "Lançamento fora do relatório",
    resumo: "Existe no financeiro, mas não entra em nenhuma linha da DRE.",
    explicacao:
      "Quase sempre é lançamento sem plano de conta: sem conta, não há de onde herdar a linha. Abra cada um e escolha a conta. Quando o lançamento vier de OS ou de venda, o conserto é no documento.",
    icone: Link2Off,
    tom: "PROBLEMA",
    acao: "Abrir lançamento",
  },
  NATUREZA_INCOMPATIVEL: {
    titulo: "Lançamento em linha de natureza contrária",
    resumo: "Despesa somando em linha de receita, ou o contrário.",
    explicacao:
      "A DRE fica com aparência válida e número errado. Ou o tipo do lançamento está trocado, ou a conta dele aponta para uma linha que não aceita esse tipo. Abra o lançamento para ver qual dos dois.",
    icone: Scale,
    tom: "PROBLEMA",
    acao: "Abrir lançamento",
  },
  TRANSACAO_SEM_EVENTO: {
    titulo: "Lançamento que deveria estar na DRE",
    resumo: "É movimento de resultado e mesmo assim não gerou linha nenhuma.",
    explicacao:
      "O lançamento se encaixa nas regras de resultado, mas não produziu registro na DRE. Abrir e salvar de novo costuma recriar; se insistir, é caso de análise.",
    icone: ScanSearch,
    tom: "PROBLEMA",
    acao: "Abrir lançamento",
  },
  ITEM_SEM_CUSTO: {
    titulo: "Item vendido sem custo",
    resumo: "A margem do período aparece maior do que é.",
    explicacao:
      "O produto saiu sem custo registrado, então a venda entrou inteira como lucro. Informe o custo por unidade — dá para usar o do cadastro, quando existe, com um clique.",
    icone: PackageSearch,
    tom: "PROBLEMA",
    acao: "Informar custo",
  },
  EXCLUSAO_NAO_REVISADA: {
    titulo: "Valor fora da DRE sem revisão",
    resumo: "Ficou de fora por sugestão automática da migração, não por decisão.",
    explicacao:
      "A migração inicial adivinhou pelo nome do grupo e marcou estes valores como fora do resultado. Enquanto ninguém classificar a conta ou o grupo, a exclusão é um palpite. Abra o lançamento para ver a conta e decidir.",
    icone: CircleHelp,
    tom: "PROBLEMA",
    acao: "Abrir lançamento",
  },
  EVENTO_OS_EM_ABERTO: {
    titulo: "OS ainda em execução",
    resumo: "Entram na DRE no mês em que o serviço terminar.",
    explicacao:
      "A competência é carimbada no encerramento da execução. Não há o que corrigir: é o estado normal de uma oficina com serviço em andamento.",
    icone: Clock,
    tom: "AVISO",
  },
  EVENTO_SEM_COMPETENCIA: {
    titulo: "Lançamento sem competência",
    resumo: "Não pertence a nenhum mês, então não aparece em período nenhum.",
    explicacao:
      "O documento de origem já encerrou, mas o lançamento ficou sem competência. Corrigir exige mexer no documento original, o que reescreveria um mês já apurado — por isso não há botão aqui.",
    icone: CalendarClock,
    tom: "PROBLEMA",
  },
  EVENTO_SEM_FONTE: {
    titulo: "Lançamento sem documento de origem",
    resumo: "Sem documento, não há de onde herdar a competência.",
    explicacao:
      "Nenhuma ação desta tela resolve: o lançamento não tem OS, venda nem transação de onde puxar o período. Estes casos precisam de análise no banco.",
    icone: Receipt,
    tom: "PROBLEMA",
  },
};

/** Motivo desconhecido não some da tela: usa a descrição do banco como título. */
export function motivoDaPendencia(motivo: string, descricaoDoBanco?: string | null): MotivoPendencia {
  return (
    MOTIVOS[motivo] ?? {
      titulo: descricaoDoBanco || motivo,
      resumo: "Pendência sem descrição própria nesta tela.",
      explicacao: descricaoDoBanco || "Sem explicação cadastrada para este motivo.",
      icone: CircleHelp,
      tom: "PROBLEMA",
    }
  );
}

export function escopoEmTexto(escopo: string) {
  if (escopo === "CADASTRO") return "cadastro";
  if (escopo === "GERAL") return "toda a base";
  return "no período";
}
