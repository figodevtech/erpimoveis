import { Customer } from "../clientes/types";
import { Ordem } from "../ordens/types";

export enum Veiculo_tipos {
  CARROS = "CARROS",
  MOTOS ="MOTOS",
  CAMINHOES ="CAMINHOES",
}
export interface Veiculo {
  id?: number,
  clienteid?: number | null,
  cliente?: Customer,
  placa?: string,
  chassi?: string,
  modelo?: string,
  marca?: string,
  marcaId?: number,
  ano?: number,
  cor?: string,
  kmatual?: number,
  tipo?: Veiculo_tipos,
  ano_modelo?: number,
  versao?: string,
  fipe?: number,
  combustivel?: string,
  transmissao?: string,
  imgUrl?: string | null,
  ordens?: Ordem[]
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount?: number;
}

export const tabTheme =
    " dark:data-[state=active]:bg-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";
