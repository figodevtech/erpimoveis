// src/lib/nfe/mapClienteToDestinatario.ts
import { IND_IE_DEST_CONTRIBUINTE, normalizarIndIEDest } from "./indIEDest";
import type { ClienteRow, EmpresaRow, NFeDestinatario } from "./types";

function soNumeros(value: string | null | undefined): string {
  return value ? value.replace(/\D/g, "") : "";
}

/**
 * Converte um cliente da OS em um destinatario pronto para o XML da NF-e.
 * Usa dados da empresa como fallback para UF/codigo do municipio/CEP.
 */
export function mapClienteToDestinatario(
  cliente: ClienteRow,
  empresa?: EmpresaRow
): NFeDestinatario {
  const documento = soNumeros(cliente.cpfcnpj);
  const isCnpj = documento.length > 11;

  const codigoMunicipio =
    cliente.codigomunicipio ||
    empresa?.codigomunicipio ||
    "0000000";

  const nomeMunicipio = cliente.cidade || "NAO INFORMADO";
  const uf = cliente.estado || empresa?.uf || "PB";
  const cep = soNumeros(cliente.cep) || soNumeros(empresa?.cep ?? "");
  const telefone = soNumeros(cliente.telefone);
  const ie = soNumeros(cliente.inscricaoestadual);

  // A situação fiscal vem do cadastro. Deduzir da existência da IE (o que era
  // feito aqui) manda <indIEDest>1</indIEDest> para quem tem inscrição baixada
  // na UF, e a SEFAZ devolve a rejeição 306. Sem classificação, a validação em
  // buildNFe barra a emissão e pede a confirmação do usuário.
  const indIEDest = normalizarIndIEDest(cliente.ind_ie_dest);

  const dest: NFeDestinatario = {
    cnpj: isCnpj ? documento : undefined,
    cpf: !isCnpj ? documento : undefined,
    razaoSocial: cliente.nomerazaosocial,
    indIEDest: indIEDest as NFeDestinatario["indIEDest"],
    inscricaoEstadual:
      indIEDest === IND_IE_DEST_CONTRIBUINTE && ie ? ie : undefined,
    endereco: {
      logradouro: cliente.endereco || "NAO INFORMADO",
      numero: cliente.endereconumero || "S/N",
      complemento: cliente.enderecocomplemento || undefined,
      bairro: cliente.bairro || "CENTRO",
      codigoMunicipio,
      nomeMunicipio,
      uf,
      cep: cep || "00000000",
      codigoPais: "1058",
      nomePais: "BRASIL",
      telefone: telefone || undefined,
    },
  };

  return dest;
}
