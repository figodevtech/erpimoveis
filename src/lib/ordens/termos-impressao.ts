// Dizeres (termos de aceite) impressos no rodape da ordem de servico.
//
// Ate a migration `20260911160000_os_termo_impressao` estes textos eram
// constantes de codigo em `src/lib/print-aceite.ts`: trocar uma virgula exigia
// deploy. Agora sao cadastro — cada bloco escolhe a quais status e a quais
// alvos se aplica, e a tela de Configuracoes Gerais edita tudo.
//
// Este modulo e a fonte unica das regras: e importado pela API route que
// valida, pelo card que edita e pela pagina de impressao que renderiza. Por
// isso nao tem "use client" nem importa nada de React — mesmo arranjo de
// `src/lib/ordens/destaque.ts`.

import { STATUS_OS_VALIDOS, statusOSValido, type StatusOSValido } from "./destaque";

export type AlvoTermo = "VEICULO" | "PECA" | "EQUIPAMENTO";

/** Rotulo de cada alvo — tambem e o que `{{alvo}}` vira no texto impresso. */
export const ALVOS_TERMO = [
  { valor: "VEICULO", label: "Veículo", nome: "veículo" },
  { valor: "PECA", label: "Peça/componente", nome: "peça/componente" },
  { valor: "EQUIPAMENTO", label: "Máquina/equipamento", nome: "máquina/equipamento" },
] as const;

export function alvoTermoValido(valor: unknown): valor is AlvoTermo {
  return ALVOS_TERMO.some((alvo) => alvo.valor === valor);
}

/** Nome do alvo como sai no papel ("veículo", "peça/componente"...). */
export function nomeAlvo(alvo: AlvoTermo) {
  return ALVOS_TERMO.find((item) => item.valor === alvo)?.nome ?? "veículo";
}

/** Um bloco de dizeres, no formato em que vive no banco e trafega na API. */
export type TermoImpressao = {
  id: number;
  titulo: string;
  intro: string;
  itens: string[];
  status: StatusOSValido[];
  alvos: AlvoTermo[];
  ordem: number;
};

/** O mesmo bloco ja resolvido, pronto para a pagina de impressao renderizar. */
export type TermoImpressaoResolvido = {
  id: number;
  titulo: string;
  intro: string;
  itens: string[];
};

export const TERMO_TITULO_MAX = 160;
export const TERMO_INTRO_MAX = 300;
export const TERMO_ITEM_MAX = 1200;
export const TERMO_ITENS_MAX = 20;

