import "server-only";

import https from "https";
import { XMLParser } from "fast-xml-parser";

import { assinarInutilizacaoXml } from "@/lib/nfe/assinaturaEvento";
import { carregarCertificadoA1 } from "@/lib/nfe/certificado";
import { modeloParaCodigo, modeloParaDb, rotuloModelo } from "@/lib/nfe/modeloDocumento";
import { getCodigoUF } from "@/lib/nfe/ufUtils";
import { resolveSefazEndpoint } from "@/lib/nfe/webservices";
import { escapeXml } from "@/lib/nfe/xmlUtils";
import type { EmpresaRow, ModeloDocumentoFiscal } from "@/lib/nfe/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirFiscalConfig } from "@/services/fiscal/nfeConfigService";

/**
 * Inutilização de faixa de numeração.
 *
 * Não confundir com cancelamento: cancelar é evento sobre uma nota que existe e
 * foi autorizada. Inutilizar é declarar ao fisco que uma faixa de números NUNCA
 * virou documento — por salto na sequência, falha de sistema ou faixa reservada
 * e abandonada. Faixa quebrada sem inutilizar é pendência com a SEFAZ.
 */

const TIMEOUT_MS = 30_000;

export type InutilizacaoInput = {
  modelo: ModeloDocumentoFiscal;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  ano?: number;
  usuarioId?: string | null;
};

export type InutilizacaoResultado = {
  ok: boolean;
  id: number;
  status: "HOMOLOGADA" | "REJEITADA" | "ERRO";
  cStat: string | null;
  motivo: string | null;
  protocolo: string | null;
};

function postSoap(url: string, envelope: string, agent: https.Agent) {
  return new Promise<{ httpStatus: number; body: string }>((resolve, reject) => {
    const alvo = new URL(url);
    const req = https.request(
      {
        hostname: alvo.hostname,
        port: alvo.port || 443,
        path: alvo.pathname,
        method: "POST",
        agent,
        timeout: TIMEOUT_MS,
        headers: {
          "Content-Type":
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF"',
          "Content-Length": Buffer.byteLength(envelope).toString(),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ httpStatus: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`SEFAZ sem resposta em ${TIMEOUT_MS / 1000}s`)));
    req.on("error", reject);
    req.write(envelope);
    req.end();
  });
}

function findNode(value: any, nome: string): any {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, nome)) return value[nome];
  for (const filho of Object.values(value)) {
    if (Array.isArray(filho)) {
      for (const item of filho) {
        const achado = findNode(item, nome);
        if (achado) return achado;
      }
    } else {
      const achado = findNode(filho, nome);
      if (achado) return achado;
    }
  }
  return null;
}

function validarEntrada(input: InutilizacaoInput): string[] {
  const erros: string[] = [];
  const justificativa = String(input.justificativa ?? "").trim();

  if (justificativa.length < 15) {
    erros.push("A justificativa deve ter pelo menos 15 caracteres.");
  }
  if (justificativa.length > 255) {
    erros.push("A justificativa deve ter no máximo 255 caracteres.");
  }
  if (!Number.isInteger(input.numeroInicial) || input.numeroInicial <= 0) {
    erros.push("Número inicial inválido.");
  }
  if (!Number.isInteger(input.numeroFinal) || input.numeroFinal <= 0) {
    erros.push("Número final inválido.");
  }
  if (input.numeroFinal < input.numeroInicial) {
    erros.push("O número final não pode ser menor que o inicial.");
  }
  return erros;
}

/**
 * Recusa inutilizar número que pertence a documento existente.
 *
 * Inutilizar uma faixa que contém nota autorizada é declaração falsa ao fisco —
 * e a SEFAZ rejeita, mas o erro é mais claro aqui.
 */
async function conflitosNaFaixa(
  empresaId: number,
  modelo: ModeloDocumentoFiscal,
  serie: number,
  inicio: number,
  fim: number,
) {
  const { data, error } = await supabaseAdmin
    .from("nfe")
    .select("numero, status")
    .eq("empresaid", empresaId)
    .eq("modelo", modeloParaDb(modelo))
    .eq("serie", serie)
    .eq("numero_definitivo", true)
    .gte("numero", inicio)
    .lte("numero", fim)
    .in("status", ["AUTORIZADA", "DENEGADA", "CANCELADA", "ENVIADA", "RESULTADO_INCERTO", "CONTINGENCIA"]);

  if (error) throw error;
  return data ?? [];
}

