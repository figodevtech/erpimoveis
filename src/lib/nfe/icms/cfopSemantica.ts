// Coerência entre o CFOP e o papel da substituição tributária no CST/CSOSN.
//
// A troca 5xxx → 6xxx (cfopOperation.ts) adapta o CFOP à geografia e não diz
// nada sobre ST. Aqui a pergunta é outra: o que o texto OFICIAL do CFOP afirma
// sobre a ST combina com o grupo ICMS escolhido?
//
// Fonte: título oficial do CFOP na Tabela CFOP do Portal Nacional da NF-e
// (catálogo gerado em cfopCatalog.generated.ts, IT 2023.002 v2.10).
//   - "na condição de contribuinte substituto": o emitente retém ICMS-ST nesta
//     operação (5401, 5403, 6401, 6403).
//   - "na condição de contribuinte substituído": a ST já foi cobrada antes
//     (5405).
//   - 6404: exceção ao título curto ("cujo imposto já tenha sido retido
//     anteriormente"). A nota explicativa oficial, na mesma tabela, classifica a
//     venda "na condição de substituto tributário, exclusivamente nas hipóteses
//     em que o imposto já tenha sido retido anteriormente". A SEFAZ-SP aplica o
//     6404 quando o remetente, substituído na origem, passa a reter ICMS-ST para
//     a UF de destino (RC 3837/2014, RC 21691/2020 — esta com CST 10). Não há
//     fonte oficial localizada para 6404 + CST 60; a combinação segue com aviso.
//     O gerador do catálogo confere esses textos e para se a fonte mudar.
//   - Demais menções a "substituição tributária": mercadoria com ST, sem dizer
//     quem retém (transferência, devolução, remessa) — não geram aviso.
//   - Nenhum outro CFOP diz algo sobre ST, e isso NÃO é afirmação de operação
//     sem ST: o CFOP é NEUTRO. A regra antiga "x.1xx = SEM_ST" gerava falso
//     positivo em combinações documentadas pela SEFAZ-SP:
//       6108 + CSOSN 500 (RC 33951/2026) e 6108 + CST 00 (RC 27923/2023).
//     Se um dia houver fonte que ligue CFOP neutro a uma exigência de ST, a
//     regra tem de ser contextual (NCM, CEST, UFs, protocolo, destinatário),
//     não o número do CFOP.
//
// Divergência de descrição é AVISO com ciência: não prova proibição nacional
// nem garante autorização pela SEFAZ. CST/CRT inválido, CFOP inexistente ou
// incompatível com direção/geografia são BLOQUEIO nos validadores estruturais.

import { fingerprintFiscal } from '../issuesFiscais';
import { CFOP_CATALOG_URL, CFOP_CATALOG_VERSION, getCfopCatalogEntry } from '../cfopCatalog';
import type { FonteIssueFiscal, IcmsIssue, TratamentoIcms } from './tipos';

export type PapelStCfop = 'SUBSTITUTO' | 'SUBSTITUIDO' | 'ST_SEM_PAPEL' | 'SEM_ST' | 'NEUTRO';

/** Muda quando a regra ou o catálogo muda: ciência dada antes deixa de valer. */
export const VERSAO_REGRA_CFOP_ST = `cfop-st@2026-09-22|${CFOP_CATALOG_VERSION}`;

type PapelExplicito = { papel: PapelStCfop; fontes: FonteIssueFiscal[] };

// Não derive estas exceções por palavras isoladas. Cada uma precisa de fonte
// oficial identificada, interpretação documentada acima e teste próprio.
const PAPEL_ST_CFOP_EXPLICITO: Partial<Record<string, PapelExplicito>> = {
  '6404': {
    papel: 'SUBSTITUTO',
    fontes: [
      {
        titulo: 'Tabela CFOP — nota explicativa do CFOP 6.404',
        versao: CFOP_CATALOG_VERSION,
        url: CFOP_CATALOG_URL,
        vigenciaDesde: '2006-01-01',
        jurisdicao: 'NACIONAL',
      },
      {
        titulo: 'SEFAZ-SP, Resposta à Consulta 3837/2014 (CFOP 6.404 com nova retenção para a UF de destino)',
        url: 'https://legislacao.fazenda.sp.gov.br/Paginas/RC3837_2014.aspx',
        vigenciaDesde: '2014-10-13',
        jurisdicao: 'SP',
      },
      {
        titulo: 'SEFAZ-SP, Resposta à Consulta 21691/2020 (CFOP 6.404 com CST 10)',
        url: 'https://legislacao.fazenda.sp.gov.br/Paginas/RC21691_2020.aspx',
        vigenciaDesde: '2020-06-05',
        jurisdicao: 'SP',
      },
    ],
  },
};

