import type { NFeDocumentoReferenciado, NFeIde, NFeItem } from './types';

/** NT 2025.002 v1.53, cronograma e RVs B25-40, VC02-14 e VC02-30. */
export function resolverReferenciasNFe(
  ide: Pick<NFeIde, 'finNFe' | 'tpAmb' | 'dhEmi'>,
  itens: NFeItem[],
  documentos: NFeDocumentoReferenciado[] = [],
): NFeDocumentoReferenciado[] {
  const chavesDosItens = new Set(itens.flatMap((item) => item.dfeReferenciado
    ? [item.dfeReferenciado.chaveAcesso.replace(/\D/g, '')] : []));
  // Os tipos de débito que admitem várias origens não são emitidos por este motor.
  if (chavesDosItens.size > 1) {
    throw new Error('NFE_REFERENCIAS_MULTIPLAS: os itens devem referenciar uma única NF-e (VC02-30, rejeição 1130).');
  }
  if (chavesDosItens.size && documentos.some((documento) =>
    !chavesDosItens.has(documento.chaveAcesso.replace(/\D/g, '')))) {
    throw new Error('NFE_REFERENCIAS_CONFLITANTES: cabeçalho e itens indicam documentos diferentes. Escolha um único nível de referência.');
  }

  // Compatibilidade com rascunhos que repetiam a MESMA origem nos dois níveis.
  // Uma origem distinta nunca é descartada silenciosamente.
  const cabecalho = chavesDosItens.size ? [] : documentos;
  const inicio = ide.tpAmb === 1 ? '2026-11-16' : '2026-11-09';
  if (ide.dhEmi.slice(0, 10) >= inicio) {
    if ((ide.finNFe === 2 || ide.finNFe === 4) && cabecalho.length > 1) {
      throw new Error('NFE_NFREF_MULTIPLAS: esta finalidade admite uma única NF-e no cabeçalho (B25-40, rejeição 255).');
    }
    if (ide.finNFe === 4 && !cabecalho.length && itens.some((item) =>
      !item.dfeReferenciado && !['5921', '6921'].includes(item.cfop))) {
      throw new Error('NFE_DEVOLUCAO_SEM_REFERENCIA: informe a NF-e original no cabeçalho ou em cada item (VC02-14, rejeição 321).');
    }
  }
  return cabecalho;
}
