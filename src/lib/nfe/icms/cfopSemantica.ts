// Coerência entre o CFOP e o papel da substituição tributária no CST/CSOSN.
//
// A troca 5xxx → 6xxx (cfopOperation.ts) adapta o CFOP à geografia e não diz
// nada sobre ST. Aqui a pergunta é outra: o que a descrição OFICIAL do CFOP
// afirma sobre a ST combina com o grupo ICMS escolhido?
//
// Fonte: descrições do CONFAZ no catálogo gerado (cfopCatalog.generated.ts).
//   - "na condição de contribuinte substituto": o emitente retém ICMS-ST nesta
//     operação (5401, 5403, 6401, 6403).
//   - "na condição de contribuinte substituído" / "retido anteriormente": a ST
//     já foi cobrada antes (5405, 6404).
//   - Demais menções a "substituição tributária": mercadoria com ST, sem dizer
//     quem retém (transferência, devolução, remessa) — não geram aviso.
//   - Grupos x.100 (compras e vendas): o leiaute reserva o grupo x.400 para as
//     operações com ST.
//
// O resultado é sempre AVISO: a SEFAZ autoriza essas combinações e a escolha é
// do usuário. O ERP só não deixa a nota sair sem que ele confirme que viu.

import { CFOP_CATALOG_VERSION, getCfopCatalogEntry } from '../cfopCatalog';
import type { IcmsCanonico, IcmsIssue, TratamentoIcms } from './tipos';

export type PapelStCfop = 'SUBSTITUTO' | 'SUBSTITUIDO' | 'ST_SEM_PAPEL' | 'SEM_ST' | 'NEUTRO';

export function papelStDoCfop(cfop: unknown): PapelStCfop {
  const codigo = String(cfop ?? '').replace(/\D/g, '');
  if (codigo.length !== 4) return 'NEUTRO';
  const descricao = getCfopCatalogEntry(codigo)?.descricao ?? '';
  if (/na condição de contribuinte substituto\b/i.test(descricao)) return 'SUBSTITUTO';
  if (/contribuinte substituído|retido anteriormente/i.test(descricao)) return 'SUBSTITUIDO';
  if (/substituição tributária/i.test(descricao)) return 'ST_SEM_PAPEL';
  if (/^[1256]1\d\d$/.test(codigo)) return 'SEM_ST';
  return 'NEUTRO';
}

type PapelStIcms = 'RETEM_NESTA_OPERACAO' | 'RETIDA_ANTERIORMENTE' | 'SEM_ST';

function papelStDoIcms(tratamento: TratamentoIcms, valores: IcmsCanonico): PapelStIcms {
  if (valores.vBCST !== null) return 'RETEM_NESTA_OPERACAO';
  if (tratamento.natureza === 'ST_RETIDA_ANTERIORMENTE' || tratamento.natureza === 'SN_ST_RETIDA_ANTERIORMENTE') {
    return 'RETIDA_ANTERIORMENTE';
  }
  return 'SEM_ST';
}

const DESCRICAO_PAPEL_ICMS: Record<PapelStIcms, string> = {
  RETEM_NESTA_OPERACAO: 'retém ICMS-ST nesta operação',
  RETIDA_ANTERIORMENTE: 'informa ICMS-ST cobrado anteriormente',
  SEM_ST: 'não tem substituição tributária',
};

export function validarCoerenciaCfopIcms(input: {
  cfop: unknown;
  tratamento: TratamentoIcms;
  valores: IcmsCanonico;
}): IcmsIssue[] {
  const cfop = String(input.cfop ?? '').replace(/\D/g, '');
  const papelCfop = papelStDoCfop(cfop);
  const papelIcms = papelStDoIcms(input.tratamento, input.valores);
  const rotulo = `${input.tratamento.regime === 'SIMPLES' ? 'CSOSN' : 'CST'} ${input.tratamento.codigo}`;
  const fonte = `Fonte: descrição oficial do CFOP ${cfop} (CONFAZ, catálogo ${CFOP_CATALOG_VERSION}).`;
  const aviso = (code: string, message: string): IcmsIssue => ({
    code,
    severidade: 'AVISO',
    field: 'cfop',
    message: `${message} ${fonte}`,
  });

  if (papelCfop === 'SUBSTITUTO' && papelIcms !== 'RETEM_NESTA_OPERACAO') {
    return [
      aviso(
        'NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO',
        `O CFOP ${cfop} descreve venda "na condição de contribuinte substituto" (ICMS-ST retido nesta operação), ` +
          `mas o ${rotulo} ${DESCRICAO_PAPEL_ICMS[papelIcms]}. Revise o CFOP ou o CST antes de emitir.`,
      ),
    ];
  }
  if (papelCfop === 'SUBSTITUIDO' && papelIcms !== 'RETIDA_ANTERIORMENTE') {
    return [
      aviso(
        'NFE_CFOP_ST_SUBSTITUIDO_SEM_ST_ANTERIOR',
        `O CFOP ${cfop} descreve venda de mercadoria com ICMS-ST já cobrado anteriormente, ` +
          `mas o ${rotulo} ${DESCRICAO_PAPEL_ICMS[papelIcms]}. Revise o CFOP ou o CST antes de emitir.`,
      ),
    ];
  }
  if (papelCfop === 'SEM_ST' && papelIcms !== 'SEM_ST') {
    return [
      aviso(
        'NFE_CFOP_SEM_ST_COM_CST_DE_ST',
        `O CFOP ${cfop} não é do grupo de operações com substituição tributária (x.400), ` +
          `mas o ${rotulo} ${DESCRICAO_PAPEL_ICMS[papelIcms]}. Revise o CFOP ou o CST antes de emitir.`,
      ),
    ];
  }
  return [];
}