export function papelStDoCfop(cfop: unknown): PapelStCfop {
  const codigo = String(cfop ?? '').replace(/\D/g, '');
  if (codigo.length !== 4) return 'NEUTRO';
  const explicito = PAPEL_ST_CFOP_EXPLICITO[codigo];
  if (explicito) return explicito.papel;
  const descricao = getCfopCatalogEntry(codigo)?.descricao ?? '';
  if (/na condição de contribuinte substituto\b/i.test(descricao)) return 'SUBSTITUTO';
  if (/contribuinte substituído/i.test(descricao)) return 'SUBSTITUIDO';
  if (/substituição tributária/i.test(descricao)) return 'ST_SEM_PAPEL';
  return 'NEUTRO';
}

function fontesDoPapel(cfop: string): FonteIssueFiscal[] {
  const explicito = PAPEL_ST_CFOP_EXPLICITO[cfop];
  if (explicito) return explicito.fontes;
  return [
    {
      titulo: `Tabela CFOP — título oficial do CFOP ${cfop.slice(0, 1)}.${cfop.slice(1)}`,
      versao: CFOP_CATALOG_VERSION,
      url: CFOP_CATALOG_URL,
      vigenciaDesde: getCfopCatalogEntry(cfop)?.inicioVigencia,
      jurisdicao: 'NACIONAL',
    },
  ];
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
  if (papelCfop === 'NEUTRO' || papelCfop === 'ST_SEM_PAPEL') return [];
  const papelIcms = papelStDoTratamento(input.tratamento, { stAtivada: input.stAtivada });
  const rotulo = `${input.tratamento.regime === 'SIMPLES' ? 'CSOSN' : 'CST'} ${input.tratamento.codigo}`;
  const fontes = fontesDoPapel(cfop);
  const fonte =
    cfop === '6404'
      ? `Fonte: nota explicativa oficial do CFOP 6.404 (Tabela CFOP ${CFOP_CATALOG_VERSION}); SEFAZ-SP RC 3837/2014 e RC 21691/2020.`
      : `Fonte: título oficial do CFOP ${cfop} (Tabela CFOP ${CFOP_CATALOG_VERSION}).`;
  const aviso = (code: string, message: string): IcmsIssue => ({
    code,
    severidade: 'AVISO',
    requerCiencia: true,
    field: 'cfop',
    message: `${message} ${fonte}`,
    fontes,
    // O papel do ICMS resume CST/CSOSN + ST ativada; nos grupos em que a ST é
    // opcional, ligar ou desligar o bloco muda o papel e invalida a ciência.
    fingerprint: fingerprintFiscal({
      code,
      cfop,
      regime: input.tratamento.regime,
      codigoIcms: input.tratamento.codigo,
      papelCfop,
      papelIcms,
      regra: VERSAO_REGRA_CFOP_ST,
    }),
  });

  if (papelCfop === 'SUBSTITUTO' && !retemStNestaOperacao(papelIcms)) {
    return [
      aviso(
        'NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO',
        cfop === '6404'
          ? `A nota explicativa oficial do CFOP 6404 descreve venda "na condição de substituto tributário" ` +
              `(nova retenção para a UF de destino), mas o ${rotulo} ${DESCRICAO_PAPEL_ICMS[papelIcms]}. ` +
              'Confira o CFOP e o CST antes de emitir.'
          : `O CFOP ${cfop} descreve venda "na condição de contribuinte substituto" (ICMS-ST retido nesta operação), ` +
              `mas o ${rotulo} ${DESCRICAO_PAPEL_ICMS[papelIcms]}. Confira o CFOP e o CST antes de emitir.`,
      ),
    ];
  }
  if (papelCfop === 'SUBSTITUIDO' && papelIcms !== 'RETIDA_ANTERIORMENTE') {
    return [
      aviso(
        'NFE_CFOP_ST_SUBSTITUIDO_SEM_ST_ANTERIOR',
        `O CFOP ${cfop} descreve venda de mercadoria com ICMS-ST já cobrado anteriormente, ` +
          `mas o ${rotulo} ${DESCRICAO_PAPEL_ICMS[papelIcms]}. Confira o CFOP e o CST antes de emitir.`,
      ),
    ];
  }
  // Só alcançável por exceção explícita e documentada: nenhum CFOP da tabela
  // oficial afirma operação sem ST.
  if (papelCfop === 'SEM_ST' && !semStNaOperacao(papelIcms)) {
    return [
      aviso(
        'NFE_CFOP_SEM_ST_COM_CST_DE_ST',
        `O texto oficial do CFOP ${cfop} descreve operação sem substituição tributária, ` +
          `mas o ${rotulo} ${DESCRICAO_PAPEL_ICMS[papelIcms]}. Confira o CFOP e o CST antes de emitir.`,
      ),
    ];
  }
  return [];
}
