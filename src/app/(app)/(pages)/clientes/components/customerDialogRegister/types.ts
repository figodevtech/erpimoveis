
export type TipoPessoa = "FISICA" | "JURIDICA";
export type StatusCliente = "ATIVO" | "INATIVO" | "PENDENTE";

/** Linha do card de telefones secundários. Sem `id` quando ainda não foi salva. */
export interface TelefoneSecundario {
  id?: number;
  telefone: string;
  contato: string;
  observacao: string;
}

export interface NewCustomer {
  tipopessoa: TipoPessoa;
  cpfcnpj: string;
  nomerazaosocial: string;
  email: string;
  telefone: string;
  endereco: string;
  endereconumero: string;
  enderecocomplemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  inscricaoestadual: string;
  /** indIEDest da NF-e: 1 contribuinte, 2 isento, 9 não contribuinte. */
  ind_ie_dest?: number | null;
  inscricaomunicipal: string;
  codigomunicipio: string;
  status: StatusCliente;
  foto?: string;
}

export const ESTADOS_BRASIL = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

export const tabTheme =
    " dark:data-[state=active]:bg-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";
