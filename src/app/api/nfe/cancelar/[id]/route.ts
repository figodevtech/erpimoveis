// src/app/api/nfe/cancelar/[id]/route.ts

import { NextResponse } from 'next/server';
import https from 'https';
import { createHash } from 'crypto';
import { XMLParser } from 'fast-xml-parser';

import { requireEmissaoFiscalAccess } from '@/app/api/_authz/perms';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { carregarCertificadoA1 } from '@/lib/nfe/certificado';
import type { EmpresaRow } from '@/lib/nfe/types';
import { buildEnvEventoCancelamento } from '@/lib/nfe/eventoCancelamento';
import { assinarEventoNFeXml } from '@/lib/nfe/assinaturaEvento';
import { exigirModelo } from '@/lib/nfe/modeloDocumento';
import { resolveSefazEndpoint } from '@/lib/nfe/webservices';
import { parseFiscalDate } from '@/lib/fiscal-date';
import { persistirCancelamentoHomologado } from '@/lib/nfe/cancelamentoHomologado';

export const runtime = 'nodejs';

type BodyRequest = {
  justificativa?: string;
};

/**
 * Envia SOAP via https.request usando client-cert (PFX).
 */
function postSoapComCert(
  url: string,
  soapEnvelope: string,
  agent: https.Agent,
): Promise<{ httpStatus: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname,
        method: 'POST',
        agent,
        headers: {
          'Content-Type':
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
          'Content-Length': Buffer.byteLength(soapEnvelope).toString(),
        },
      },
      (res) => {
        let data = '';

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            httpStatus: res.statusCode ?? 0,
            body: data,
          });
        });
      },
    );

    req.on('error', (err) => {
      reject(err);
    });

    req.write(soapEnvelope);
    req.end();
  });
}

