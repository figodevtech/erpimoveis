// src/app/api/nfe/autorizar/[id]/route.ts

import { NextResponse } from "next/server";
import https from "https";
import { XMLParser } from "fast-xml-parser";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { carregarCertificadoA1 } from "@/lib/nfe/certificado";
import { assinarNFeXml } from "@/lib/nfe/assinatura";
import { buildEnviNFeXml } from "@/lib/nfe/enviNFe";
import type { ClienteRow, EmpresaRow } from "@/lib/nfe/types";

export const runtime = "nodejs";

/**
 * Envia SOAP via https.request usando client-cert (PFX).
 */
function postSoapComCert(
  url: string,
  soapEnvelope: string,
  agent: https.Agent
): Promise<{ httpStatus: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname,
        method: "POST",
        agent,
        headers: {
          "Content-Type":
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
          "Content-Length": Buffer.byteLength(soapEnvelope).toString(),
        },
      },
      (res) => {
        let data = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          resolve({
            httpStatus: res.statusCode ?? 0,
            body: data,
          });
        });
      }
    );

    req.on("error", (err) => {
      reject(err);
    });

    req.write(soapEnvelope);
    req.end();
  });
}

/**
 * Monta o XML <nfeProc> a partir do XML da NFe assinada + XML do protNFe.
 */
function buildNfeProcXml(
  xmlAssinado: string,
  protNFeXml: string | null
): string | null {
  if (!protNFeXml) return null;

  // Remove declaraÃ§Ã£o XML do inÃ­cio da NFe, se existir
  const nfeSemDecl = xmlAssinado.replace(/<\?xml[^>]*\?>\s*/i, "");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    nfeSemDecl +
    protNFeXml +
    "</nfeProc>"
  );
}

/**
 * Extrai o XML bruto do <protNFe> de dentro da resposta SOAP.
 * (Usamos regex aqui sÃ³ pra montar o nfeProc bonitinho.)
 */
function extrairProtNFeXml(respostaSoap: string): string | null {
  const match = respostaSoap.match(/<protNFe[^>]*>[\s\S]*?<\/protNFe>/);
  return match ? match[0] : null;
}

function findXmlNode(value: any, nodeName: string): any | null {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, nodeName)) return value[nodeName];

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findXmlNode(item, nodeName);
        if (found) return found;
      }
    } else {
      const found = findXmlNode(child, nodeName);
      if (found) return found;
    }
  }

  return null;
}

