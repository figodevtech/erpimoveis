// src/app/api/nfe/autorizar/[id]/route.ts

import { NextResponse } from "next/server";
import https from "https";
import { XMLParser } from "fast-xml-parser";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  garantirNumeroDefinitivo,
  liberarNumeroNfe,
  rejeicaoConsomeNumero,
} from "@/services/fiscal/nfeNumeracaoService";
import { carregarCertificadoA1 } from "@/lib/nfe/certificado";
import { assinarNFeXml } from "@/lib/nfe/assinatura";
import { buildEnviNFeXml } from "@/lib/nfe/enviNFe";
import { exigirModelo, MODELO_NFCE } from "@/lib/nfe/modeloDocumento";
import { normalizarNiveisDeReferencia, normalizarOrdemNfRefIde } from "@/lib/nfe/xmlIde";
import { atualizarDataEmissao } from "@/lib/nfe/nfce/dataEmissao";
import { resolveSefazEndpoint } from "@/lib/nfe/webservices";
import { anexarQrCodeNfce } from "@/services/fiscal/nfceQrCodeService";
import { consultarProtocoloNfe } from "@/services/fiscal/nfeConsultaProtocoloService";
import type { ClienteRow, EmpresaRow } from "@/lib/nfe/types";
import { truncateNfeXNomeInXml } from "@/lib/nfe/xmlUtils";
import { rascunhoPrecisaSerRegerado } from "@/lib/nfe/taxRules";
import { bloqueioAutorizacaoE16a30 } from "@/lib/nfe/bloqueioAutorizacaoE16a30";
import { classificarRetornoAutorizacao, motivoBloqueioTransmissao } from "@/lib/nfe/retornoAutorizacao";

export const runtime = "nodejs";

/**
 * Envia SOAP via https.request usando client-cert (PFX).
 */
/**
 * Timeout da chamada à SEFAZ.
 *
 * Sem limite, uma SEFAZ lenta prende o request até o timeout da plataforma e o
 * operador clica de novo — que é exatamente como nasce nota duplicada.
 */
const SEFAZ_TIMEOUT_MS = 30_000;

/**
 * Erros de rede que provam que o lote NUNCA chegou à SEFAZ.
 *
 * São falhas na fase de conexão: DNS que não resolve, porta recusada, host
 * inalcançável. Nenhum byte do documento foi processado do outro lado, então a
 * nota com certeza não existe lá — e é seguro reemiti-la em contingência com o
 * mesmo número.
 */
const ERROS_ANTES_DO_ENVIO = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ECONNRESET",
]);

/**
 * Falha de comunicação com a SEFAZ.
 *
 * `entregue` distingue os dois desfechos que exigem tratamento oposto:
 *
 *   false → o lote não saiu daqui. A nota não existe na SEFAZ e pode ser
 *           emitida em contingência;
 *   true  → mandamos e a resposta se perdeu. NÃO sabemos o desfecho: emitir
 *           outra versão do mesmo documento duplicaria a nota.
 */
