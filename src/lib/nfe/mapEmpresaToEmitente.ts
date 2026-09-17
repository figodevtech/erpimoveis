// src/lib/nfe/mapEmpresaToEmitente.ts
import type { EmpresaRow, NFeEmitente } from './types';
import { normalizarCRT } from './fiscal';
import { normalizeCnpj } from '@/lib/fiscal-identifiers';

function soNumeros(valor: string | number | null | undefined): string {
  if (!valor) return '';
  return String(valor).replace(/\D/g, '');
}

/**
 * Converte o registro da tabela "empresa" em um objeto NFeEmitente
 * pronto para ser usado na geracao do XML.
 */
export function mapEmpresaToEmitente(
  empresa: EmpresaRow,
  nomeMunicipio: string
): NFeEmitente {
  return {
    cnpj: normalizeCnpj(empresa.cnpj),
    razaoSocial: empresa.razaosocial,
    nomeFantasia: empresa.nomefantasia || undefined,
    inscricaoEstadual: soNumeros(empresa.inscricaoestadual),
    inscricaoEstadualST: soNumeros(empresa.inscricaoestadualst),
    inscricaoMunicipal: soNumeros(empresa.inscricaomunicipal),
    cnae: soNumeros(empresa.cnae) || undefined,
    crt: normalizarCRT(empresa.regimetributario),
    endereco: {
      logradouro: empresa.endereco,
      numero: empresa.numero || 'S/N',
      complemento: empresa.complemento || undefined,
      bairro: empresa.bairro || 'CENTRO',
      codigoMunicipio: empresa.codigomunicipio,
      nomeMunicipio,
      uf: empresa.uf || 'PB',
      cep: soNumeros(empresa.cep),
      codigoPais: empresa.codigopais || '1058',
      nomePais: empresa.nomepais || 'BRASIL',
      telefone: soNumeros(empresa.telefone),
    },
  };
}
