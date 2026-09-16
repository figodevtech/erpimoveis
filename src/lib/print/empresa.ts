// src/lib/print/empresa.ts
//
// Identificação da empresa nas folhas de impressão, a partir do cadastro
// `empresa` — a mesma fonte do cabeçalho da OS e do orçamento. Sem acesso ao
// banco, para poder ser testado direto; a leitura fica em `empresa-server.ts`.

import { formatCpfCnpj, onlyDigits } from "@/lib/ordens/checklist-documento";

export const COLUNAS_EMPRESA_IMPRESSAO =
  "razaosocial, nomefantasia, cnpj, telefone, endereco, numero, complemento, bairro, uf, cep";

export type CadastroEmpresa = Partial<
  Record<"razaosocial" | "nomefantasia" | "cnpj" | "telefone" | "endereco" | "numero" | "complemento" | "bairro" | "uf" | "cep", unknown>
>;

export type EmpresaDaImpressao = {
  /** Nome de exibição: fantasia, ou a razão social quando não há fantasia. */
  nome: string;
  /** Só quando difere do nome — repetir a mesma linha não informa nada. */
  razaoSocial: string | null;
  cnpj: string | null;
  telefone: string | null;
  endereco: string | null;
};

function texto(valor: unknown) {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

function telefone(valor: unknown) {
  const digitos = onlyDigits(valor);
  if (digitos.length === 11) return digitos.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (digitos.length === 10) return digitos.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return texto(valor);
}

function cep(valor: unknown) {
  const digitos = onlyDigits(valor);
  return digitos.length === 8 ? digitos.replace(/^(\d{5})(\d{3})$/, "$1-$2") : texto(valor);
}

export function identificacaoDaEmpresa(cadastro: CadastroEmpresa | null): EmpresaDaImpressao | null {
  if (!cadastro) return null;

  const razaoSocial = texto(cadastro.razaosocial);
  const nome = texto(cadastro.nomefantasia) ?? razaoSocial;
  if (!nome) return null;

  const numero = texto(cadastro.numero);
  const codigoPostal = cep(cadastro.cep);
  const endereco = [
    [texto(cadastro.endereco), numero ? `nº ${numero}` : null, texto(cadastro.complemento)].filter(Boolean).join(", "),
    texto(cadastro.bairro),
    texto(cadastro.uf),
    codigoPostal ? `CEP ${codigoPostal}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    nome,
    razaoSocial: razaoSocial && razaoSocial !== nome ? razaoSocial : null,
    cnpj: texto(cadastro.cnpj) ? formatCpfCnpj(cadastro.cnpj) : null,
    telefone: telefone(cadastro.telefone),
    endereco: endereco || null,
  };
}
