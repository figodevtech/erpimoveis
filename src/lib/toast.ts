import type { ReactNode } from "react";
import { toast as sonnerToast, type ExternalToast } from "sonner";

const DEFAULT_ERROR = "Não foi possível concluir a operação. Tente novamente.";
const MAX_MESSAGE_LENGTH = 260;

const TECHNICAL_ERROR_PATTERN = new RegExp(
  [
    "\\b(?:sqlstate|postgres|postgrest|prisma|supabase|stack trace|econnreset|econnrefused|enotfound)\\b",
    "\\b(?:select|insert|update|delete|alter table|create table)\\s+.+\\b(?:from|into|set|where|values)\\b",
    "\\b(?:relation|column)\\s+.+\\s+does not exist\\b",
    "\\bviolates?\\s+.+\\s+constraint\\b",
    "\\bat\\s+[a-z_$][\\w$]*(?:\\.[a-z_$][\\w$]*)?\\s*\\([^)]*:\\d+:\\d+\\)",
    "(?:https?://|/api/)[^\\s]+",
    "\\{\\s*[\"']?(?:error|message|status|cause)[\"']?\\s*:",
  ].join("|"),
  "i",
);

const ENGLISH_ERROR_PATTERN =
  /\b(?:user has|user does|has not|does not|cannot|could not|invalid|failed|failure|forbidden|unauthorized|required|expected|request|response|resource not found|field|fields|body|conflict|rate limited|internal server error|network error|timeout|timed out)\b/i;

function preserveWordCase(source: string, replacement: string) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

function cleanText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\bnao\b/gi, (word) => preserveWordCase(word, "não"))
    .replace(/\bpossivel\b/gi, (word) => preserveWordCase(word, "possível"))
    .replace(/\bpermissao\b/gi, (word) => preserveWordCase(word, "permissão"))
    .replace(/\bservicos\b/gi, (word) => preserveWordCase(word, "serviços"))
    .replace(/\bservico\b/gi, (word) => preserveWordCase(word, "serviço"))
    .replace(/\bhorarios\b/gi, (word) => preserveWordCase(word, "horários"))
    .replace(/\bhorario\b/gi, (word) => preserveWordCase(word, "horário"))
    .replace(/\bdisponiveis\b/gi, (word) => preserveWordCase(word, "disponíveis"))
    .replace(/\bdisponivel\b/gi, (word) => preserveWordCase(word, "disponível"))
    .replace(/\bmovimentacao\b/gi, (word) => preserveWordCase(word, "movimentação"))
    .replace(/\binvalido\b/gi, (word) => preserveWordCase(word, "inválido"))
    .replace(/\bobrigatorio\b/gi, (word) => preserveWordCase(word, "obrigatório"))
    .replace(/\bcodigo\b/gi, (word) => preserveWordCase(word, "código"))
    .replace(/\bdigitos\b/gi, (word) => preserveWordCase(word, "dígitos"))
    .replace(/\bdeletar\b/gi, (word) => preserveWordCase(word, "excluir"))
    .trim();
}

function shorten(text: string) {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  const excerpt = text.slice(0, MAX_MESSAGE_LENGTH - 1);
  const lastBoundary = Math.max(excerpt.lastIndexOf(". "), excerpt.lastIndexOf("; "), excerpt.lastIndexOf(", "));
  return `${(lastBoundary >= 120 ? excerpt.slice(0, lastBoundary + 1) : excerpt).trim()}…`;
}