async function cancelarHandler(req: Request, nfeIdParam: string) {
  try {
    // -------------------------------------------------------------------
    // 0) Permissão: cancelar é evento fiscal irreversível
    // -------------------------------------------------------------------
    await requireEmissaoFiscalAccess();

    // -------------------------------------------------------------------
    // 1) Validar ID da NF-e
    // -------------------------------------------------------------------
    const nfeId = Number(nfeIdParam);
    if (Number.isNaN(nfeId)) {
      return NextResponse.json(
        { ok: false, mensagem: 'ID de NF-e inválido' },
        { status: 400 },
      );
    }

    // -------------------------------------------------------------------
    // 2) Ler body (justificativa)
    // -------------------------------------------------------------------
    const body = (await req.json().catch(() => null)) as BodyRequest | null;
    const justificativaRaw = (body?.justificativa ?? '').trim();

    if (justificativaRaw.length < 15) {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'Justificativa do cancelamento deve ter pelo menos 15 caracteres.',
        },
        { status: 400 },
      );
    }

    if (justificativaRaw.length > 255) {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'Justificativa do cancelamento deve ter no máximo 255 caracteres.',
        },
        { status: 400 },
      );
    }

    // -------------------------------------------------------------------
    // 3) Buscar NF-e no banco
    // -------------------------------------------------------------------
    const { data: nfe, error: nfeError } = await supabaseAdmin
      .from('nfe')
      .select('*')
      .eq('id', nfeId)
      .maybeSingle();

    if (nfeError) {
      console.error('[nfe/cancelar] erro ao buscar NF-e:', nfeError);
      return NextResponse.json(
        {
          ok: false,
          mensagem: 'Erro ao buscar NF-e no banco',
          detalhe: nfeError.message,
        },
        { status: 500 },
      );
    }

    if (!nfe) {
      return NextResponse.json(
        { ok: false, mensagem: 'NF-e não encontrada' },
        { status: 404 },
      );
    }

    // Só permite cancelar AUTORIZADA
    if (nfe.status !== 'AUTORIZADA') {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'Somente NF-e com status AUTORIZADA pode ser cancelada.',
          statusAtual: nfe.status,
        },
        { status: 400 },
      );
    }

    if (!nfe.chave_acesso) {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'NF-e não possui chave de acesso preenchida (chave_acesso).',
        },
        { status: 500 },
      );
    }

    if (!nfe.empresaid) {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'NF-e não possui empresa associada (empresaid nulo).',
        },
        { status: 500 },
      );
    }

    if (!nfe.protocolo) {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'NF-e não possui protocolo de autorização. Não é possível cancelar sem o protocolo.',
        },
        { status: 400 },
      );
    }

    // -------------------------------------------------------------------
    // 4) Buscar empresa
    // -------------------------------------------------------------------
    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from('empresa')
      .select('*')
      .eq('id', nfe.empresaid)
      .single<EmpresaRow>();

    if (empresaError) {
      console.error('[nfe/cancelar] erro ao buscar empresa:', empresaError);
      return NextResponse.json(
        {
          ok: false,
          mensagem: 'Erro ao buscar empresa no banco',
          detalhe: empresaError.message,
        },
        { status: 500 },
      );
    }

    if (!empresa) {
      return NextResponse.json(
        { ok: false, mensagem: 'Empresa não encontrada' },
        { status: 404 },
      );
    }

    // O evento tem que ir para o mesmo ambiente em que a nota foi autorizada:
    // cancelar em produção uma nota de homologação não acha o documento.
    const ambiente =
      (nfe.ambiente ?? empresa.ambiente) === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
    const tpAmb: 1 | 2 = ambiente === 'PRODUCAO' ? 1 : 2;

    // cOrgao = código da UF (primeiros 2 dígitos do codigomunicipio)
    const cOrgao =
      (empresa.codigomunicipio || '').substring(0, 2) || '25';

    // -------------------------------------------------------------------
    // 5) Carregar certificado A1
    // -------------------------------------------------------------------
    const { privateKeyPem, certificatePem } =
      await carregarCertificadoA1(empresa);

    // -------------------------------------------------------------------
    // 6) Montar XML do envEvento de cancelamento
    // -------------------------------------------------------------------
    const { xml: xmlEnvEvento, id: idEvento } =
      buildEnvEventoCancelamento({
        cOrgao,
        tpAmb,
        cnpj: empresa.cnpj,
        chNFe: nfe.chave_acesso,
        nProt: nfe.protocolo,
        xJust: justificativaRaw,
        nSeqEvento: 1,
      });

    // -------------------------------------------------------------------
    // 7) Assinar o XML do evento (<infEvento>)
    // -------------------------------------------------------------------
    const xmlEventoAssinado = assinarEventoNFeXml(
      xmlEnvEvento,
      privateKeyPem,
      certificatePem,
    );

    // Remove declaração XML interna (<?xml ...?>) antes de colocar dentro de <nfeDadosMsg>
    const xmlEventoAssinadoSemDecl = xmlEventoAssinado.replace(
      /^\s*<\?xml[^>]*\?>\s*/i,
      '',
    );

    // -------------------------------------------------------------------
    // 8) Montar SOAP Envelope para o serviço NFeRecepcaoEvento4
    // -------------------------------------------------------------------
    const soapEnvelope =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
      'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      '<soap12:Body>' +
      '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">' +
      xmlEventoAssinadoSemDecl +
      '</nfeDadosMsg>' +
      '</soap12:Body>' +
      '</soap12:Envelope>';

    // -------------------------------------------------------------------
    // 9) URL do webservice de evento, resolvida por modelo/UF/ambiente
    // -------------------------------------------------------------------
    const url = resolveSefazEndpoint({
      modelo: exigirModelo(nfe.modelo),
      uf: String(empresa.uf ?? ''),
      ambiente,
      servico: 'recepcaoEvento',
    });

    // -------------------------------------------------------------------
    // 10) Montar agente HTTPS com a chave e certificado extraídos (PEM)
    // Isso evita o erro "unsupported" que ocorre ao passar o PFX direto em Node 17+
    const httpsAgent = new https.Agent({
      key: privateKeyPem,
      cert: certificatePem,
      // Em produção, ideal é true com cadeia correta
      rejectUnauthorized: false,
    });

    // -------------------------------------------------------------------
    // 11) Enviar SOAP para o webservice
    // -------------------------------------------------------------------
    const { httpStatus, body: respostaText } = await postSoapComCert(
      url,
      soapEnvelope,
      httpsAgent,
    );

    if (httpStatus !== 200) {
      return NextResponse.json(
        {
          ok: false,
          ambiente,
          nfeId,
          httpStatus,
          mensagem: 'Erro HTTP ao chamar NFeRecepcaoEvento4',
          soap: {
            xmlEnviado: soapEnvelope,
            xmlRespostaSnippet: respostaText.substring(0, 2000),
          },
        },
        { status: 500 },
      );
    }

    // -------------------------------------------------------------------
    // 12) Parse do XML de retorno (retEnvEvento / retEvento)
    // -------------------------------------------------------------------
    const parser = new XMLParser({
      ignoreAttributes: false,
    });

    let env_cStat: string | null = null;
    let env_xMotivo: string | null = null;
    let ev_cStat: string | null = null;
    let ev_xMotivo: string | null = null;
    let nProtEvento: string | null = null;
    let dhRegEvento: string | null = null;

    try {
      const parsed = parser.parse(respostaText);
      const envelope = parsed['soap:Envelope'] ?? parsed.Envelope;
      const bodyNode = envelope?.['soap:Body'] ?? envelope?.Body;
      const resultMsg = bodyNode?.nfeResultMsg;
      const retEnvEvento = resultMsg?.retEnvEvento;

      const rawEnvCStat = retEnvEvento?.cStat;
      env_cStat = rawEnvCStat != null ? String(rawEnvCStat) : null;
      env_xMotivo = retEnvEvento?.xMotivo ?? null;

      let retEvento = retEnvEvento?.retEvento;
      if (Array.isArray(retEvento)) {
        retEvento = retEvento[0];
      }

      const infEvento = retEvento?.infEvento;
      const rawEvCStat = infEvento?.cStat;
      ev_cStat = rawEvCStat != null ? String(rawEvCStat) : null;
      ev_xMotivo = infEvento?.xMotivo ?? null;
      nProtEvento =
        infEvento?.nProt != null ? String(infEvento.nProt) : null;
      dhRegEvento = infEvento?.dhRegEvento ?? null;
    } catch (parseErr) {
      console.warn(
        '[nfe/cancelar] erro ao parsear XML de retorno da SEFAZ:',
        parseErr,
      );
    }

    // -------------------------------------------------------------------
    // 13) Atualizar status da NF-e no banco, se o evento foi aceito
    //     cStat do evento 135 ou 155 = cancelamento homologado
    // -------------------------------------------------------------------
    let statusFinal: string = nfe.status;
    const protocoloAutorizacao: string | null = nfe.protocolo;

    if (ev_cStat === '135' || ev_cStat === '155') {
      statusFinal = 'CANCELADA';
    }

    let avisoCancelamento: string | null = null;
    if (statusFinal === 'CANCELADA') {
      const dataEvento = parseFiscalDate(dhRegEvento);
      const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
      const resultado = await persistirCancelamentoHomologado(nProtEvento, {
        registrarEvento: async () =>
          supabaseAdmin.rpc('fiscal_registrar_cancelamento_nfe', {
            p_nfe_id: nfeId,
            p_empresa_id: nfe.empresaid,
            p_chave_acesso: nfe.chave_acesso,
            p_justificativa: justificativaRaw,
            p_status_evento: ev_cStat,
            p_protocolo_evento: nProtEvento,
            p_data_evento_original: dataEvento?.originalText ?? dhRegEvento,
            p_data_evento_civil: dataEvento?.civilDate ?? null,
            p_data_evento_offset: dataEvento?.originalOffset ?? null,
            p_data_evento_instante_utc: dataEvento?.instantUtc ?? null,
            p_xml_evento: xmlEventoAssinado,
            p_resposta_sefaz: respostaText,
            p_xml_sha256: sha256(xmlEventoAssinado),
            p_resposta_sha256: sha256(respostaText),
          }),
        marcarCancelada: async () =>
          supabaseAdmin
            .from('nfe')
            .update({
              status: 'CANCELADA',
              updatedat: new Date().toISOString(),
              justificativacancelamento: justificativaRaw,
            })
            .eq('id', nfeId),
        registrarFalha: (etapa, error) =>
          console.error(`[nfe/cancelar] cancelamento homologado, falha na etapa ${etapa}:`, error),
      });
      avisoCancelamento = resultado.aviso;
    } else {
      const { error: updateError } = await supabaseAdmin
        .from('nfe')
        .update({
          updatedat: new Date().toISOString(),
          justificativacancelamento: justificativaRaw,
        })
        .eq('id', nfeId);
      if (updateError) {
        console.warn('[nfe/cancelar] falha ao gravar a justificativa:', updateError);
      }
    }

    // -------------------------------------------------------------------
    // 14) Resposta para o frontend
    // -------------------------------------------------------------------
    return NextResponse.json({
      ok: true,
      ambiente,
      nfeId,
      aviso: avisoCancelamento,
      evento: {
        id: idEvento,
        lote: {
          cStat: env_cStat,
          xMotivo: env_xMotivo,
        },
        retorno: {
          cStat: ev_cStat,
          xMotivo: ev_xMotivo,
          nProt: nProtEvento,
          dhRegEvento,
        },
      },
      nfeDb: {
        id: nfeId,
        status: statusFinal,
        protocolo: protocoloAutorizacao,
      },
      soap: {
        xmlEnviado: soapEnvelope,
        xmlRespostaSnippet: respostaText.substring(0, 2000),
      },
    });
  } catch (e: any) {
    console.error('Erro em /api/nfe/cancelar/[id]:', e);

    if (e?.statusCode === 403) {
      return NextResponse.json(
        { ok: false, mensagem: 'Você não tem permissão para cancelar documentos fiscais.' },
        { status: 403 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        mensagem: 'Erro interno ao cancelar a nota',
        detalhe: String(e?.message ?? e),
      },
      { status: 500 },
    );
  }
}

// Next 15: params é Promise
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return cancelarHandler(req, id);
}
