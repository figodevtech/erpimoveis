/**
 * Tradução de erro do banco para status HTTP nas rotas de plano de contas.
 *
 * As RPCs da Fase 3 usam SQLSTATE próprio — `PT409` para conflito de versão e
 * `PT422` para classificação semanticamente incompatível — justamente para que
 * a rota não precise adivinhar pela mensagem. Adivinhar por texto é como as
 * rotas antigas decidiam entre 409 e 500: uma mensagem traduzida ou reescrita
 * mudava o status sem que ninguém percebesse.
 */

export type ErroDeBanco = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

/**
 * O banco ainda não recebeu as migrations da Entrega A.
 *
 * O Postgres devolve `42883` (função inexistente) e o PostgREST, `PGRST202`.
 * Sem este caso, a tela mostraria "Erro ao carregar planos de conta" e ninguém
 * saberia que o que falta é publicar o schema. A seção 12 do plano pede
 * mensagem clara antes de qualquer escrita parcial: é esta.
 */
const SCHEMA_AUSENTE = new Set(["42883", "PGRST202", "42P01"]);

export function schemaDaClassificacaoAusente(erro: unknown) {
  if (!erro || typeof erro !== "object") return false;
  const objeto = erro as ErroDeBanco;
  if (SCHEMA_AUSENTE.has(String(objeto.code ?? ""))) return true;
  return /plano_contas_visao|plano_contas_grupos_visao|plano_contas_salvar_|dre_previa_da_conta|classificacoes_resultado/.test(
    `${objeto.message ?? ""} ${objeto.details ?? ""} ${objeto.hint ?? ""}`,
  ) && /does not exist|não existe|could not find|schema cache/i.test(
    `${objeto.message ?? ""} ${objeto.details ?? ""} ${objeto.hint ?? ""}`,
  );
}

/** SQLSTATE → status. O que não estiver aqui é erro nosso, não do pedido. */
const PORCODIGO: Record<string, number> = {
  PT409: 409,
  PT422: 422,
  "23505": 409, // unique_violation
  "23503": 409, // foreign_key_violation: o registro está em uso
  "23514": 422, // check_violation
  "22023": 400, // invalid_parameter_value
  P0002: 404, // no_data_found
};

function texto(erro: unknown) {
  if (!erro) return "";
  if (typeof erro === "string") return erro;
  const objeto = erro as ErroDeBanco;
  return String(objeto.message ?? "");
}

function codigo(erro: unknown) {
  if (!erro || typeof erro !== "object") return "";
  return String((erro as ErroDeBanco).code ?? "");
}

export function statusDoErro(erro: unknown): number {
  if (schemaDaClassificacaoAusente(erro)) return 503;

  const porCodigo = PORCODIGO[codigo(erro)];
  if (porCodigo) return porCodigo;

  const mensagem = texto(erro);
  if (/auth|unauth|não autenticado|nao autenticado/i.test(mensagem)) return 401;
  if (/forbidden|permiss/i.test(mensagem)) return 403;
  // Guarda para o caminho que ainda não passa por RPC: o Postgres devolve o
  // texto da constraint quando a violação vem de um INSERT direto.
  if (/duplicate key|already exists|_unique|_key\b/i.test(mensagem)) return 409;
  return 500;
}

/**
 * Mensagem para a tela. As RPCs já escrevem em português e explicam o que
 * fazer; o genérico só entra quando o erro não veio de uma delas.
 */
export function mensagemDoErro(erro: unknown, generica: string) {
  if (schemaDaClassificacaoAusente(erro)) {
    return "Este banco ainda não recebeu as migrations da classificação de resultado. Publique o schema antes de usar esta tela.";
  }

  const mensagem = texto(erro).trim();
  if (!mensagem) return generica;

  const status = statusDoErro(erro);
  if (status === 409 && !PORCODIGO[codigo(erro)]) {
    return "Já existe um cadastro com este código ou nome.";
  }
  if (status === 500) return generica;
  return mensagem;
}
