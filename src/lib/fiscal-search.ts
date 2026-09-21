type FiscalSearchNote = {
  id?: unknown;
  modelo?: unknown;
  serie?: unknown;
  numero?: unknown;
  chave_acesso?: unknown;
  ambiente?: unknown;
  status?: unknown;
  protocolo?: unknown;
  referencia?: unknown;
  total_nfe?: unknown;
  ordemservicoid?: unknown;
  vendaid?: unknown;
  entradaid?: unknown;
  saidaid?: unknown;
  nsu?: unknown;
  tipoDocumento?: unknown;
  statusManifestacao?: unknown;
  xmlStatusLabel?: unknown;
  destinatarioOuEmitente?: {
    nomerazaosocial?: unknown;
    cpfcnpj?: unknown;
  } | null;
  empresa?: {
    razaosocial?: unknown;
    nomefantasia?: unknown;
    cnpj?: unknown;
  } | null;
};

export function normalizeFiscalSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ");
}

export function matchesFiscalNoteSearch(note: FiscalSearchNote, query: unknown) {
  const normalizedQuery = normalizeFiscalSearchText(query).trim();
  if (!normalizedQuery) return true;

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const searchableText = [
    note.id,
    note.modelo,
    note.serie,
    note.numero,
    note.chave_acesso,
    note.ambiente,
    note.status,
    note.protocolo,
    note.referencia,
    note.total_nfe,
    note.ordemservicoid,
    note.vendaid,
    note.entradaid,
    note.saidaid,
    note.nsu,
    note.tipoDocumento,
    note.statusManifestacao,
    note.xmlStatusLabel,
    note.destinatarioOuEmitente?.nomerazaosocial,
    note.destinatarioOuEmitente?.cpfcnpj,
    note.empresa?.razaosocial,
    note.empresa?.nomefantasia,
    note.empresa?.cnpj,
  ]
    .map(normalizeFiscalSearchText)
    .join(" ");

  return terms.every((term) => searchableText.includes(term));
}
