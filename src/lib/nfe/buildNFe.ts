// src/lib/nfe/buildNFe.ts

import type {
  EmpresaRow,
  NFeIde,
  NFeDestinatario,
  NFeItem,
} from './types';
import { buildIdeXml } from './xmlIde';
import { buildEmitXml } from './xmlEmitente';
import { buildDestXml } from './xmlDest';
import { buildDetXml } from './xmlItem';
import { gerarCNF, gerarChaveAcesso } from './chaveAcesso';
import { mapEmpresaToEmitente } from './mapEmpresaToEmitente';
import { getCodigoUF } from './ufUtils';
import { calcularTotaisNFe, normalizarCRT } from './fiscal';
import { escapeXml } from './xmlUtils';

/**
 * Formata data/hora para o padrão da NF-e 4.00:
 * AAAA-MM-DDThh:mm:ss-03:00
 */
function formatDateTimeNFe(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  // Usa a HORA LOCAL do ambiente (Node) aqui:
  const ano = date.getFullYear();
  const mes = pad(date.getMonth() + 1);
  const dia = pad(date.getDate());
  const hora = pad(date.getHours());
  const minuto = pad(date.getMinutes());
  const segundo = pad(date.getSeconds());

  // Timezone baseado no ambiente (getTimezoneOffset):
  // ex.: Fortaleza (UTC-3) => getTimezoneOffset() = 180
  const offsetMinutes = date.getTimezoneOffset(); // em minutos
  const total = Math.abs(offsetMinutes);

  const offsetHours = pad(Math.floor(total / 60));
  const offsetMins = pad(total % 60);
  const sign = offsetMinutes > 0 ? '-' : '+';
  // em Fortaleza: offsetMinutes = 180 => sign = '-' => "-03:00"

  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}${sign}${offsetHours}:${offsetMins}`;
}


/**
 * Cria o bloco <ide> da NF-e, calculando cNF, chave de acesso e cDV.
 */
export interface IdeOptions {
  tpNF?: 0 | 1;
  natOp?: string;
  indFinal?: 0 | 1;
  indPres?: 0 | 1 | 2 | 3 | 4 | 9;
  finNFe?: 1 | 2 | 3 | 4;
  tpImp?: 1 | 2 | 3 | 4 | 5;
  observacoesFiscais?: string | null;
}

export function criarIdeParaEmpresa(
  empresa: EmpresaRow,
  numeroNota: number,
  serie: number,
  options?: IdeOptions
): { ide: NFeIde; cNF: string; chave: string; id: string } {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;

  const tpAmb: 1 | 2 = empresa.ambiente === 'PRODUCAO' ? 1 : 2;
  const cNF = gerarCNF(numeroNota);

  // PB defaults to 25 if not found, but now we try to read from company
  const cUF = getCodigoUF(empresa.uf || undefined);
  const mod = '55'; // NF-e
  const tpEmis = 1; // emissão normal

  // 1) Gera chave de acesso (44 dígitos) e cDV
  const { chave, id, dv } = gerarChaveAcesso({
    cUF,
    ano,
    mes,
    cnpj: empresa.cnpj,
    mod,
    serie,
    nNF: numeroNota,
    tpEmis,
    cNF,
  });

  // 2) Monta objeto ide completo
  const ide: NFeIde = {
    cUF,
    cNF,
    natOp: options?.natOp || 'VENDA DE MERCADORIA',
    mod,
    serie,
    nNF: numeroNota,
    dhEmi: formatDateTimeNFe(agora),
    tpNF: options?.tpNF ?? 1,
    idDest: 1,
    cMunFG: empresa.codigomunicipio,
    tpImp: options?.tpImp ?? 1,
    tpEmis,
    cDV: dv,
    tpAmb,
    finNFe: options?.finNFe ?? 1,
    indFinal: options?.indFinal ?? (options?.tpNF === 0 ? 0 : 1),
    indPres: options?.indPres ?? 1,
    procEmi: 0,
    verProc: 'ERPOficina 1.0.0',
  };

  return { ide, cNF, chave, id };
}

/**
 * Monta o XML completo da NFe (sem assinatura).
 *
 * IMPORTANTE (Lucro Presumido):
 * - Se você passar "itensOverride", é ESSENCIAL preencher os campos
 *   de imposto do NFeItem (cst, csosn, aliquotaIcms, cstPis, cstCofins, etc)
 *   já calculados a partir de produto/nfe_item.
 *
 * Se "itensOverride" for informado, ele será usado para gerar os <det>.
 * Caso contrário, é usado um item de teste fixo (comportamento antigo).
 */
export function buildNFePreviewXml(
  empresa: EmpresaRow,
  numeroNota: number,
  serie: number,
  itensOverride?: NFeItem[],
  destinatario?: NFeDestinatario,
  options?: IdeOptions
): { xml: string; chave: string; id: string } {
  const { ide, chave, id } = criarIdeParaEmpresa(
    empresa,
    numeroNota,
    serie,
    options
  );

  const emitente = mapEmpresaToEmitente(empresa, 'JOAO PESSOA');
  const crt = normalizarCRT(emitente.crt);

  const dest: NFeDestinatario =
    destinatario ??
    {
      cpf: '12345678909', // pode deixar assim mesmo em homologacao
      razaoSocial:
        'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
      indIEDest: '9',
      endereco: {
        logradouro: 'RUA TESTE',
        numero: '100',
        complemento: '',
        bairro: 'BAIRRO TESTE',
        codigoMunicipio: empresa.codigomunicipio,
        nomeMunicipio: 'JOAO PESSOA',
        uf: 'PB',
        cep: '58000000',
        codigoPais: '1058',
        nomePais: 'BRASIL',
        telefone: '',
      },
    };

  // REGRA DE HOMOLOGAÇÃO:
  // Se não for produção, o nome do destinatário deve ser fixo conforme norma.
  if (empresa.ambiente !== 'PRODUCAO') {
    // Clonamos para não afetar o objeto original (se passado por referência)
    // Nota: endereco e outros sub-objetos ainda são referencias, mas razaoSocial é primitivo.
    // Como dest é const, precisamos garantir que podemos alterar ou redefinir.
    // Aqui estamos alterando a PROPRIEDADE do objeto referenciado por dest.
    dest.razaoSocial = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
  }


  // Se itensOverride não for passado, usa o item de teste (compatibilidade)
  const itemTesteFiscal =
    crt === 3
      ? { cst: '00', aliquotaIcms: 18, cstPis: '01', aliquotaPis: 1.65, cstCofins: '01', aliquotaCofins: 7.6 }
      : { csosn: '102', cstPis: crt === 4 ? '08' : '07', aliquotaPis: 0, cstCofins: crt === 4 ? '08' : '07', aliquotaCofins: 0 };

  const itensBase: NFeItem[] =
    itensOverride && itensOverride.length > 0
      ? itensOverride
      : [
        {
          numeroItem: 1,
          codigoProduto: '001',
          descricao: 'PECA TESTE',
          ncm: '61091000', // NCM exemplo - AJUSTAR DEPOIS
          cfop: '5102', // venda dentro do estado
          unidade: 'UN',
          quantidade: 1,
          valorUnitario: 100.0,
          valorTotal: 100.0,
          orig: '0',
          ...itemTesteFiscal,
        },
      ];

  // Garante nº do item em cada item
  const itens: NFeItem[] = itensBase.map((item, index) => ({
    ...item,
    numeroItem: item.numeroItem ?? index + 1,
  }));

  const ideXml = buildIdeXml(ide);
  const emitXml = buildEmitXml(emitente);
  const destXml = buildDestXml(dest);
  const detXml = itens
    .map((item) => buildDetXml(item, crt))
    .join('');

  // =========================
  // Totais (ICMSTot)
  // =========================
  const soma = calcularTotaisNFe(itens, crt);

  const vProd = soma.vProd.toFixed(2);
  const vBC = soma.vBC.toFixed(2);
  const vICMS = soma.vICMS.toFixed(2);
  const vPIS = soma.vPIS.toFixed(2);
  const vCOFINS = soma.vCOFINS.toFixed(2);
  const vNF = vProd; // sem desconto/frete/outros por enquanto

  const totalXml =
    '<total>' +
    '<ICMSTot>' +
    `<vBC>${vBC}</vBC>` +
    `<vICMS>${vICMS}</vICMS>` +
    `<vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST>` +
    `<vST>0.00</vST>` +
    `<vFCPST>0.00</vFCPST>` +
    `<vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${vProd}</vProd>` +
    `<vFrete>0.00</vFrete>` +
    `<vSeg>0.00</vSeg>` +
    `<vDesc>0.00</vDesc>` +
    `<vII>0.00</vII>` +
    `<vIPI>0.00</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>${vPIS}</vPIS>` +
    `<vCOFINS>${vCOFINS}</vCOFINS>` +
    `<vOutro>0.00</vOutro>` +
    `<vNF>${vNF}</vNF>` +
    '</ICMSTot>' +
    '</total>';

  const transpXml =
    '<transp>' +
    '<modFrete>9</modFrete>' + // 9 = sem frete
    '</transp>';

  const pagXml =
    '<pag>' +
    '<detPag>' +
    '<tPag>01</tPag>' + // 01 = dinheiro
    `<vPag>${vNF}</vPag>` +
    '</detPag>' +
    '</pag>';

  const natOpText = options?.natOp
    ? `NF-e de ${options.natOp.toLowerCase()}.`
    : 'NF-e de venda de mercadoria.';

  const obsRaw = (options?.observacoesFiscais ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  const obsSanitized = obsRaw.slice(0, 500);

  const infCplText = obsSanitized
    ? `${natOpText} ${obsSanitized}`
    : natOpText;

  const infAdicXml =
    '<infAdic>' +
    `<infCpl>${escapeXml(infCplText)}</infCpl>` +
    '</infAdic>';

  const infRespTec =
    '<infRespTec>' +
    '<CNPJ>58598900000162</CNPJ>' +
    '<xContato>FIGO Softwares</xContato>' +
    '<email>figo.devtech@gmail.com</email>' +
    '<fone>83987872668</fone>' +
    '</infRespTec>';

  const infNFeXml =
    `<infNFe Id="${id}" versao="4.00">` +
    ideXml +
    emitXml +
    destXml +
    detXml +
    totalXml +
    transpXml +
    pagXml +
    infAdicXml +
    infRespTec +
    '</infNFe>';

  const nfeXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">' +
    infNFeXml +
    '</NFe>';

  return { xml: nfeXml, chave, id };
}
