// src/lib/nfe/validarEmitente.ts

import type { EmpresaRow } from './types';
import { isValidCnpj } from '@/lib/fiscal-identifiers';

type ErroValidacao = {
  campo: string;
  mensagem: string;
};

function vazio(valor: string | number | null | undefined): boolean {
  return !valor || String(valor).trim() === '';
}

function soNumeros(valor: string | number | null | undefined): string {
  if (!valor) return '';
  return String(valor).replace(/\D/g, '');
}

/**
 * Valida se o registro da tabela "empresa" tem os dados minimos
 * necessarios para ser usado como emitente da NF-e.
 */
export function validarEmitenteEmpresa(empresa: EmpresaRow): ErroValidacao[] {
  const erros: ErroValidacao[] = [];

  if (vazio(empresa.cnpj)) {
    erros.push({ campo: 'cnpj', mensagem: 'CNPJ e obrigatorio.' });
  } else if (!isValidCnpj(empresa.cnpj)) {
    erros.push({ campo: 'cnpj', mensagem: 'CNPJ numerico ou alfanumerico invalido.' });
  }

  if (vazio(empresa.razaosocial)) {
    erros.push({ campo: 'razaosocial', mensagem: 'Razao social e obrigatoria.' });
  }

  if (vazio(empresa.inscricaoestadual)) {
    erros.push({ campo: 'inscricaoestadual', mensagem: 'Inscricao estadual e obrigatoria.' });
  }

  if (vazio(empresa.endereco)) {
    erros.push({ campo: 'endereco', mensagem: 'Endereco (logradouro) e obrigatorio.' });
  }

  if (vazio(empresa.numero)) {
    erros.push({ campo: 'numero', mensagem: 'Numero do endereco e obrigatorio.' });
  }

  if (vazio(empresa.bairro)) {
    erros.push({ campo: 'bairro', mensagem: 'Bairro e obrigatorio.' });
  }

  const cep = soNumeros(empresa.cep);
  if (!cep) {
    erros.push({ campo: 'cep', mensagem: 'CEP e obrigatorio.' });
  } else if (cep.length !== 8) {
    erros.push({ campo: 'cep', mensagem: 'CEP deve ter 8 digitos numericos.' });
  }

  if (vazio(empresa.uf)) {
    erros.push({ campo: 'uf', mensagem: 'UF e obrigatoria.' });
  } else if ((empresa.uf || '').length !== 2) {
    erros.push({ campo: 'uf', mensagem: 'UF deve ter 2 caracteres (ex: PB).' });
  }

  if (vazio(empresa.codigomunicipio)) {
    erros.push({ campo: 'codigomunicipio', mensagem: 'Codigo do municipio (IBGE) e obrigatorio.' });
  } else if (soNumeros(empresa.codigomunicipio).length !== 7) {
    erros.push({
      campo: 'codigomunicipio',
      mensagem: 'Codigo do municipio (IBGE) deve ter 7 digitos numericos.',
    });
  }

  if (vazio(empresa.regimetributario)) {
    erros.push({ campo: 'regimetributario', mensagem: 'Regime tributario (CRT) e obrigatorio.' });
  } else if (!['1', '2', '3', '4'].includes(String(empresa.regimetributario))) {
    erros.push({
      campo: 'regimetributario',
      mensagem: 'Regime tributario (CRT) deve ser 1, 2, 3 ou 4.',
    });
  }

  if (vazio(empresa.codigopais)) {
    erros.push({
      campo: 'codigopais',
      mensagem: 'Codigo do pais e obrigatorio (Brasil = 1058).',
    });
  }

  if (vazio(empresa.nomepais)) {
    erros.push({
      campo: 'nomepais',
      mensagem: 'Nome do pais e obrigatorio (BRASIL).',
    });
  }

  if (!vazio(empresa.telefone)) {
    const fone = soNumeros(empresa.telefone);
    if (fone.length < 10 || fone.length > 11) {
      erros.push({
        campo: 'telefone',
        mensagem: 'Telefone deve ter 10 ou 11 digitos (com DDD), apenas numeros.',
      });
    }
  }

  return erros;
}
