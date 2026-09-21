// Coerência entre o CFOP e o papel da substituição tributária no CST/CSOSN.
//
// A troca 5xxx → 6xxx (cfopOperation.ts) adapta o CFOP à geografia e não diz
// nada sobre ST. Aqui a pergunta é outra: o que a descrição OFICIAL do CFOP
// afirma sobre a ST combina com o grupo ICMS escolhido?
//
// Fonte: descrições do CONFAZ no catálogo gerado (cfopCatalog.generated.ts).
//   - "na condição de contribuinte substituto": o emitente retém ICMS-ST nesta
//     operação (5401, 5403, 6401, 6403).
//   - "na condição de contribuinte substituído": a ST já foi cobrada antes
//     (5405).
//   - O 6404 é uma exceção ao texto curto do catálogo: sua nota explicativa
//     oficial classifica a venda "na condição de substituto tributário",
//     exclusivamente quando o imposto já foi retido anteriormente. A SEFAZ-SP
//     confirma 6404 + CST 10 quando há nova retenção para a UF de destino:
//     https://legislacao.fazenda.sp.gov.br/Paginas/RC21691_2020.aspx
//     Nota explicativa oficial reproduzida pela SEFAZ-PB, Anexo 07, item 6.404:
//     https://www.sefaz.pb.gov.br/attachments/article/1522/ANEXO%2007%20-%20C%C3%93DIGO%20FISCAL%20DE%20OPERA%C3%87%C3%95ES%20E%20DE%20%20PRESTA%C3%87%C3%95ES%20-%20CFOP%20-%20ATUALIZADO%20EM%2002.01.20.pdf
//   - Demais menções a "substituição tributária": mercadoria com ST, sem dizer
//     quem retém (transferência, devolução, remessa) — não geram aviso.
//   - Grupos x.100 (compras e vendas): o leiaute reserva o grupo x.400 para as
//     operações com ST.
//
// Divergência de descrição é AVISO: não prova proibição nacional. Não garante
// autorização pela SEFAZ. CST/CRT inválido, CFOP inexistente ou incompatível
// com direção/geografia são BLOQUEIO nos validadores estruturais específicos.
// Papel neutro ou ST sem papel explícito não gera alerta. A classificação é do usuário.

import { CFOP_CATALOG_VERSION, getCfopCatalogEntry } from '../cfopCatalog';
import type { IcmsIssue, TratamentoIcms } from './tipos';

export type PapelStCfop = 'SUBSTITUTO' | 'SUBSTITUIDO' | 'ST_SEM_PAPEL' | 'SEM_ST' | 'NEUTRO';

// Não derive estas exceções por palavras isoladas. O texto curto do 6404 diz
// "retido anteriormente", enquanto a nota explicativa completa define o papel
// atual do emitente como substituto tributário.
const PAPEL_ST_CFOP_EXPLICITO: Partial<Record<string, PapelStCfop>> = {
  '6404': 'SUBSTITUTO',
};

export function papelStDoCfop(cfop: unknown): PapelStCfop {
  const codigo = String(cfop ?? '').replace(/\D/g, '');
  if (codigo.length !== 4) return 'NEUTRO';
  const papelExplicito = PAPEL_ST_CFOP_EXPLICITO[codigo];
  if (papelExplicito) return papelExplicito;
  const descricao = getCfopCatalogEntry(codigo)?.descricao ?? '';
  if (/na condição de contribuinte substituto\b/i.test(descricao)) return 'SUBSTITUTO';
  if (/contribuinte substituído/i.test(descricao)) return 'SUBSTITUIDO';
  if (/substituição tributária/i.test(descricao)) return 'ST_SEM_PAPEL';
  if (/^[1256]1\d\d$/.test(codigo)) return 'SEM_ST';
  return 'NEUTRO';
}

export type PapelStIcms =
  | 'RETEM_NESTA_OPERACAO'
  | 'RETIDA_ANTERIORMENTE'
  | 'SEM_ST'
  | 'ST_OPCIONAL_ATIVADA'
  | 'ST_OPCIONAL_NAO_ATIVADA';

/**
 * Papel semântico do CST/CSOSN, separado da completude de seus campos.
 *
 * Nos grupos obrigatórios, faltar vBCST é uma pendência de preenchimento e não
 * muda o papel tributário. Só CST 90/CSOSN 900 dependem da decisão explícita da
 * emissão, pois a matriz permite que o bloco ST seja ligado ou desligado.
 */
export function papelStDoTratamento(
  tratamento: TratamentoIcms,
  decisao: { stAtivada?: boolean } = {},
): PapelStIcms {
  if (tratamento.natureza === 'ST_RETIDA_ANTERIORMENTE' || tratamento.natureza === 'SN_ST_RETIDA_ANTERIORMENTE') {
    return 'RETIDA_ANTERIORMENTE';
  }
  if (tratamento.blocos.st === 'OBRIGATORIO') return 'RETEM_NESTA_OPERACAO';
  if (tratamento.blocos.st === 'OPCIONAL') {
    return decisao.stAtivada ? 'ST_OPCIONAL_ATIVADA' : 'ST_OPCIONAL_NAO_ATIVADA';
  }
  return 'SEM_ST';
}

const DESCRICAO_PAPEL_ICMS: Record<PapelStIcms, string> = {
  RETEM_NESTA_OPERACAO: 'retém ICMS-ST nesta operação',
  RETIDA_ANTERIORMENTE: 'informa ICMS-ST cobrado anteriormente',
  SEM_ST: 'não tem substituição tributária',
  ST_OPCIONAL_ATIVADA: 'tem o bloco opcional de ICMS-ST ativado nesta operação',
  ST_OPCIONAL_NAO_ATIVADA: 'não ativou o bloco opcional de ICMS-ST nesta operação',
};

function retemStNestaOperacao(papel: PapelStIcms) {
  return papel === 'RETEM_NESTA_OPERACAO' || papel === 'ST_OPCIONAL_ATIVADA';
}

function semStNaOperacao(papel: PapelStIcms) {
  return papel === 'SEM_ST' || papel === 'ST_OPCIONAL_NAO_ATIVADA';
}

export function validarCoerenciaCfopIcms(input: {
  cfop: unknown;
  tratamento: TratamentoIcms;
  /** Decisão explícita somente para grupos em que a ST é opcional. */
  stAtivada?: boolean;
}): IcmsIssue[] {
  const cfop = String(input.cfop ?? '').replace(/\D/g, '');
  const papelCfop = papelStDoCfop(cfop);
  const papelIcms = papelStDoTratamento(input.tratamento, { stAtivada: input.stAtivada });
  const rotulo = `${input.tratamento.regime === 'SIMPLES' ? 'CSOSN' : 'CST'} ${input.tratamento.codigo}`;
  const fonte =
    cfop === '6404'
      ? `Fonte: nota explicativa oficial do CFOP 6.404 e catálogo CONFAZ ${CFOP_CATALOG_VERSION}.`
      : `Fonte: descrição oficial do CFOP ${cfop} (CONFAZ, catálogo ${CFOP_CATALOG_VERSION}).`;
  const aviso = (code: string, message: string): IcmsIssue => ({
    code,
    severidade: 'AVISO',
    requerCiencia: true,
    field: 'cfop',
    message: `${message} ${fonte}`,
  });

  if (papelCfop === 'SUBSTITUTO' && !retemStNestaOperacao(papelIcms)) {
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
  if (papelCfop === 'SEM_ST' && !semStNaOperacao(papelIcms)) {
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
