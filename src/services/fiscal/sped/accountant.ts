import { isValidCnpj, isValidCpf, normalizeCnpj, onlyDigits } from "@/lib/fiscal-identifiers";

/** Colunas de `fiscal_sped_contabilista` que viram o registro 0100. */
export type SpedAccountantFields = {
  nome: string;
  cpf: string;
  crc: string;
  cnpj_escritorio: string | null;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  telefone: string | null;
  fax: string | null;
  email: string;
  codigo_municipio: string;
};

export type SpedAccountantPeriod = {
  id: number;
  vigencia_inicio: string;
  vigencia_fim: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Valida e normaliza os dados do contador para o 0100 do leiaute 020. Os campos
 * obrigatórios seguem `layouts/v020/definitions.ts`; os tamanhos, o Guia Prático.
 * `|` é recusado em qualquer campo porque separa os campos do arquivo.
 */
export function normalizeAccountant(raw: Record<string, unknown>): { value: SpedAccountantFields } | { errors: string[] } {
  const errors: string[] = [];
  const text = (key: string, label: string, options: { required?: boolean; max: number }) => {
    const value = clean(raw[key]);
    if (!value) {
      if (options.required) errors.push(`Informe ${label}.`);
      return null;
    }
    if (value.includes("|")) errors.push(`${label} não pode conter o caractere |.`);
    if (value.length > options.max) errors.push(`${label} aceita no máximo ${options.max} caracteres.`);
    return value;
  };
  const phone = (key: string, label: string) => {
    const value = onlyDigits(raw[key]);
    if (!value) return null;
    if (value.length < 10 || value.length > 11) errors.push(`${label} deve ter DDD e número (10 ou 11 dígitos).`);
    return value;
  };

  const nome = text("nome", "o nome do contador", { required: true, max: 100 });
  const crc = text("crc", "o CRC", { required: true, max: 15 });
  const endereco = text("endereco", "o endereço", { required: true, max: 60 });
  const numero = text("numero", "o número", { required: true, max: 10 });
  const complemento = text("complemento", "o complemento", { max: 60 });
  const bairro = text("bairro", "o bairro", { required: true, max: 60 });

  const cpf = onlyDigits(raw.cpf);
  if (!isValidCpf(cpf)) errors.push("CPF do contador inválido.");

  const cnpjRaw = clean(raw.cnpjEscritorio ?? raw.cnpj_escritorio);
  const cnpj = cnpjRaw ? normalizeCnpj(cnpjRaw) : null;
  if (cnpj !== null && !isValidCnpj(cnpj)) errors.push("CNPJ do escritório inválido.");

  const cep = onlyDigits(raw.cep);
  if (cep.length !== 8) errors.push("CEP deve ter 8 dígitos.");

  const email = clean(raw.email).toLowerCase();
  if (!/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(email)) errors.push("Informe um e-mail válido.");

  const codigoMunicipio = onlyDigits(raw.codigoMunicipio ?? raw.codigo_municipio);
  if (codigoMunicipio.length !== 7) errors.push("Selecione o município.");

  const telefone = phone("telefone", "Telefone");
  const fax = phone("fax", "Fax");

  if (errors.length) return { errors };
  return {
    value: {
      nome: nome!,
      cpf,
      crc: crc!,
      cnpj_escritorio: cnpj,
      cep,
      endereco: endereco!,
      numero: numero!,
      complemento,
      bairro: bairro!,
      telefone,
      fax,
      email,
      codigo_municipio: codigoMunicipio,
    },
  };
}

function dayBefore(civilDate: string) {
  const [year, month, day] = civilDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Onde entra um contador que vale a partir de `start` (primeiro dia do mês).
 * As vigências não se sobrepõem: a anterior termina na véspera e a nova termina
 * na véspera da seguinte, se houver. Inserir antes da primeira também vale, para
 * cobrir meses antigos que ainda serão escriturados.
 */
export function planAccountantPeriod(
  existing: readonly SpedAccountantPeriod[],
  start: string,
): { error: string } | { end: string | null; closePrevious: { id: number; end: string } | null } {
  const sorted = [...existing].sort((left, right) => left.vigencia_inicio.localeCompare(right.vigencia_inicio));
  if (sorted.some((period) => period.vigencia_inicio.slice(0, 10) === start)) {
    return { error: "Já existe contador a partir desse mês. Use “Corrigir dados” para alterar." };
  }
  const previous = sorted.filter((period) => period.vigencia_inicio.slice(0, 10) < start).at(-1);
  const next = sorted.find((period) => period.vigencia_inicio.slice(0, 10) > start);
  const previousEnd = previous?.vigencia_fim?.slice(0, 10) ?? null;
  return {
    end: next ? dayBefore(next.vigencia_inicio) : null,
    closePrevious: previous && (previousEnd === null || previousEnd >= start)
      ? { id: previous.id, end: dayBefore(start) }
      : null,
  };
}