function knownErrorMessage(text: string) {
  if (/\b429\b|rate[ _-]?limit(?:ed)?|too many requests/i.test(text)) {
    return "O serviço recebeu muitas solicitações em pouco tempo. Aguarde alguns instantes e tente novamente.";
  }
  if (/unauthorized use of live credentials/i.test(text)) {
    return "As credenciais utilizadas não são compatíveis com esta operação. Revise a conta conectada e tente novamente.";
  }
  if (/policyagent|policy returned unauthorized/i.test(text)) {
    return "A aplicação ou a conta conectada não possui permissão para este recurso.";
  }
  if (/user has not access|user does not have access|has no access/i.test(text)) {
    return "A conta conectada não possui acesso a este registro.";
  }
  if (/invalid access token|token (?:has )?expired|jwt expired|\bunauthenticated\b|\b401\b|\bunauthorized\b/i.test(text)) {
    return "Sua sessão ou conexão expirou. Entre novamente e repita a operação.";
  }
  if (/\b403\b|\bforbidden\b|not (?:have|has) access|permission denied/i.test(text)) {
    return "Você não tem permissão para realizar esta operação.";
  }
  if (/network error|failed to fetch|fetch failed|econnrefused|econnreset|enotfound/i.test(text)) {
    return "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.";
  }
  if (/timeout|timed out|tempo limite/i.test(text)) {
    return "A operação demorou mais que o esperado. Tente novamente em alguns instantes.";
  }
  if (/duplicate key|unique constraint|already exists|\b409\b|\bconflict\b/i.test(text)) {
    return "Já existe um registro com essas informações ou ele foi alterado recentemente. Atualize os dados e tente novamente.";
  }
  if (/foreign key|violates? .+ constraint|still referenced/i.test(text)) {
    return "Este registro está sendo utilizado em outra parte do sistema e não pode ser alterado ou excluído.";
  }
  if (/resource not found|not found|\b404\b/i.test(text)) {
    return "O registro solicitado não foi encontrado. Atualize a página e tente novamente.";
  }
  if (/user has not mode me1/i.test(text)) {
    return "A conta conectada não possui essa modalidade de envio. Selecione uma opção disponível para o vendedor.";
  }
  if (/body\.invalid_fields|invalid fields?/i.test(text)) {
    return "Alguns campos não foram aceitos. Revise as informações destacadas e tente novamente.";
  }
  if (/internal server error|\b500\b|\b502\b|\b503\b|\b504\b/i.test(text)) {
    return "O serviço está temporariamente indisponível. Tente novamente em alguns instantes.";
  }
  return null;
}

export function userErrorMessage(value: unknown, fallback = DEFAULT_ERROR) {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  const text = cleanText(raw);
  if (!text) return fallback;

  const knownMessage = knownErrorMessage(text);
  if (knownMessage) return knownMessage;

  if (TECHNICAL_ERROR_PATTERN.test(text) || ENGLISH_ERROR_PATTERN.test(text)) return fallback;
  return shorten(text);
}

function errorTitle(value: unknown): ReactNode {
  if (value instanceof Error) return userErrorMessage(value);
  if (typeof value !== "string") return value as ReactNode;

  const text = cleanText(value);
  if (/^erro$/i.test(text)) return "Não foi possível concluir";
  if (/^erro inesperado\.?$/i.test(text)) return "Não foi possível concluir";
  if (/^erro na consulta$/i.test(text)) return "Não foi possível realizar a consulta";
  if (/^erro na busca$/i.test(text)) return "Não foi possível realizar a busca";
  if (/^erro ao\s+/i.test(text)) return shorten(text.replace(/^erro ao\s+/i, "Não foi possível "));
  if (/^falha ao\s+/i.test(text)) return shorten(text.replace(/^falha ao\s+/i, "Não foi possível "));
  return userErrorMessage(text);
}

function safeDescription(value: ExternalToast["description"]) {
  if (typeof value !== "string") return value;
  return userErrorMessage(value);
}

function showError(message: Parameters<typeof sonnerToast.error>[0], data?: ExternalToast) {
  const originalMessage = message instanceof Error ? message.message : typeof message === "string" ? message : "";
  const originalDescription = typeof data?.description === "string" ? data.description : "";
  const technicalDetail = [originalMessage, originalDescription].find(
    (value) => value && (TECHNICAL_ERROR_PATTERN.test(value) || ENGLISH_ERROR_PATTERN.test(value)),
  );
  if (technicalDetail && process.env.NODE_ENV !== "production") {
    console.error("Detalhe técnico do erro exibido ao usuário:", technicalDetail);
  }

  return sonnerToast.error(errorTitle(message), data ? { ...data, description: safeDescription(data.description) } : data);
}

export const toast = Object.assign(
  (message: Parameters<typeof sonnerToast>[0], data?: Parameters<typeof sonnerToast>[1]) => sonnerToast(message, data),
  sonnerToast,
  { error: showError },
) as typeof sonnerToast;