function firstXmlNode(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

/**
 * Extrai o Id do <infNFe> e a chave de acesso (44 dÃ­gitos) do XML.
 */
function extrairChaveEIdDoXml(
  xml: string
): { chave: string | null; id: string | null } {
  const match = xml.match(/<infNFe[^>]*\sId=['"]([^'"]+)['"][^>]*>/i);
  if (!match) return { chave: null, id: null };

  const id = match[1];
  const chavePossivel = id.replace(/^NFe/i, "");
  const chaveValida = /^\d{44}$/.test(chavePossivel) ? chavePossivel : null;

  return { chave: chaveValida, id };
}

async function autorizarHandler(req: Request, nfeIdParam: string) {
  try {
    // -------------------------------------------------------------------
    // 1) Validar ID da NF-e (tabela nfe)
    // -------------------------------------------------------------------
    const nfeId = Number(nfeIdParam);
    if (Number.isNaN(nfeId)) {
      return NextResponse.json(
        { ok: false, mensagem: "ID de NF-e invÃ¡lido" },
        { status: 400 }
      );
    }

    // -------------------------------------------------------------------
    // 2) Buscar registro da NF-e no Supabase
    // -------------------------------------------------------------------
    const { data: nfe, error: nfeError } = await supabaseAdmin
      .from("nfe")
      .select("*")
      .eq("id", nfeId)
      .maybeSingle();

    if (nfeError) {
      console.error("[nfe] erro ao buscar NF-e:", nfeError);
      return NextResponse.json(
        {
          ok: false,
          mensagem: "Erro ao buscar NF-e no banco",
          detalhe: nfeError.message,
        },
        { status: 500 }
      );
    }

    if (!nfe) {
      return NextResponse.json(
        { ok: false, mensagem: "NF-e nÃ£o encontrada" },
        { status: 404 }
      );
    }

    // Esperado: nfe.empresaid, nfe.numero, nfe.serie
    if (!nfe.empresaid) {
      return NextResponse.json(
        {
          ok: false,
          mensagem: "NF-e nÃ£o possui empresa associada (empresaid nulo)",
        },
        { status: 500 }
      );
    }

    if (nfe.numero == null || nfe.serie == null) {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            "NF-e nÃ£o possui nÃºmero ou sÃ©rie definidos (campos numero/serie)",
        },
        { status: 500 }
      );
    }

    const statusAtual: string | null = nfe.status ?? null;

    // -------------------------------------------------------------------
    // 3) Buscar empresa no Supabase (usando nfe.empresaid)
    // -------------------------------------------------------------------
    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa")
      .select("*")
      .eq("id", nfe.empresaid)
      .single<EmpresaRow>();

    if (empresaError) {
      console.error("[empresa] erro ao buscar empresa:", empresaError);
      return NextResponse.json(
        {
          ok: false,
          mensagem: "Erro ao buscar empresa no banco",
          detalhe: empresaError.message,
        },
        { status: 500 }
      );
    }

    if (!empresa) {
      return NextResponse.json(
        { ok: false, mensagem: "Empresa nÃ£o encontrada" },
        { status: 404 }
      );
    }

    const ambiente =
      empresa.ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO";

    // -------------------------------------------------------------------
    // 4) Buscar cliente destinatario (cliente da OS vinculado a esta NF-e)
    // -------------------------------------------------------------------
    if (!nfe.clienteid && !nfe.entradaid && !nfe.destinatario_snapshot) {
      console.log("[nfe] NF-e sem cliente associado (clienteid nulo)", nfe);
      return NextResponse.json(
        {
          ok: false,
          mensagem: "NF-e sem cliente, entrada ou destinatÃ¡rio avulso associado.",
        },
        { status: 500 }
      );
    }

    if (nfe.clienteid) {
      const { data: cliente, error: clienteError } = await supabaseAdmin
        .from("cliente")
        .select(
          `
        id,
        cpfcnpj,
        nomerazaosocial,
        telefone,
        email,
        endereco,
        endereconumero,
        enderecocomplemento,
        bairro,
        cidade,
        estado,
        cep,
        inscricaoestadual,
        inscricaomunicipal,
        codigomunicipio
      `
        )
        .eq("id", nfe.clienteid)
        .single<ClienteRow>();

      if (clienteError) {
        console.error(
          "[cliente] erro ao buscar cliente da NF-e:",
          clienteError
        );
        return NextResponse.json(
          {
            ok: false,
            mensagem: "Erro ao buscar cliente da NF-e",
            detalhe: clienteError.message,
          },
          { status: 500 }
        );
      }

      if (!cliente && !nfe.entradaid) {
        return NextResponse.json(
          { ok: false, mensagem: "Cliente da NF-e nao encontrado" },
          { status: 404 }
        );
      }

    }

    // -------------------------------------------------------------------
    // 5) Buscar itens da NF-e em nfe_item
    // -------------------------------------------------------------------
    const { data: itensNfe, error: itensNfeError } = await supabaseAdmin
      .from("nfe_item")
      .select(
        `
        n_item,
        produtoid,
        descricao,
        ncm,
        cfop,
        unidade,
        quantidade,
        valor_unitario,
        valor_total
      `
      )
      .eq("nfe_id", nfeId)
      .order("n_item", { ascending: true });

    if (itensNfeError) {
      console.error("[nfe_item] erro ao buscar itens da NF-e:", itensNfeError);
      return NextResponse.json(
        {
          ok: false,
          mensagem: "Erro ao buscar itens da NF-e",
          detalhe: itensNfeError.message,
        },
        { status: 500 }
      );
    }

    if (!itensNfe || itensNfe.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          mensagem: "NF-e nÃ£o possui itens cadastrados em nfe_item.",
        },
        { status: 500 }
      );
    }

    // -------------------------------------------------------------------
    // 6) Usar o XML salvo no rascunho (xml_assinado) ou gerar um novo
    // -------------------------------------------------------------------
    const xmlRascunhoSalvo =
      typeof nfe.xml_assinado === "string" ? nfe.xml_assinado.trim() : "";

    const chaveDoBanco =
      typeof nfe.chave_acesso === "string" && nfe.chave_acesso.trim()
        ? nfe.chave_acesso.trim()
        : null;

    let chave: string | null = chaveDoBanco;
    let idNFeXml: string | null = null;

    if (xmlRascunhoSalvo) {
      const extraida = extrairChaveEIdDoXml(xmlRascunhoSalvo);
      if (extraida.chave) chave = extraida.chave;
      if (extraida.id) idNFeXml = extraida.id;
    }

    const xmlSemAssinatura = xmlRascunhoSalvo;

    // Se nÃ£o houver XML salvo, retorna erro ou poderia gerar um novo (descomente se desejar)
    if (!xmlSemAssinatura) {
      return NextResponse.json(
        {
          ok: false,
          mensagem: "NÃ£o existe XML de rascunho salvo para esta NF-e. Gere o rascunho primeiro.",
        },
        { status: 400 }
      );
    }

    // -------------------------------------------------------------------
    // 7) Carregar certificado A1 (chave privada + certificado em PEM)
    // -------------------------------------------------------------------
    const { privateKeyPem, certificatePem } = await carregarCertificadoA1(
      empresa
    );

    // -------------------------------------------------------------------
    // 8) Assinar XML da NFe (tag <infNFe>)
    // -------------------------------------------------------------------
    const xmlAssinado = assinarNFeXml(
      xmlSemAssinatura,
      privateKeyPem,
      certificatePem
    );

    // -------------------------------------------------------------------
    // 9) Montar o XML do <enviNFe> (lote) com o XML assinado
    // -------------------------------------------------------------------
    const enviNFeXml = buildEnviNFeXml(xmlAssinado);

    // -------------------------------------------------------------------
    // 10) Montar SOAP Envelope para o serviÃ§o NFeAutorizacao4
    // -------------------------------------------------------------------
    const soapEnvelope =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
      'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      "<soap12:Body>" +
      '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">' +
      enviNFeXml +
      "</nfeDadosMsg>" +
      "</soap12:Body>" +
      "</soap12:Envelope>";

    // -------------------------------------------------------------------
    // 11) URL do webservice (SVRS - PB) para PRODUÃ‡ÃƒO / HOMOLOGAÃ‡ÃƒO
    // -------------------------------------------------------------------
    const url =
      ambiente === "PRODUCAO"
        ? "https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx"
        : "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx";

    // -------------------------------------------------------------------
    // 12) Montar agente HTTPS com a chave e certificado extraÃ­dos (PEM)
    // Isso evita o erro "unsupported" que ocorre ao passar o PFX direto em Node 17+
    // -------------------------------------------------------------------
    const httpsAgent = new https.Agent({
      key: privateKeyPem,
      cert: certificatePem,
      // Em produÃ§Ã£o, o ideal Ã© deixar como true e ter a cadeia de certificados correta:
      rejectUnauthorized: false,
    });

    // -------------------------------------------------------------------
    // 13) Enviar requisiÃ§Ã£o SOAP para o webservice usando https.request
    // -------------------------------------------------------------------
    const { httpStatus, body: respostaText } = await postSoapComCert(
      url,
      soapEnvelope,
      httpsAgent
    );

    // -------------------------------------------------------------------
    // 14) Se HTTP nÃ£o for 200, jÃ¡ retorna erro bruto
    // -------------------------------------------------------------------
    if (httpStatus !== 200) {
      return NextResponse.json(
        {
          ok: false,
          ambiente,
          chave: chave ?? null,
          idNFe: idNFeXml ?? null, // Id lÃ³gico da NFe (ex: NFe3525...)
          httpStatus,
          mensagem: "Erro HTTP ao chamar NFeAutorizacao4",
          soap: {
            xmlEnviado: soapEnvelope,
            xmlRespostaSnippet: respostaText.substring(0, 2000),
          },
        },
        { status: 500 }
      );
    }

    // -------------------------------------------------------------------
    // 15) Parse do XML de retorno (retEnviNFe + protNFe)
    // -------------------------------------------------------------------
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    });

    let retEnviNFe: any = null;
    let lote_cStat: string | null = null;
    let lote_xMotivo: string | null = null;
    let prot_cStat: string | null = null;
    let prot_xMotivo: string | null = null;
    let nRec: string | null = null;
    let nProt: string | null = null;

    try {
      const parsed = parser.parse(respostaText);
      retEnviNFe = firstXmlNode(findXmlNode(parsed, "retEnviNFe"));

      lote_cStat = toText(retEnviNFe?.cStat);
      lote_xMotivo = toText(retEnviNFe?.xMotivo);
      nRec = toText(retEnviNFe?.nRec);

      const protNFe = firstXmlNode(findXmlNode(retEnviNFe, "protNFe") ?? findXmlNode(parsed, "protNFe"));
      const infProt = firstXmlNode(findXmlNode(protNFe, "infProt") ?? findXmlNode(parsed, "infProt"));

      prot_cStat = toText(infProt?.cStat);
      prot_xMotivo = toText(infProt?.xMotivo);
      nProt = toText(infProt?.nProt);
    } catch (parseErr) {
      console.warn("[nfe] erro ao parsear XML de retorno da SEFAZ:", parseErr);
    }

    if (!lote_cStat && !prot_cStat) {
      return NextResponse.json(
        {
          ok: false,
          ambiente,
          chave: chave ?? null,
          idNFe: idNFeXml ?? null,
          httpStatus,
          mensagem: "Retorno recebido da SEFAZ, mas sem cStat interpretavel.",
          soap: {
            xmlRespostaSnippet: respostaText.substring(0, 2000),
          },
        },
        { status: 502 }
      );
    }

    // -------------------------------------------------------------------
    // 16) Montar nfeProc (xml_autorizado), se tivermos protNFe no retorno
    // -------------------------------------------------------------------
    const protNFeXml = extrairProtNFeXml(respostaText);
    const xmlAutorizado = buildNfeProcXml(xmlAssinado, protNFeXml);

    // -------------------------------------------------------------------
    // 17) Determinar novo status da NF-e
    // -------------------------------------------------------------------
    let novoStatus: string | null = null;

    if (prot_cStat === "100") {
      // Autorizado o uso da NF-e
      novoStatus = "AUTORIZADA";
    } else if (["110", "301", "302"].includes(prot_cStat || "")) {
      // Denegada
      novoStatus = "DENEGADA";
    } else if (prot_cStat && prot_cStat !== "100") {
      // Qualquer outra rejeiÃ§Ã£o de protocolo
      novoStatus = "REJEITADA";
    } else if (lote_cStat === "103" || (lote_cStat === "104" && !prot_cStat)) {
      // 103: Lote recebido; 104 sem prot -> fluxo assÃ­ncrono
      novoStatus = "ENVIADA";
    }

    // -------------------------------------------------------------------
    // 18) Atualizar tabela nfe com status / protocolo / xml
    // -------------------------------------------------------------------
    let statusFinal = statusAtual;
    let protocoloFinal: string | null = nfe.protocolo ?? null;

    try {
      const updatePayload: any = {
        xml_assinado: xmlAssinado,
        updatedat: new Date().toISOString(),
      };

      // garante que o banco sempre fique com a MESMA chave usada no XML
      if (chave) {
        updatePayload.chave_acesso = chave;
      }

      if (xmlAutorizado) {
        updatePayload.xml_autorizado = xmlAutorizado;
      }

      // NÃƒO rebaixar AUTORIZADA para REJEITADA em caso de duplicidade/testes
      if (novoStatus) {
        if (statusAtual === "AUTORIZADA" && novoStatus === "REJEITADA") {
          console.warn(
            `[nfe] tentativa de mudar NF-e ${nfeId} de AUTORIZADA para REJEITADA. Mantendo AUTORIZADA.`
          );
        } else {
          updatePayload.status = novoStatus;
          statusFinal = novoStatus;
        }
      }

      // Registra o retorno da SEFAZ para que a nota rejeitada possa ser corrigida
      // depois, sem depender do toast do momento do envio.
      if (statusFinal === "REJEITADA" || statusFinal === "DENEGADA") {
        updatePayload.codigo_rejeicao = prot_cStat ?? lote_cStat ?? null;
        updatePayload.motivo_rejeicao = prot_xMotivo ?? lote_xMotivo ?? null;
        updatePayload.rejeitada_em = new Date().toISOString();
      } else if (statusFinal === "AUTORIZADA") {
        // A nota foi corrigida e passou: a rejeicao anterior deixa de valer.
        updatePayload.codigo_rejeicao = null;
        updatePayload.motivo_rejeicao = null;
        updatePayload.rejeitada_em = null;
      }

      if (nProt) {
        updatePayload.protocolo = nProt;
        protocoloFinal = nProt;
      }

      if (statusFinal === "AUTORIZADA") {
        // Usamos "agora" como data de autorizaÃ§Ã£o (poderia ser dhRecbto do infProt tambÃ©m)
        updatePayload.dataautorizacao = new Date().toISOString();
      }

      await supabaseAdmin.from("nfe").update(updatePayload).eq("id", nfeId);
    } catch (updateErr) {
      console.warn(
        "[nfe] falha ao atualizar status/infos da NF-e:",
        updateErr
      );
    }

    // -------------------------------------------------------------------
    // 19) Responder JSON para o frontend
    // -------------------------------------------------------------------
    return NextResponse.json({
      ok: true,
      ambiente,
      chave: chave ?? null,
      idNFe: idNFeXml ?? null, // Id lÃ³gico da NFe no XML, nÃ£o o id da tabela
      httpStatus,
      sefaz: {
        lote: {
          cStat: lote_cStat,
          xMotivo: lote_xMotivo,
          nRec,
        },
        protocolo: {
          cStat: prot_cStat,
          xMotivo: prot_xMotivo,
          nProt,
        },
      },
      nfeDb: {
        id: nfeId,
        status: statusFinal ?? novoStatus ?? statusAtual ?? null,
        protocolo: protocoloFinal,
      },
      soap: {
        xmlEnviado: soapEnvelope,
        xmlRespostaSnippet: respostaText.substring(0, 2000),
      },
    });
  } catch (e: any) {
    console.error("Erro em /api/nfe/autorizar/[id]:", e);
    return NextResponse.json(
      {
        ok: false,
        mensagem: "Erro interno ao enviar NF-e para autorizaÃ§Ã£o",
        detalhe: String(e?.message ?? e),
        stack: e?.stack ?? null,
      },
      { status: 500 }
    );
  }
}

// ATENÃ‡ÃƒO: no Next 15, params Ã© uma Promise.
// Aqui a gente resolve isso no POST e passa sÃ³ o id (string) para o handler.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  return autorizarHandler(req, id);
}