/** Atalhos da tela: os dois momentos que o sistema ja usava antes do cadastro. */
export const GRUPOS_STATUS_TERMO = [
  {
    id: "ORCAMENTO",
    label: "Orçamento",
    descricao: "A assinatura vale como aprovação do orçamento.",
    status: [
      "AGUARDANDO_CHECKLIST",
      "ORCAMENTO",
      "APROVACAO_ORCAMENTO",
      "ORCAMENTO_APROVADO",
      "ORCAMENTO_RECUSADO",
      "EM_ANDAMENTO",
    ],
  },
  {
    id: "ENTREGA",
    label: "Entrega",
    descricao: "A assinatura vale como aceite da entrega/saída.",
    status: ["PAGAMENTO", "FATURAMENTO", "SEM_COBRANCA", "CONCLUIDO"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  descricao: string;
  status: readonly StatusOSValido[];
}>;

/** Contexto que alimenta as variaveis do texto. */
export type ContextoTermo = {
  alvo: AlvoTermo;
  empresaNome?: string | null;
  osNumero?: string | number | null;
  clienteNome?: string | null;
};

/** Variaveis aceitas no titulo, na introducao e nos itens. */
export const VARIAVEIS_TERMO = [
  { chave: "alvo", descricao: "veículo, peça/componente ou máquina/equipamento" },
  { chave: "empresa_nome", descricao: "nome da empresa" },
  { chave: "os_numero", descricao: "número da ordem de serviço" },
  { chave: "cliente_nome", descricao: "nome do cliente" },
] as const;

/**
 * Troca `{{variavel}}` pelo valor do contexto.
 *
 * Variavel desconhecida — ou conhecida mas sem valor — fica no texto como foi
 * escrita. Some-la deixaria uma frase truncada num documento que o cliente
 * assina; visivel, alguem percebe e corrige.
 */
export function aplicarVariaveis(texto: string, ctx: ContextoTermo) {
  const valores: Record<string, string> = {
    alvo: nomeAlvo(ctx.alvo),
    empresa_nome: String(ctx.empresaNome ?? "").trim(),
    os_numero: String(ctx.osNumero ?? "").trim(),
    cliente_nome: String(ctx.clienteNome ?? "").trim(),
  };

  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (original, chave: string) => {
    const valor = valores[String(chave).toLowerCase()];
    return valor ? valor : original;
  });
}

function textoLimpo(valor: unknown, max: number) {
  return String(valor ?? "").trim().slice(0, max);
}

/**
 * Sanitiza o registro vindo do banco ou do POST/PUT.
 *
 * Descarta status e alvo desconhecidos em vez de explodir: um status removido
 * do enum nao pode derrubar a impressao inteira. Retorna null quando sobra um
 * bloco sem titulo ou sem nenhum item — ai nao ha o que imprimir.
 */
export function normalizarTermo(valor: unknown, id = 0): TermoImpressao | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;

  const bruto = valor as Record<string, unknown>;
  const titulo = textoLimpo(bruto.titulo, TERMO_TITULO_MAX);

  const itens = (Array.isArray(bruto.itens) ? bruto.itens : [])
    .map((item) => textoLimpo(item, TERMO_ITEM_MAX))
    .filter((item) => item.length > 0)
    .slice(0, TERMO_ITENS_MAX);

  if (!titulo || itens.length === 0) return null;

  const status = Array.from(
    new Set(
      (Array.isArray(bruto.status) ? bruto.status : [])
        .map((item) => String(item ?? "").trim().toUpperCase())
        .filter(statusOSValido),
    ),
  );

  const alvos = Array.from(
    new Set(
      (Array.isArray(bruto.alvos) ? bruto.alvos : [])
        .map((item) => String(item ?? "").trim().toUpperCase())
        .filter(alvoTermoValido),
    ),
  );

  const ordemBruta = Number(bruto.ordem);

  return {
    id: Number(bruto.id ?? id) || id,
    titulo,
    intro: textoLimpo(bruto.intro, TERMO_INTRO_MAX),
    itens,
    // A ordem gravada e a da lista: status e alvos seguem a ordem canonica
    // para as etiquetas da tela nao dancarem a cada salvamento.
    status: STATUS_OS_VALIDOS.filter((valido) => status.includes(valido)),
    alvos: ALVOS_TERMO.map((alvo) => alvo.valor).filter((valido) => alvos.includes(valido)),
    ordem: Number.isFinite(ordemBruta) && ordemBruta >= 0 ? Math.floor(ordemBruta) : 0,
  };
}

/**
 * Blocos que entram na impressao desta OS, na ordem cadastrada e com as
 * variaveis ja resolvidas. Bloco sem status ou sem alvo nunca casa — e o jeito
 * de o usuario deixar um texto guardado sem que ele imprima.
 */
export function resolverTermosOS(termos: TermoImpressao[], ctx: ContextoTermo & { status?: string | null }) {
  const status = String(ctx.status ?? "").trim().toUpperCase();

  return termos
    .filter((termo) => termo.status.includes(status as StatusOSValido) && termo.alvos.includes(ctx.alvo))
    .slice()
    .sort((a, b) => a.ordem - b.ordem || a.id - b.id)
    .map<TermoImpressaoResolvido>((termo) => ({
      id: termo.id,
      titulo: aplicarVariaveis(termo.titulo, ctx),
      intro: aplicarVariaveis(termo.intro, ctx),
      itens: termo.itens.map((item) => aplicarVariaveis(item, ctx)),
    }));
}