export async function inutilizarFaixa(
  input: InutilizacaoInput,
): Promise<InutilizacaoResultado | { ok: false; errors: string[] }> {
  const errosEntrada = validarEntrada(input);
  if (errosEntrada.length > 0) return { ok: false as const, errors: errosEntrada };

  const config = await exigirFiscalConfig(input.modelo);

  const { data: empresa, error: empresaError } = await supabaseAdmin
    .from("empresa")
    .select("*")
    .eq("id", config.empresaid)
    .maybeSingle<EmpresaRow>();
  if (empresaError) throw empresaError;
  if (!empresa) throw new Error("Empresa da configuração fiscal não encontrada.");

  const ano = input.ano ?? new Date().getFullYear();
  const conflitos = await conflitosNaFaixa(
    Number(config.empresaid),
    input.modelo,
    input.serie,
    input.numeroInicial,
    input.numeroFinal,
  );
  if (conflitos.length > 0) {
    return {
      ok: false as const,
      errors: [
        `A faixa contém ${conflitos.length} documento(s) que existem na SEFAZ ` +
          `(nº ${conflitos.map((c) => c.numero).join(", ")}). Inutilização é só para números nunca usados.`,
      ],
    };
  }

  const ambiente = empresa.ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO";
  const tpAmb = ambiente === "PRODUCAO" ? "1" : "2";
  const cUF = getCodigoUF(empresa.uf || undefined);
  const cnpj = String(empresa.cnpj ?? "").replace(/\D/g, "");
  const ano2 = String(ano).slice(-2);
  const modeloCodigo = modeloParaCodigo(input.modelo);
  const justificativa = String(input.justificativa).trim();

  // ID do leiaute: "ID" + cUF + ano(2) + CNPJ + mod + serie(3) + nNFIni(9) + nNFFin(9)
  const idInut =
    `ID${cUF}${ano2}${cnpj}${modeloCodigo}` +
    `${String(input.serie).padStart(3, "0")}` +
    `${String(input.numeroInicial).padStart(9, "0")}` +
    `${String(input.numeroFinal).padStart(9, "0")}`;

  const inutXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    `<infInut Id="${idInut}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    "<xServ>INUTILIZAR</xServ>" +
    `<cUF>${cUF}</cUF>` +
    `<ano>${ano2}</ano>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<mod>${modeloCodigo}</mod>` +
    `<serie>${input.serie}</serie>` +
    `<nNFIni>${input.numeroInicial}</nNFIni>` +
    `<nNFFin>${input.numeroFinal}</nNFFin>` +
    `<xJust>${escapeXml(justificativa)}</xJust>` +
    "</infInut>" +
    "</inutNFe>";

  const { data: registro, error: registroError } = await supabaseAdmin
    .from("nfe_inutilizacao")
    .insert({
      empresaid: Number(config.empresaid),
      modelo: modeloParaDb(input.modelo),
      ambiente,
      serie: input.serie,
      ano,
      numero_inicial: input.numeroInicial,
      numero_final: input.numeroFinal,
      justificativa,
      status: "PENDENTE",
      created_by: input.usuarioId ?? null,
    })
    .select("id")
    .single();
  if (registroError || !registro) {
    throw new Error(`Falha ao registrar a inutilização: ${registroError?.message ?? "sem id"}`);
  }

  const inutId = Number(registro.id);

  try {
    const { privateKeyPem, certificatePem } = await carregarCertificadoA1(empresa);
    const xmlAssinado = assinarInutilizacaoXml(inutXml, privateKeyPem, certificatePem);

    const envelope =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      "<soap12:Body>" +
      '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">' +
      xmlAssinado.replace(/<\?xml[^>]*\?>\s*/i, "") +
      "</nfeDadosMsg>" +
      "</soap12:Body>" +
      "</soap12:Envelope>";

    const url = resolveSefazEndpoint({
      modelo: input.modelo,
      uf: String(empresa.uf ?? ""),
      ambiente,
      servico: "inutilizacao",
    });

    const agent = new https.Agent({ key: privateKeyPem, cert: certificatePem });
    const { body } = await postSoap(url, envelope, agent);

    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
    const parsed = parser.parse(body);
    const infInut = findNode(parsed, "infInut");
    const retorno = Array.isArray(infInut) ? infInut[0] : infInut;

    const cStat = retorno?.cStat != null ? String(retorno.cStat) : null;
    const motivo = retorno?.xMotivo != null ? String(retorno.xMotivo) : null;
    const protocolo = retorno?.nProt != null ? String(retorno.nProt) : null;

    // 102 = inutilização homologada. Qualquer outro cStat é recusa.
    const status = cStat === "102" ? "HOMOLOGADA" : "REJEITADA";

    await supabaseAdmin
      .from("nfe_inutilizacao")
      .update({
        status,
        cstat: cStat,
        motivo,
        protocolo,
        xml_enviado: xmlAssinado,
        xml_retorno: body.slice(0, 20000),
        updatedat: new Date().toISOString(),
      })
      .eq("id", inutId);

    return { ok: status === "HOMOLOGADA", id: inutId, status, cStat, motivo, protocolo };
  } catch (erro: any) {
    await supabaseAdmin
      .from("nfe_inutilizacao")
      .update({
        status: "ERRO",
        motivo: String(erro?.message ?? erro).slice(0, 500),
        updatedat: new Date().toISOString(),
      })
      .eq("id", inutId);

    throw new Error(
      `Falha ao inutilizar a faixa de ${rotuloModelo(input.modelo)}: ${String(erro?.message ?? erro)}`,
    );
  }
}