class SefazComunicacaoError extends Error {
  constructor(
    readonly causa: string,
    readonly entregue: boolean,
  ) {
    super(`Falha de comunicação com a SEFAZ: ${causa}`);
    this.name = "SefazComunicacaoError";
  }
}

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
        timeout: SEFAZ_TIMEOUT_MS,
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

    // Timeout de resposta: o pedido já foi flushado, então pode ter sido
    // processado. É o caso incerto, e o único tratamento seguro é consultar a
    // chave depois — nunca reemitir.
    req.on("timeout", () => {
      req.destroy(
        new SefazComunicacaoError(`sem resposta em ${SEFAZ_TIMEOUT_MS / 1000}s`, true)
      );
    });

    req.on("error", (err) => {
      if (err instanceof SefazComunicacaoError) return reject(err);

      const codigo = String((err as NodeJS.ErrnoException)?.code ?? "");
      reject(
        new SefazComunicacaoError(
          `${codigo || "erro de rede"}: ${String((err as Error)?.message ?? err)}`,
          !ERROS_ANTES_DO_ENVIO.has(codigo)
        )
      );
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
    // 0) Permissão: transmitir para a SEFAZ é ação fiscal, não é só estar logado
    // -------------------------------------------------------------------
    await requireEmissaoFiscalAccess();

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
    const bloqueioTransmissao = motivoBloqueioTransmissao(statusAtual);
    if (bloqueioTransmissao) {
      return NextResponse.json({ ok: false, mensagem: bloqueioTransmissao, nfeDb: {
        id: nfeId, status: statusAtual, protocolo: nfe.protocolo ?? null,
      } }, { status: 409 });
    }

    if (rascunhoPrecisaSerRegerado(nfe)) {
      return NextResponse.json(
        {
          ok: false,
          tipo: "REGRA_FISCAL_DESATUALIZADA",
          mensagem:
            "Este rascunho foi montado com uma versão anterior das regras fiscais. " +
            "Abra a nota, confira os tributos e salve de novo antes de transmitir.",
        },
        { status: 409 }
      );
    }

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

    // Ambiente da NOTA, gravado quando o rascunho nasceu a partir da config do
    // modelo. Usar o da empresa mandaria uma NFC-e ainda em homologação para o
    // ambiente de produção da SEFAZ.
    const ambiente =
      (nfe.ambiente ?? empresa.ambiente) === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO";

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

    // Se nÃ£o houver XML salvo, retorna erro ou poderia gerar um novo (descomente se desejar)
    if (!xmlRascunhoSalvo) {
      return NextResponse.json(
        {
          ok: false,
          mensagem: "NÃ£o existe XML de rascunho salvo para esta NF-e. Gere o rascunho primeiro.",
        },
        { status: 400 }
      );
    }

    // -------------------------------------------------------------------
    // 6.1) Numeração definitiva
    //
    // O rascunho carrega número provisório; é aqui, na beira do envio, que o
    // número real é alocado e entra no XML (nNF, cDV, chave). Retransmissão de
    // nota que já foi numerada repete o mesmo número.
    // -------------------------------------------------------------------
    // Compatibilidade com rascunhos criados pela versão que gravava NFref
    // depois de cMunFG. O XSD exige o grupo no fim de ide; a assinatura antiga
    // é descartada por assinarNFeXml e refeita abaixo.
    // Duas correcoes de rascunho legado antes de numerar e assinar: a ordem do
    // NFref dentro do <ide> e a convivencia proibida entre referencia de
    // cabecalho e de item (rejeicao 1010).
    const xmlRascunhoNormalizado = truncateNfeXNomeInXml(
      normalizarNiveisDeReferencia(
        normalizarOrdemNfRefIde(xmlRascunhoSalvo),
      ),
    );
    // O XML salvo pode ser anterior à regra ou ter sido editado manualmente.
    // Validar o documento real antes de reservar número, assinar ou transmitir.
    const bloqueio805 = bloqueioAutorizacaoE16a30(xmlRascunhoNormalizado);
    if (bloqueio805) {
      return NextResponse.json(bloqueio805.body, { status: bloqueio805.status });
    }
    const numeracao = await garantirNumeroDefinitivo(nfeId, xmlRascunhoNormalizado);
    const modeloNota = exigirModelo(nfe.modelo);

    // A NFC-e admite ~5 minutos entre a data de emissão e a autorização
    // (NT 2025.001, item 02.4). O rascunho pode ter ficado aberto bem mais que
    // isso, então a data é renovada aqui, imediatamente antes de assinar.
    //
    // Contingência é a exceção: a nota foi emitida offline horas antes e o
    // cupom já está com o consumidor, com aquela data impressa e dentro do QR
    // Code. Renovar o dhEmi aqui faria o documento transmitido divergir do
    // papel entregue.
    const emContingencia = String(nfe.status) === "CONTINGENCIA";
    const xmlSemAssinatura =
      modeloNota === MODELO_NFCE && !emContingencia
        ? atualizarDataEmissao(numeracao.xml)
        : numeracao.xml;

    if (numeracao.alocadoAgora) {
      const extraida = extrairChaveEIdDoXml(xmlSemAssinatura);
      chave = extraida.chave ?? numeracao.chave ?? chave;
      idNFeXml = extraida.id ?? idNFeXml;
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
    const xmlAssinadoBase = assinarNFeXml(
      xmlSemAssinatura,
      privateKeyPem,
      certificatePem
    );

    // -------------------------------------------------------------------
    // 8.1) QR Code da NFC-e
    //
    // Entra depois da numeração definitiva (o QR carrega a chave) e depois da
    // assinatura (na contingência o QR usa o DigestValue). Acrescentar
    // <infNFeSupl> aqui não invalida nada: a assinatura cobre <infNFe>.
    // -------------------------------------------------------------------
    const xmlAssinado =
      modeloNota === MODELO_NFCE && chave
        ? (
            await anexarQrCodeNfce({
              xmlAssinado: xmlAssinadoBase,
              chaveAcesso: chave,
              uf: String(empresa.uf ?? ""),
              ambiente,
              empresaId: Number(nfe.empresaid),
              // O QR v3 em contingência é assinado com o mesmo certificado do
              // XML; nas demais combinações a chave nem é tocada.
              privateKeyPem,
            })
          ).xml
        : xmlAssinadoBase;

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
    // 11) URL do webservice, resolvida por modelo/UF/ambiente
    //
    // A NFC-e usa hosts próprios (nfce.svrs), não os da NF-e: mandar a 65 para
    // o endereço da 55 volta como rejeição de modelo.
    // -------------------------------------------------------------------
    const url = resolveSefazEndpoint({
      modelo: modeloNota,
      uf: String(empresa.uf ?? ""),
      ambiente,
      servico: "autorizacao",
    });

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
    //
    // Se a comunicação falhar depois do envio, NÃO sabemos se a SEFAZ
    // autorizou. Assumir "não autorizada" e deixar emitir de novo é como se
    // duplica documento fiscal. A nota fica em RESULTADO_INCERTO, segurando o
    // número, e a conciliação é feita consultando a chave.
    let httpStatus: number;
    let respostaText: string;
    try {
      ({ httpStatus, body: respostaText } = await postSoapComCert(url, soapEnvelope, httpsAgent));
    } catch (erroComunicacao: any) {
      const entregue = erroComunicacao?.entregue !== false;
      // Não entregue: a nota não existe na SEFAZ, o número continua reservado e
      // a contingência é o caminho legítimo. Entregue sem resposta: só a
      // consulta da chave resolve.
      const novoStatus = entregue ? "RESULTADO_INCERTO" : "PENDENTE_ENVIO";

      await supabaseAdmin
        .from("nfe")
        .update({
          status: novoStatus,
          xml_assinado: xmlAssinado,
          motivo_rejeicao: String(erroComunicacao?.message ?? erroComunicacao).slice(0, 500),
          updatedat: new Date().toISOString(),
        })
        .eq("id", nfeId).neq("status", "AUTORIZADA").neq("status", "CANCELADA").neq("status", "DENEGADA");

      return NextResponse.json(
        {
          ok: false,
          ambiente,
          chave: chave ?? null,
          idNFe: idNFeXml ?? null,
          // A tela usa esta flag para decidir se oferece o botão de
          // contingência. Rejeição fiscal nunca passa por aqui.
          podeEmitirEmContingencia: !entregue && modeloNota === MODELO_NFCE,
          mensagem: entregue
            ? "A nota foi enviada, mas a resposta da SEFAZ não chegou. NÃO emita outra: " +
              "consulte a situação da chave para saber se ela foi autorizada."
            : "Não foi possível alcançar a SEFAZ. A nota não chegou lá e pode ser emitida " +
              "em contingência para não travar a venda.",
          detalhe: String(erroComunicacao?.message ?? erroComunicacao),
          nfeDb: { id: nfeId, status: novoStatus, protocolo: nfe.protocolo ?? null },
        },
        { status: 504 }
      );
    }

    // -------------------------------------------------------------------
    // 14) Se HTTP nÃ£o for 200, jÃ¡ retorna erro bruto
    // -------------------------------------------------------------------
    const registrarResultadoIncerto = async () => {
      const { error } = await supabaseAdmin.from("nfe").update({
        status: "RESULTADO_INCERTO", xml_assinado: xmlAssinado,
        updatedat: new Date().toISOString(),
      }).eq("id", nfeId).neq("status", "AUTORIZADA").neq("status", "CANCELADA").neq("status", "DENEGADA");
      if (error) throw error;
    };
    if (httpStatus !== 200) {
      await registrarResultadoIncerto();
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
      parseTagValue: false,
    });

    let retEnviNFe: any = null;
    let lote_cStat: string | null = null;
    let lote_xMotivo: string | null = null;
    let prot_cStat: string | null = null;
    let prot_xMotivo: string | null = null;
    let nRec: string | null = null;
    let nProt: string | null = null;
    let chaveProtocolo: string | null = null;

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
      chaveProtocolo = toText(infProt?.chNFe);
    } catch (parseErr) {
      console.warn("[nfe] erro ao parsear XML de retorno da SEFAZ:", parseErr);
    }

    if (!lote_cStat && !prot_cStat) {
      await registrarResultadoIncerto();
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
    let protNFeXml = extrairProtNFeXml(respostaText);
    let xmlAutorizado: string | null = null;
    let dataAutorizacaoSefaz: string | null = null;

    // 204 significa que ESTA MESMA chave já está na SEFAZ. Isso acontece, por
    // exemplo, quando uma primeira transmissão é autorizada e a resposta se
    // perde ou quando dois requests saem quase juntos. Tratar o segundo retorno
    // como rejeição sobrescrevia a autorização local e fazia a nota "sumir" da
    // lista de autorizadas. A fonte da verdade aqui é a consulta da chave.
    if ((prot_cStat === "204" || lote_cStat === "204") && chave) {
      try {
        const consulta = await consultarProtocoloNfe({
          chaveAcesso: chave,
          ambiente,
          agent: httpsAgent,
        });

        if (consulta.protocolo.cStat === "100" && consulta.protocolo.chNFe === chave && consulta.protocolo.nProt) {
          lote_cStat = consulta.cStat;
          lote_xMotivo = consulta.xMotivo;
          prot_cStat = consulta.protocolo.cStat;
          prot_xMotivo = consulta.protocolo.xMotivo;
          nProt = consulta.protocolo.nProt;
          chaveProtocolo = consulta.protocolo.chNFe;
          dataAutorizacaoSefaz = consulta.protocolo.dhRecbto;
          protNFeXml = consulta.protNFeXml;
          xmlAutorizado = buildNfeProcXml(xmlAssinado, protNFeXml);
        }
      } catch (consultaError) {
        // A proteção atômica abaixo ainda impede que uma resposta 204 tardia
        // rebaixe uma linha que outro request já salvou como AUTORIZADA. Se a
        // primeira resposta realmente se perdeu, o operador pode consultar a
        // chave de novo pela tela.
        console.warn(
          `[nfe] não foi possível reconciliar automaticamente a duplicidade da NF-e ${nfeId}:`,
          consultaError,
        );
      }
    }

    // -------------------------------------------------------------------
    // 17) Determinar novo status da NF-e
    // -------------------------------------------------------------------
    const novoStatus = classificarRetornoAutorizacao({
      lote: lote_cStat, protocolo: prot_cStat, numeroProtocolo: nProt,
      chaveEnviada: chave, chaveProtocolo,
    });
    if (novoStatus === "AUTORIZADA") xmlAutorizado = buildNfeProcXml(xmlAssinado, protNFeXml);

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

      if (nProt && (novoStatus === "AUTORIZADA" || novoStatus === "DENEGADA")) {
        updatePayload.protocolo = nProt;
        protocoloFinal = nProt;
      }

      if (statusFinal === "AUTORIZADA") {
        updatePayload.dataautorizacao = dataAutorizacaoSefaz ?? new Date().toISOString();
      }

      // Uma resposta de rejeição pode chegar depois da resposta autorizada de
      // outro request. A condição no próprio UPDATE fecha essa corrida: não há
      // janela entre reler o status e gravar o novo valor.
      const updateQuery = supabaseAdmin.from("nfe").update(updatePayload).eq("id", nfeId)
        .neq("status", "AUTORIZADA").neq("status", "CANCELADA").neq("status", "DENEGADA");

      const { data: nfeAtualizada, error: updateError } = await updateQuery
        .select("status, protocolo, dataautorizacao")
        .maybeSingle();

      if (updateError) throw updateError;

      if (!nfeAtualizada) {
        const { data: nfePersistida, error: readError } = await supabaseAdmin
          .from("nfe")
          .select("status, protocolo, dataautorizacao")
          .eq("id", nfeId)
          .maybeSingle();
        if (readError) throw readError;

        if (nfePersistida && ["AUTORIZADA", "CANCELADA", "DENEGADA"].includes(nfePersistida.status)) {
          statusFinal = nfePersistida.status;
          protocoloFinal = nfePersistida.protocolo ?? protocoloFinal;
        }
      }
    } catch (updateErr) {
      console.warn(
        "[nfe] falha ao atualizar status/infos da NF-e:",
        updateErr
      );
    }

    // Rejeitada é nota que não existe na SEFAZ: o número volta para a fila e é
    // reaproveitado na próxima transmissão. Denegada e autorizada consomem o
    // número; retorno de lote em aberto também o mantém reservado.
    //
    // A exceção são as rejeições de duplicidade (204 e 539): elas dizem que a
    // SEFAZ já tem esse número. Devolvê-lo à fila faria a transmissão seguinte
    // pegar o mesmo número e colher a mesma rejeição indefinidamente.
    if (statusFinal === "REJEITADA") {
      const codigoRejeicao = prot_cStat ?? lote_cStat ?? null;
      if (rejeicaoConsomeNumero(codigoRejeicao)) {
        console.warn(
          `[nfe] numero ${numeracao.numero} da serie ${numeracao.serie} ja existe na SEFAZ ` +
            `(rejeicao ${codigoRejeicao}); mantido fora da fila de reaproveitamento.`,
        );
      } else {
        await liberarNumeroNfe(nfeId, `Rejeicao ${codigoRejeicao ?? "sem codigo"}`);
      }
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

    if (e?.statusCode === 403) {
      return NextResponse.json(
        { ok: false, mensagem: "Você não tem permissão para transmitir documentos fiscais." },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        mensagem: "Erro interno ao enviar a nota para autorização",
        detalhe: String(e?.message ?? e),
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
