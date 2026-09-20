import https from "node:https";

import { assinarNFeXml } from "../../src/lib/nfe/assinatura";
import { carregarCertificadoA1 } from "../../src/lib/nfe/certificado";
import { normalizarNiveisDeReferencia, normalizarOrdemNfRefIde } from "../../src/lib/nfe/xmlIde";
import { truncateNfeXNomeInXml } from "../../src/lib/nfe/xmlUtils";
import { supabaseAdmin } from "../../src/lib/supabaseAdmin";
import { consultarProtocoloNfe } from "../../src/services/fiscal/nfeConsultaProtocoloService";

function montarNfeProc(xmlAssinado: string, protNFeXml: string): string {
  const nfeSemDeclaracao = xmlAssinado.replace(/<\?xml[^>]*\?>\s*/i, "");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    nfeSemDeclaracao +
    protNFeXml +
    "</nfeProc>"
  );
}

async function main() {
  const nfeId = Number(process.argv[2]);
  if (!Number.isInteger(nfeId) || nfeId <= 0) {
    throw new Error("Informe o ID local da NF-e. Ex.: tsx scripts/nfe/reconciliar-autorizacao.ts 175");
  }

  const { data: nfe, error: nfeError } = await supabaseAdmin
    .from("nfe")
    .select("*")
    .eq("id", nfeId)
    .single();
  if (nfeError) throw nfeError;

  const { data: empresa, error: empresaError } = await supabaseAdmin
    .from("empresa")
    .select("*")
    .eq("id", nfe.empresaid)
    .single();
  if (empresaError) throw empresaError;

  const { privateKeyPem, certificatePem } = await carregarCertificadoA1(empresa);
  const agent = new https.Agent({
    key: privateKeyPem,
    cert: certificatePem,
    rejectUnauthorized: false,
  });
  const consulta = await consultarProtocoloNfe({
    chaveAcesso: String(nfe.chave_acesso ?? ""),
    ambiente: nfe.ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO",
    agent,
  });

  if (consulta.protocolo.cStat !== "100") {
    throw new Error(
      `A SEFAZ não confirmou autorização: ${consulta.protocolo.cStat ?? consulta.cStat ?? "sem cStat"} - ` +
        `${consulta.protocolo.xMotivo ?? consulta.xMotivo ?? "sem motivo"}`,
    );
  }
  if (!consulta.protocolo.nProt || !consulta.protNFeXml) {
    throw new Error("A SEFAZ confirmou a autorização, mas não devolveu o protocolo completo.");
  }

  const xmlBase = truncateNfeXNomeInXml(
    normalizarNiveisDeReferencia(normalizarOrdemNfRefIde(String(nfe.xml_assinado ?? ""))),
  );
  const xmlAssinado = assinarNFeXml(xmlBase, privateKeyPem, certificatePem);
  const xmlAutorizado = montarNfeProc(xmlAssinado, consulta.protNFeXml);

  const { data: atualizada, error: updateError } = await supabaseAdmin
    .from("nfe")
    .update({
      status: "AUTORIZADA",
      protocolo: consulta.protocolo.nProt,
      dataautorizacao: consulta.protocolo.dhRecbto ?? new Date().toISOString(),
      xml_assinado: xmlAssinado,
      xml_autorizado: xmlAutorizado,
      codigo_rejeicao: null,
      motivo_rejeicao: null,
      rejeitada_em: null,
      updatedat: new Date().toISOString(),
    })
    .eq("id", nfeId)
    .select("id, numero, status, protocolo, dataautorizacao, vendaid")
    .single();

  if (updateError) throw updateError;
  console.log(JSON.stringify(atualizada, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
