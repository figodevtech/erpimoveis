// Cálculo do grupo ICMS de um item a partir da classificação escolhida.
//
// A ordem é fixa: regime do emitente → CST/CSOSN → blocos que o grupo aceita →
// campos informados → só então os valores. Uma alíquota preenchida no cadastro
// nunca cria, sozinha, ICMS próprio: ela só vira pICMS quando o grupo tem ICMS
// próprio (e, no 51/90/SN900, quando a emissão pede o destaque).

import type {
  BlocoIcms,
  CampoIgnorado,
  EntradaIcms,
  IcmsCanonico,
  IcmsIssue,
  ResultadoIcms,
  TratamentoIcms,
} from './tipos';
import { comporBaseIcms } from './baseCalculo';
import { resolverTratamentoIcms } from './tratamento';

type Numero = number | string | null | undefined;

/** Aceita número ou texto digitado ("1.234,56" ou "1234.56"). */
export function numeroIcms(value: Numero): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const sanitized = raw.replace(/[^\d,.-]/g, '');
  const normalized = sanitized.includes(',') ? sanitized.replace(/\./g, '').replace(',', '.') : sanitized;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function presente(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/** Mesmo arredondamento que o motor sempre usou: preserva o XML dos grupos que não mudaram. */
function dinheiro(value: number) {
  return Number(value.toFixed(2));
}

function texto(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function porcentagem(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

export function icmsVazio(tratamento: TratamentoIcms, orig: unknown): IcmsCanonico {
  return {
    grupoXml: tratamento.grupoXml,
    orig: String(orig ?? '').replace(/\D/g, ''),
    cst: tratamento.regime === 'NORMAL' ? tratamento.codigo : null,
    csosn: tratamento.regime === 'SIMPLES' ? tratamento.codigo : null,
    modBC: null,
    pRedBC: null,
    vBC: null,
    pICMS: null,
    vICMS: null,
    vBCFCP: null,
    pFCP: null,
    vFCP: null,
    vICMSOp: null,
    pDif: null,
    vICMSDif: null,
    modBCST: null,
    pMVAST: null,
    pRedBCST: null,
    vBCST: null,
    pICMSST: null,
    vICMSST: null,
    vBCFCPST: null,
    pFCPST: null,
    vFCPST: null,
    vBCSTRet: null,
    pST: null,
    vICMSSubstituto: null,
    vICMSSTRet: null,
    vBCFCPSTRet: null,
    pFCPSTRet: null,
    vFCPSTRet: null,
    pRedBCEfet: null,
    vBCEfet: null,
    pICMSEfet: null,
    vICMSEfet: null,
    vICMSDeson: null,
    motDesICMS: null,
    pCredSN: null,
    vCredICMSSN: null,
  };
}

const ROTULO_BLOCO: Record<BlocoIcms, string> = {
  proprio: 'base, alíquota e valor do ICMS próprio',
  reducaoBase: 'redução da base do ICMS próprio',
  fcp: 'FCP próprio',
  diferimento: 'diferimento',
  st: 'ICMS-ST retido nesta operação',
  fcpSt: 'FCP-ST',
  stRetida: 'ICMS-ST cobrado anteriormente (vBCSTRet, pST, vICMSSTRet)',
  fcpStRetido: 'FCP-ST retido anteriormente',
  icmsEfetivo: 'ICMS efetivo',
  desoneracao: 'ICMS desonerado',
  creditoSn: 'crédito do Simples Nacional',
};

function blocoInformado(entrada: EntradaIcms, bloco: BlocoIcms): boolean {
  const campos = (() => {
    switch (bloco) {
      case 'proprio': {
        const proprio = entrada.proprio;
        if (!proprio) return [];
        return [proprio.destacar === true ? 'sim' : null, proprio.vBC, proprio.vICMS, proprio.modBC];
      }
      case 'reducaoBase':
        return [entrada.proprio?.pRedBC];
      case 'fcp':
        return [entrada.fcp?.pFCP, entrada.fcp?.vFCP];
      case 'diferimento':
        return [entrada.diferimento?.pDif];
      case 'st':
        return Object.values(entrada.st ?? {});
      case 'fcpSt':
        return Object.values(entrada.fcpSt ?? {});
      case 'stRetida':
        return Object.values(entrada.stRetida ?? {});
      case 'fcpStRetido':
        return Object.values(entrada.fcpStRetido ?? {});
      case 'icmsEfetivo':
        return Object.values(entrada.icmsEfetivo ?? {});
      case 'desoneracao':
        return Object.values(entrada.desoneracao ?? {});
      case 'creditoSn':
        return Object.values(entrada.creditoSn ?? {});
    }
  })();
  return campos.some(presente);
}

/** Mensagem para quem informou um bloco que o grupo escolhido não tem. */
function mensagemBlocoProibido(tratamento: TratamentoIcms, bloco: BlocoIcms, rotulo: string) {
  const retidaAntes =
    tratamento.natureza === 'ST_RETIDA_ANTERIORMENTE' || tratamento.natureza === 'SN_ST_RETIDA_ANTERIORMENTE';
  if (retidaAntes && (bloco === 'proprio' || bloco === 'reducaoBase' || bloco === 'fcp')) {
    return (
      `O ${rotulo} utiliza o grupo de ICMS cobrado anteriormente por substituição tributária ` +
      `(${tratamento.grupoXml}) e não utiliza estes campos de ICMS próprio. ` +
      `Mantenha o ${rotulo} e preencha os campos de ST retida, ou revise CST/CFOP/classificação.`
    );
  }
  return (
    `O ${rotulo} (${tratamento.grupoXml}) não tem ${ROTULO_BLOCO[bloco]}. ` +
    `Remova esses valores ou revise CST/CFOP/classificação.`
  );
}

/**
 * Resolve o grupo ICMS de um item. Nunca troca o CST/CSOSN: quando a
 * combinação não fecha, devolve `issues` para o usuário decidir.
 */
export function calcularIcmsItem(entrada: EntradaIcms): ResultadoIcms {
  const tratamento = resolverTratamentoIcms({ crt: entrada.crt, cst: entrada.cst, csosn: entrada.csosn });
  if (!tratamento) return { tratamento: null, valores: null, camposIgnorados: [], issues: [] };

  // MEI não pode destacar crédito do Simples, nem no CSOSN 900.
  if (entrada.crt === 4) tratamento.blocos.creditoSn = 'PROIBIDO';

  const regras = tratamento.blocos;
  const rotulo = `${tratamento.regime === 'SIMPLES' ? 'CSOSN' : 'CST'} ${tratamento.codigo}`;
  const valores = icmsVazio(tratamento, entrada.orig);
  const issues: IcmsIssue[] = [];
  const camposIgnorados: CampoIgnorado[] = [];
  const bloquear = (code: string, field: string, message: string) =>
    issues.push({ code, severidade: 'BLOQUEIO', field, message });

  const operacao = Math.max(0, Number(entrada.valorOperacao ?? 0));
  const aliquota = numeroIcms(entrada.aliquotaIcms);
  // Bases do ICMS próprio e da ST: operação + frete/seguro/outras despesas,
  // conforme a LC 87/96 (ver baseCalculo.ts).
  const composicao = comporBaseIcms({
    valorOperacao: operacao,
    frete: numeroIcms(entrada.composicaoBase?.frete),
    freteIntegraBaseIcms: entrada.composicaoBase?.freteIntegraBaseIcms,
    seguro: numeroIcms(entrada.composicaoBase?.seguro),
    outrasDespesas: numeroIcms(entrada.composicaoBase?.outrasDespesas),
  });
  const fretePendente =
    composicao.frete > 0 &&
    entrada.composicaoBase?.freteIntegraBaseIcms !== true &&
    entrada.composicaoBase?.freteIntegraBaseIcms !== false;

  // 1. Bloco informado num grupo que não o aceita é decisão contraditória da
  //    emissão: o usuário precisa escolher entre o código e os valores.
  for (const bloco of Object.keys(regras) as BlocoIcms[]) {
    if (regras[bloco] === 'PROIBIDO' && blocoInformado(entrada, bloco)) {
      bloquear(`NFE_ICMS_BLOCO_PROIBIDO_${bloco.toUpperCase()}`, `icms.${bloco}`, mensagemBlocoProibido(tratamento, bloco, rotulo));
    }
  }

  // 2. ICMS próprio.
  const proprioPedido =
    regras.proprio === 'OBRIGATORIO' ||
    (regras.proprio === 'OPCIONAL' &&
      (blocoInformado(entrada, 'proprio') ||
        blocoInformado(entrada, 'reducaoBase') ||
        (regras.diferimento !== 'PROIBIDO' && blocoInformado(entrada, 'diferimento'))));

  if (!proprioPedido && aliquota !== null) {
    camposIgnorados.push({
      campo: 'aliquotaicms',
      valor: aliquota,
      origem: entrada.procedenciaAliquota ?? null,
      motivo:
        regras.proprio === 'PROIBIDO'
          ? `O ${rotulo} (${tratamento.grupoXml}) não tem ICMS próprio; a alíquota de ${porcentagem(aliquota)}% da classificação não gera imposto nesta nota.`
          : `No ${rotulo} o ICMS próprio só é destacado quando a emissão pede; a alíquota de ${porcentagem(aliquota)}% da classificação não foi usada.`,
    });
  }

  if (proprioPedido) {
    const pRedBC = numeroIcms(entrada.proprio?.pRedBC);
    const vBCInformado = numeroIcms(entrada.proprio?.vBC);
    const vICMSInformado = numeroIcms(entrada.proprio?.vICMS);

    if (aliquota === null) {
      bloquear('NFE_ICMS_ALIQUOTA_REQUIRED', 'aliquotaIcms', `Informe a alíquota do ICMS próprio: o ${rotulo} (${tratamento.grupoXml}) destaca ICMS próprio.`);
    } else if (aliquota < 0 || aliquota > 100) {
      bloquear('NFE_ICMS_ALIQUOTA_INVALID', 'aliquotaIcms', 'A alíquota do ICMS próprio deve estar entre 0 e 100%.');
    }
    if (regras.reducaoBase === 'OBRIGATORIO' && pRedBC === null) {
      bloquear('NFE_ICMS_PREDBC_REQUIRED', 'icms.proprio.pRedBC', `Informe o percentual de redução da base (pRedBC): o ${rotulo} é de base reduzida.`);
    }
    if (pRedBC !== null && (pRedBC <= 0 || pRedBC >= 100)) {
      bloquear('NFE_ICMS_PREDBC_INVALID', 'icms.proprio.pRedBC', 'O percentual de redução da base deve ser maior que 0 e menor que 100%.');
    }

    if (fretePendente) {
      bloquear(
        'NFE_ICMS_FRETE_BASE_INDEFINIDA',
        'transporte.freteIntegraBaseIcms',
        'Há frete cobrado na nota e não foi decidido se ele integra a base do ICMS próprio.',
      );
    }
    const vBC = vBCInformado ?? dinheiro(composicao.baseIcmsProprio * (1 - (pRedBC ?? 0) / 100));
    const pICMS = aliquota ?? 0;
    valores.modBC = texto(entrada.proprio?.modBC) ?? '3';
    valores.pRedBC = pRedBC !== null && regras.reducaoBase !== 'PROIBIDO' ? pRedBC : null;
    valores.vBC = vBC;
    valores.pICMS = pICMS;

    const pDif = numeroIcms(entrada.diferimento?.pDif);
    if (pDif !== null && regras.diferimento !== 'PROIBIDO') {
      if (pDif < 0 || pDif > 100) {
        bloquear('NFE_ICMS_PDIF_INVALID', 'icms.diferimento.pDif', 'O percentual de diferimento deve estar entre 0 e 100%.');
      }
      const vICMSOp = dinheiro((vBC * pICMS) / 100);
      const vICMSDif = dinheiro((vICMSOp * pDif) / 100);
      valores.vICMSOp = vICMSOp;
      valores.pDif = pDif;
      valores.vICMSDif = vICMSDif;
      valores.vICMS = vICMSInformado ?? dinheiro(vICMSOp - vICMSDif);
    } else {
      valores.vICMS = vICMSInformado ?? dinheiro((vBC * pICMS) / 100);
    }
  }

  // 3. FCP próprio: calculado sobre a base do ICMS próprio.
  if (regras.fcp !== 'PROIBIDO' && blocoInformado(entrada, 'fcp')) {
    const pFCP = numeroIcms(entrada.fcp?.pFCP);
    if (valores.vBC === null) {
      bloquear('NFE_ICMS_FCP_SEM_PROPRIO', 'icms.fcp', 'O FCP próprio incide sobre a base do ICMS próprio: destaque o ICMS próprio ou remova o FCP.');
    } else if (pFCP === null) {
      bloquear('NFE_ICMS_PFCP_REQUIRED', 'icms.fcp.pFCP', 'Informe o percentual do FCP.');
    } else {
      // O ICMS00 não tem vBCFCP: o FCP usa a própria vBC do grupo.
      valores.vBCFCP = tratamento.grupoXml === 'ICMS00' ? null : valores.vBC;
      valores.pFCP = pFCP;
      valores.vFCP = numeroIcms(entrada.fcp?.vFCP) ?? dinheiro((valores.vBC * pFCP) / 100);
    }
  }

  // 4. ICMS-ST retido nesta operação.
  const stPedido =
    regras.st === 'OBRIGATORIO' || (regras.st === 'OPCIONAL' && blocoInformado(entrada, 'st'));
  if (stPedido) {
    const pMVAST = numeroIcms(entrada.st?.pMVAST);
    const pRedBCST = numeroIcms(entrada.st?.pRedBCST);
    const pICMSST = numeroIcms(entrada.st?.pICMSST);
    const vBCSTInformado = numeroIcms(entrada.st?.vBCST);
    const vICMSSTInformado = numeroIcms(entrada.st?.vICMSST);
    const modBCST = texto(entrada.st?.modBCST) ?? (pMVAST !== null ? '4' : null);

    if (modBCST === null) {
      bloquear('NFE_ICMS_MODBCST_REQUIRED', 'icms.st.modBCST', `Informe a modalidade da base do ICMS-ST (modBCST) do ${rotulo}.`);
    }
    if (pICMSST === null) {
      bloquear('NFE_ICMS_PICMSST_REQUIRED', 'icms.st.pICMSST', `Informe a alíquota do ICMS-ST (pICMSST) do ${rotulo}.`);
    }
    // A base da ST parte do valor da operação com frete, seguro e outros
    // encargos cobrados do adquirente (LC 87/96, art. 8º, II) e só então aplica
    // a MVA — independentemente da redução da base do ICMS próprio.
    const vBCST =
      vBCSTInformado ??
      (pMVAST !== null ? dinheiro(composicao.baseSt * (1 + pMVAST / 100) * (1 - (pRedBCST ?? 0) / 100)) : null);
    if (vBCST === null) {
      bloquear('NFE_ICMS_VBCST_REQUIRED', 'icms.st.vBCST', 'Informe a base do ICMS-ST (vBCST) ou a MVA (pMVAST) para o ERP calculá-la.');
    }
    // A dedução do ICMS próprio só é feita quando o próprio item destaca esse
    // ICMS. Nos grupos sem ICMS próprio no XML (30, SN201, SN202) a dedução
    // depende da legislação — o valor tem de vir informado.
    let vICMSST = vICMSSTInformado;
    if (vICMSST === null && vBCST !== null && pICMSST !== null) {
      if (valores.vICMS !== null) {
        vICMSST = Math.max(0, dinheiro((vBCST * pICMSST) / 100 - valores.vICMS));
      } else {
        bloquear(
          'NFE_ICMS_VICMSST_REQUIRED',
          'icms.st.vICMSST',
          `Informe o valor do ICMS-ST (vICMSST): no ${rotulo} o item não destaca ICMS próprio, e a dedução depende da legislação da operação.`,
        );
      }
    }
    valores.modBCST = modBCST;
    valores.pMVAST = pMVAST;
    valores.pRedBCST = pRedBCST;
    valores.vBCST = vBCST;
    valores.pICMSST = pICMSST;
    valores.vICMSST = vICMSST;

    if (regras.fcpSt !== 'PROIBIDO' && blocoInformado(entrada, 'fcpSt')) {
      const pFCPST = numeroIcms(entrada.fcpSt?.pFCPST);
      if (pFCPST === null) {
        bloquear('NFE_ICMS_PFCPST_REQUIRED', 'icms.fcpSt.pFCPST', 'Informe o percentual do FCP-ST.');
      } else if (vBCST !== null) {
        const vBCFCPST = numeroIcms(entrada.fcpSt?.vBCFCPST) ?? vBCST;
        valores.vBCFCPST = vBCFCPST;
        valores.pFCPST = pFCPST;
        valores.vFCPST = numeroIcms(entrada.fcpSt?.vFCPST) ?? dinheiro((vBCFCPST * pFCPST) / 100);
      }
    }
  } else if (regras.fcpSt !== 'PROIBIDO' && blocoInformado(entrada, 'fcpSt')) {
    bloquear('NFE_ICMS_FCPST_SEM_ST', 'icms.fcpSt', 'O FCP-ST só existe junto com o ICMS-ST da operação.');
  }

  // 5. ST cobrada anteriormente: valores da compra, nunca calculados aqui.
  if (regras.stRetida !== 'PROIBIDO' && blocoInformado(entrada, 'stRetida')) {
    const vBCSTRet = numeroIcms(entrada.stRetida?.vBCSTRet);
    const pST = numeroIcms(entrada.stRetida?.pST);
    const vICMSSTRet = numeroIcms(entrada.stRetida?.vICMSSTRet);
    if (vBCSTRet === null || pST === null || vICMSSTRet === null) {
      bloquear(
        'NFE_ICMS_STRET_INCOMPLETO',
        'icms.stRetida',
        'Informe juntos a BC do ST retido (vBCSTRet), a alíquota suportada pelo consumidor final (pST) e o ICMS-ST retido (vICMSSTRet): o leiaute exige o grupo completo.',
      );
    } else {
      valores.vBCSTRet = vBCSTRet;
      valores.pST = pST;
      valores.vICMSSubstituto = numeroIcms(entrada.stRetida?.vICMSSubstituto);
      valores.vICMSSTRet = vICMSSTRet;
    }
  }
  if (regras.fcpStRetido !== 'PROIBIDO' && blocoInformado(entrada, 'fcpStRetido')) {
    const vBCFCPSTRet = numeroIcms(entrada.fcpStRetido?.vBCFCPSTRet);
    const pFCPSTRet = numeroIcms(entrada.fcpStRetido?.pFCPSTRet);
    const vFCPSTRet = numeroIcms(entrada.fcpStRetido?.vFCPSTRet);
    if (vBCFCPSTRet === null || pFCPSTRet === null || vFCPSTRet === null) {
      bloquear('NFE_ICMS_FCPSTRET_INCOMPLETO', 'icms.fcpStRetido', 'Informe juntos a base, o percentual e o valor do FCP-ST retido anteriormente.');
    } else {
      valores.vBCFCPSTRet = vBCFCPSTRet;
      valores.pFCPSTRet = pFCPSTRet;
      valores.vFCPSTRet = vFCPSTRet;
    }
  }
  if (regras.icmsEfetivo !== 'PROIBIDO' && blocoInformado(entrada, 'icmsEfetivo')) {
    const efetivo = entrada.icmsEfetivo ?? {};
    const campos = [efetivo.pRedBCEfet, efetivo.vBCEfet, efetivo.pICMSEfet, efetivo.vICMSEfet].map(numeroIcms);
    if (campos.some((campo) => campo === null)) {
      bloquear('NFE_ICMS_EFETIVO_INCOMPLETO', 'icms.icmsEfetivo', 'Informe juntos pRedBCEfet, vBCEfet, pICMSEfet e vICMSEfet.');
    } else {
      [valores.pRedBCEfet, valores.vBCEfet, valores.pICMSEfet, valores.vICMSEfet] = campos;
    }
  }

  // 6. Desoneração: valor e motivo andam juntos.
  if (regras.desoneracao !== 'PROIBIDO' && blocoInformado(entrada, 'desoneracao')) {
    const vICMSDeson = numeroIcms(entrada.desoneracao?.vICMSDeson);
    const motivo = texto(entrada.desoneracao?.motDesICMS)?.replace(/\D/g, '') || null;
    if (vICMSDeson === null || motivo === null) {
      bloquear('NFE_ICMS_DESON_INCOMPLETO', 'icms.desoneracao', 'Informe juntos o valor do ICMS desonerado e o motivo da desoneração.');
    } else {
      valores.vICMSDeson = vICMSDeson;
      valores.motDesICMS = motivo;
    }
  }

  // 7. Crédito do Simples Nacional.
  const creditoPedido =
    regras.creditoSn === 'OBRIGATORIO' ||
    (regras.creditoSn === 'OPCIONAL' && blocoInformado(entrada, 'creditoSn'));
  if (creditoPedido) {
    const pCredSN = numeroIcms(entrada.creditoSn?.pCredSN);
    if (pCredSN === null) {
      bloquear('NFE_ICMS_PCREDSN_REQUIRED', 'icms.creditoSn.pCredSN', `Informe a alíquota de crédito do Simples (pCredSN) do ${rotulo}.`);
    } else {
      valores.pCredSN = pCredSN;
      valores.vCredICMSSN = numeroIcms(entrada.creditoSn?.vCredICMSSN) ?? dinheiro((operacao * pCredSN) / 100);
    }
  }

  return { tratamento, valores, camposIgnorados, issues, composicaoBase: composicao };
}

/** Blocos que efetivamente têm valor no canônico (o que foi para o XML). */
export function blocosPresentes(valores: IcmsCanonico): BlocoIcms[] {
  const blocos: BlocoIcms[] = [];
  if (valores.vBC !== null) blocos.push('proprio');
  if (valores.pRedBC !== null) blocos.push('reducaoBase');
  if (valores.vFCP !== null) blocos.push('fcp');
  if (valores.pDif !== null) blocos.push('diferimento');
  if (valores.vBCST !== null) blocos.push('st');
  if (valores.vFCPST !== null) blocos.push('fcpSt');
  if (valores.vBCSTRet !== null) blocos.push('stRetida');
  if (valores.vFCPSTRet !== null) blocos.push('fcpStRetido');
  if (valores.vICMSEfet !== null) blocos.push('icmsEfetivo');
  if (valores.vICMSDeson !== null) blocos.push('desoneracao');
  if (valores.pCredSN !== null) blocos.push('creditoSn');
  return blocos;
}
