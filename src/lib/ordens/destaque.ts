// Paleta e regras do destaque visual da OS na listagem.
//
// Duas coisas pintam uma linha da lista de ordens:
//   1. o destaque manual, ligado no dialog de detalhes (colunas `destacada`,
//      `destaque_cor` e `destaque_motivo` de `ordemservico`);
//   2. a regra automatica por status, configurada em Configuracoes Gerais
//      (coluna jsonb `config_geral.destaque_os_por_status`).
//
// Este modulo e a fonte unica das duas: e importado tanto pela API route que
// valida a config quanto pela tabela que renderiza. Por isso nao tem
// "use client" nem importa nada de React.

/** Status que existem no enum `enum_status_os` do banco. */
export const STATUS_OS_VALIDOS = [
  "AGUARDANDO_CHECKLIST",
  "ORCAMENTO",
  "ORCAMENTO_RECUSADO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
  "SEM_COBRANCA",
  "CONCLUIDO",
  "CANCELADO",
] as const;

export type StatusOSValido = (typeof STATUS_OS_VALIDOS)[number];

export function statusOSValido(valor: unknown): valor is StatusOSValido {
  return (STATUS_OS_VALIDOS as readonly string[]).includes(String(valor ?? "").trim().toUpperCase());
}

/** Rotulo legivel do status (a lista mostra o valor cru com espacos no lugar do "_"). */
export function rotuloStatusOS(status: string) {
  return status.replaceAll("_", " ");
}

/**
 * Paleta fechada. E fechada de proposito: as classes do Tailwind precisam
 * existir por extenso no fonte para sobreviverem ao purge, entao montar
 * "bg-" + cor + "-500" nunca funcionaria. As cores `vermelho` e `amarelo` sao
 * as que o destaque manual ja usava — continuam valendo, agora como membros
 * desta mesma paleta.
 */
export const DESTAQUE_CORES = [
  { valor: "vermelho", label: "Vermelho" },
  { valor: "amarelo", label: "Amarelo" },
  { valor: "verde", label: "Verde" },
  { valor: "azul", label: "Azul" },
  { valor: "roxo", label: "Roxo" },
  { valor: "rosa", label: "Rosa" },
  { valor: "ciano", label: "Ciano" },
  { valor: "cinza", label: "Cinza" },
] as const;

export type DestaqueCor = (typeof DESTAQUE_CORES)[number]["valor"];

export const DESTAQUE_COR_PADRAO: DestaqueCor = "vermelho";

export type DestaqueEstilo = {
  /** Classes da <TableRow> na visao de tabela. */
  linha: string;
  /** Classes do <div> do card na visao de grid. */
  card: string;
  /** Classes do botao que abre o tooltip/popover. */
  icone: string;
  /** Preenchimento do proprio <AlertTriangle>. */
  iconeFill: string;
  /** Bolinha solida usada nos seletores de cor e na previa. */
  amostra: string;
};

