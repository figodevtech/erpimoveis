import type { ZodError } from "zod";

/** Nome do campo como aparece nos formulários do ERP (imóvel, proprietário e operações). */
const FIELD_LABELS: Record<string, string> = {
  proprietario_id: "Proprietário",
  titulo: "Título do anúncio",
  codigo: "Código",
  slug: "Endereço do anúncio (slug)",
  tipo: "Tipo do imóvel",
  descricao: "Descrição",
  modalidades: "Modalidades",
  selo_anuncio: "Selo do anúncio",
  endereco: "Endereço",
  endereco_publico: "Detalhes da localização",
  caracteristicas: "Características",
  comodidades: "Comodidades",
  capacidade: "Capacidade de hóspedes",
  quartos: "Quartos",
  banheiros: "Banheiros",
  vagas: "Vagas",
  area: "Área (m²)",
  diaria: "Diária",
  valor_locacao: "Valor da locação",
  valor_venda: "Valor de venda",
  taxa_limpeza: "Taxa de limpeza",
  percentual_admin: "Percentual de administração",
  min_noites: "Mínimo de noites",
  max_noites: "Máximo de noites",
  regras: "Regras da hospedagem",
  cancelamento: "Política de cancelamento",
  horario_checkin: "Horário de check-in",
  horario_checkout: "Horário de check-out",
  nomerazaosocial: "Nome / razão social",
  tipopessoa: "Tipo de pessoa",
  cpfcnpj: "CPF/CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  estado: "UF",
  cep: "CEP",
  dados_bancarios: "Dados bancários",
  telefones: "Telefones",
  imovel_id: "Imóvel",
  cliente_id: "Cliente",
  comprador_id: "Comprador",
  novo_proprietario_id: "Novo proprietário",
  inicio: "Data de início",
  fim: "Data de fim",
  hospedes: "Hóspedes",
  observacoes: "Observações",
  valor_mensal: "Valor mensal",
  dia_vencimento: "Dia de vencimento",
  valor_total: "Valor total",
  comissao_percentual: "Comissão (%)",
  data_venda: "Data da venda",
  parcelas: "Parcelas",
};

/** Campos que guardam o ID de outro cadastro: vazio chega como 0 ou NaN e significa "não selecionado". */
const REFERENCE_FIELDS = new Set(["proprietario_id", "imovel_id", "cliente_id", "comprador_id", "novo_proprietario_id"]);

function fieldLabel(path: PropertyKey[]) {
  const [head, ...rest] = path.map(String);
  if (!head) return "Cadastro";
  const label = FIELD_LABELS[head] ?? head.replaceAll("_", " ");
  if (!rest.length) return label;
  // comodidades.3 → "Comodidades (item 4)"; endereco.cep → "Endereço › cep"
  return /^\d+$/.test(rest[0]) ? `${label} (item ${Number(rest[0]) + 1})` : `${label} › ${rest.join(" › ")}`;
}

function formatMessage(issue: ZodError["issues"][number]): string {
  const field = String(issue.path[0] ?? "");
  const i = issue as any;
  switch (issue.code) {
    case "invalid_type":
      if (REFERENCE_FIELDS.has(field)) return "selecione um cadastro";
      return i.expected === "number" ? "informe um número válido" : "é obrigatório";
    case "too_small": {
      if (REFERENCE_FIELDS.has(field)) return "selecione um cadastro";
      const min = Number(i.minimum);
      if (i.origin === "string") return min <= 1 ? "é obrigatório" : `deve ter pelo menos ${min} caracteres`;
      if (i.origin === "array") return min <= 1 ? "selecione pelo menos uma opção" : `selecione pelo menos ${min} opções`;
      return i.inclusive === false ? `deve ser maior que ${min}` : `deve ser no mínimo ${min}`;
    }
    case "too_big": {
      const max = Number(i.maximum);
      if (i.origin === "string") return `pode ter no máximo ${max} caracteres`;
      if (i.origin === "array") return `aceita no máximo ${max} itens`;
      return i.inclusive === false ? `deve ser menor que ${max}` : `deve ser no máximo ${max}`;
    }
    case "invalid_format":
      if (i.format === "email") return "e-mail inválido";
      if (i.format === "uuid") return "identificador inválido";
      if (field === "slug") return "use só letras minúsculas, números e hífens (ex.: flat-beira-mar-101)";
      if (field.startsWith("horario_")) return "use o formato HH:MM (ex.: 14:00)";
      return "formato inválido";
    case "invalid_value":
      return "opção inválida";
    default:
      // Mensagens próprias dos schemas (refine/superRefine) já estão em português.
      return issue.message;
  }
}

/** Lista legível dos problemas de validação: "Proprietário: selecione um cadastro". */
export function validationDetails(error: ZodError) {
  const seen = new Set<string>();
  const details: string[] = [];
  for (const issue of error.issues) {
    const line = `${fieldLabel(issue.path)}: ${formatMessage(issue)}`;
    // Um campo vazio costuma gerar "mínimo" e "formato" juntos; basta o primeiro.
    const key = issue.path.join(".");
    if (seen.has(key)) continue;
    seen.add(key);
    details.push(line);
  }
  return details;
}

/** Mensagem principal: o primeiro problema e quantos outros existem. */
export function validationSummary(details: string[]) {
  if (!details.length) return "Confira os dados informados.";
  if (details.length === 1) return `Confira o campo ${details[0]}.`;
  return `Corrija ${details.length} campos: ${details[0]}; e mais ${details.length - 1}.`;
}

/** Violação de unicidade (23505) com o campo envolvido, quando o Postgres informa. */
export function duplicateMessage(error: { message?: string; details?: string }) {
  // Vem o nome da constraint (imovel_slug_key) ou o detalhe "Key (slug)=...": sublinhado não separa palavra no \b.
  const text = ` ${error.message ?? ""} ${error.details ?? ""} `.replaceAll("_", " ");
  if (/\bslug\b/.test(text)) return "Já existe um imóvel com esse endereço de anúncio (slug). Use um título diferente.";
  if (/\bcodigo\b/.test(text)) return "Já existe um imóvel com esse código.";
  if (/\bcpfcnpj\b/.test(text)) return "Já existe um cadastro com esse CPF/CNPJ.";
  if (/\bemail\b/.test(text)) return "Já existe um cadastro com esse e-mail.";
  if (/idempotency/.test(text)) return "Esta operação já foi registrada. Atualize a tela antes de tentar de novo.";
  return "Já existe um registro com esses dados.";
}
