export type OrdemCustomerSnapshot = {
  nome?: string | null;
  cpfcnpj?: string | null;
  telefone?: string | null;
  email?: string | null;
  codigo_legado?: string | null;
};

type LinkedCustomer = {
  [key: string]: unknown;
  id?: number | null;
  nome?: string | null;
  nomerazaosocial?: string | null;
  cpfcnpj?: string | null;
  documento?: string | null;
  telefone?: string | null;
  email?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseOrdemCustomerSnapshot(value: unknown): OrdemCustomerSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const nome = text(raw.nome);
  if (!nome) return null;

  return {
    nome,
    cpfcnpj: text(raw.cpfcnpj),
    telefone: text(raw.telefone),
    email: text(raw.email),
    codigo_legado: text(raw.codigo_legado),
  };
}

/**
 * O cadastro real sempre vence. Sem cadastro, o snapshot permite consultar o
 * nome original sem transformar a pessoa legada em cliente operacional.
 */
export function resolveOrdemCustomer(linked: LinkedCustomer | null | undefined, snapshotValue: unknown) {
  if (linked) {
    return {
      ...linked,
      id: linked.id ?? null,
      nome: linked.nome ?? linked.nomerazaosocial ?? null,
      nomerazaosocial: linked.nomerazaosocial ?? linked.nome ?? null,
      cpfcnpj: linked.cpfcnpj ?? linked.documento ?? null,
      documento: linked.documento ?? linked.cpfcnpj ?? null,
      historico: false,
    };
  }

  const snapshot = parseOrdemCustomerSnapshot(snapshotValue);
  if (!snapshot) return null;
  return {
    id: null,
    nome: snapshot.nome ?? null,
    nomerazaosocial: snapshot.nome ?? null,
    cpfcnpj: snapshot.cpfcnpj ?? null,
    documento: snapshot.cpfcnpj ?? null,
    telefone: snapshot.telefone ?? null,
    email: snapshot.email ?? null,
    codigo_legado: snapshot.codigo_legado ?? null,
    historico: true,
  };
}