export const DESTAQUE_ESTILOS: Record<DestaqueCor, DestaqueEstilo> = {
  vermelho: {
    linha: "border-l-4 border-l-red-500 bg-red-500/10 hover:bg-red-500/15 dark:bg-red-950/25 dark:hover:bg-red-950/35",
    card: "border-l-4 border-l-red-500 border-red-500/50 bg-red-500/10 hover:bg-red-500/15 dark:bg-red-950/30",
    icone: "text-red-600 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400",
    iconeFill: "fill-red-500/15",
    amostra: "bg-red-500",
  },
  amarelo: {
    linha: "border-l-4 border-l-amber-500 bg-amber-500/10 hover:bg-amber-500/15 dark:bg-amber-950/25 dark:hover:bg-amber-950/35",
    card: "border-l-4 border-l-amber-500 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/15 dark:bg-amber-950/30",
    icone: "text-amber-600 hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-400",
    iconeFill: "fill-amber-500/15",
    amostra: "bg-amber-500",
  },
  verde: {
    linha: "border-l-4 border-l-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/15 dark:bg-emerald-950/25 dark:hover:bg-emerald-950/35",
    card: "border-l-4 border-l-emerald-500 border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/15 dark:bg-emerald-950/30",
    icone: "text-emerald-600 hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400",
    iconeFill: "fill-emerald-500/15",
    amostra: "bg-emerald-500",
  },
  azul: {
    linha: "border-l-4 border-l-blue-500 bg-blue-500/10 hover:bg-blue-500/15 dark:bg-blue-950/25 dark:hover:bg-blue-950/35",
    card: "border-l-4 border-l-blue-500 border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/15 dark:bg-blue-950/30",
    icone: "text-blue-600 hover:bg-blue-500/10 focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400",
    iconeFill: "fill-blue-500/15",
    amostra: "bg-blue-500",
  },
  roxo: {
    linha: "border-l-4 border-l-violet-500 bg-violet-500/10 hover:bg-violet-500/15 dark:bg-violet-950/25 dark:hover:bg-violet-950/35",
    card: "border-l-4 border-l-violet-500 border-violet-500/50 bg-violet-500/10 hover:bg-violet-500/15 dark:bg-violet-950/30",
    icone: "text-violet-600 hover:bg-violet-500/10 focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-400",
    iconeFill: "fill-violet-500/15",
    amostra: "bg-violet-500",
  },
  rosa: {
    linha: "border-l-4 border-l-pink-500 bg-pink-500/10 hover:bg-pink-500/15 dark:bg-pink-950/25 dark:hover:bg-pink-950/35",
    card: "border-l-4 border-l-pink-500 border-pink-500/50 bg-pink-500/10 hover:bg-pink-500/15 dark:bg-pink-950/30",
    icone: "text-pink-600 hover:bg-pink-500/10 focus-visible:ring-2 focus-visible:ring-pink-500 dark:text-pink-400",
    iconeFill: "fill-pink-500/15",
    amostra: "bg-pink-500",
  },
  ciano: {
    linha: "border-l-4 border-l-cyan-500 bg-cyan-500/10 hover:bg-cyan-500/15 dark:bg-cyan-950/25 dark:hover:bg-cyan-950/35",
    card: "border-l-4 border-l-cyan-500 border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/15 dark:bg-cyan-950/30",
    icone: "text-cyan-600 hover:bg-cyan-500/10 focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-cyan-400",
    iconeFill: "fill-cyan-500/15",
    amostra: "bg-cyan-500",
  },
  cinza: {
    linha: "border-l-4 border-l-slate-500 bg-slate-500/10 hover:bg-slate-500/15 dark:bg-slate-900/40 dark:hover:bg-slate-900/60",
    card: "border-l-4 border-l-slate-500 border-slate-500/50 bg-slate-500/10 hover:bg-slate-500/15 dark:bg-slate-900/40",
    icone: "text-slate-600 hover:bg-slate-500/10 focus-visible:ring-2 focus-visible:ring-slate-500 dark:text-slate-300",
    iconeFill: "fill-slate-500/15",
    amostra: "bg-slate-500",
  },
};

export function destaqueCorValida(valor: unknown): valor is DestaqueCor {
  return DESTAQUE_CORES.some((cor) => cor.valor === valor);
}

/** Estilo da cor pedida, caindo no vermelho — o mesmo fallback que ja existia. */
export function estiloDestaque(cor?: string | null): DestaqueEstilo {
  return destaqueCorValida(cor) ? DESTAQUE_ESTILOS[cor] : DESTAQUE_ESTILOS[DESTAQUE_COR_PADRAO];
}

/** Uma regra de destaque automatico. O texto explicativo e opcional. */
export type RegraDestaqueStatus = {
  cor: DestaqueCor;
  texto: string | null;
};

/** Indexado pelo status: o formato do dado ja garante uma cor por status. */
export type RegrasDestaqueStatus = Partial<Record<StatusOSValido, RegraDestaqueStatus>>;

export const DESTAQUE_TEXTO_MAX = 120;

/**
 * Sanitiza o jsonb vindo do banco ou do PUT. Descarta status desconhecido e cor
 * fora da paleta em vez de explodir: uma config velha (ou um status removido do
 * enum) nao pode derrubar a listagem inteira.
 */
export function normalizarRegrasDestaque(valor: unknown): RegrasDestaqueStatus {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};

  const regras: RegrasDestaqueStatus = {};

  for (const [chave, bruto] of Object.entries(valor as Record<string, unknown>)) {
    const status = String(chave ?? "").trim().toUpperCase();
    if (!statusOSValido(status)) continue;
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) continue;

    const { cor, texto } = bruto as { cor?: unknown; texto?: unknown };
    if (!destaqueCorValida(cor)) continue;

    const textoLimpo = String(texto ?? "").trim().slice(0, DESTAQUE_TEXTO_MAX);
    regras[status] = { cor, texto: textoLimpo || null };
  }

  return regras;
}
