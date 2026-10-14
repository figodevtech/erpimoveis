import { NFSeService, normalizarStatusNFSe } from "@/lib/services/fiscais/nfse-service";
import {
  atualizarRegistroNFSe,
  interacaoNFSe,
  registrarInteracaoNFSe,
  temResultadoIncerto,
} from "@/lib/services/fiscais/nfse-registro";
import { transportDoRegistro } from "@/lib/services/fiscais/nfse-transport";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type NfseSyncRecord = {
  id: number;
  referencia: string | null;
  modelo_emissao?: string | null;
  empresaid?: number | null;
  status?: string | null;
  url_consulta?: string | null;
  url_pdf?: string | null;
  url_xml?: string | null;
  protocolo?: string | null;
  numero?: string | null;
  erros?: unknown;
};

async function loadCompany(nfse: NfseSyncRecord) {
  const query = supabaseAdmin.from("empresa").select("id, ambiente");
  const result = nfse.empresaid
    ? await query.eq("id", nfse.empresaid).maybeSingle()
    : await query.limit(1).maybeSingle();

  if (result.error) throw result.error;
  if (!result.data) throw new Error("Empresa da NFS-e não encontrada.");
  return result.data;
}

/**
 * Consulta a Focus e persiste status e URLs sem confundir o espelho HTML com
 * o PDF. Reutilizado pela consulta manual e pelo anexo automático.
 */
export async function syncNfseWithFocus(nfse: NfseSyncRecord) {
  if (!nfse.referencia) {
    return {
      ok: false as const,
      message: "A referência da NFS-e é nula no banco de dados.",
      errors: null,
    };
  }

  const company = await loadCompany(nfse);
  const { data: config, error: configError } = await supabaseAdmin
    .from("nfse_config")
    .select("token")
    .eq("empresa_id", company.id)
    .maybeSingle();
  if (configError) throw configError;

  const service = new NFSeService();
  service.configurarAmbiente(company.ambiente, config?.token);

  // O transporte sai do modelo gravado na nota, não da política de hoje.
  const transport = transportDoRegistro(nfse.modelo_emissao, service);
  if (!transport.disponivel) {
    return { ok: false as const, message: transport.motivoIndisponivel ?? "Consulta indisponível.", errors: null };
  }
  const result = await transport.consultar(nfse.referencia);
  // Cada consulta entra no histórico; `retorno_bruto` fica só com a última.
  await registrarInteracaoNFSe(nfse.id, interacaoNFSe("CONSULTA", nfse.referencia, result.retornoBruto));

  if (!result.ok) {
    // Envio que ficou sem resposta e a Focus não conhece a referência: nada
    // chegou lá. Só agora é seguro liberar o reenvio.
    if (temResultadoIncerto(nfse.erros) && result.retornoBruto?.http_status === 404) {
      const erros = [{
        codigo: "NAO_RECEBIDA",
        mensagem: "A Focus não recebeu esta emissão: a referência não existe lá. A nota pode ser reenviada.",
      }];
      const updateError = await atualizarRegistroNFSe(
        nfse.id,
        { status: "REJEITADA", erros },
        { retorno_bruto: result.retornoBruto },
      );
      if (updateError) throw updateError;
      return { ok: false as const, message: erros[0].mensagem, errors: erros };
    }
    const errors = result.erros && result.erros.length > 0 ? result.erros : null;
    if (errors) {
      const updateError = await atualizarRegistroNFSe(
        nfse.id,
        { erros: errors },
        { retorno_bruto: result.retornoBruto },
      );
      if (updateError) throw updateError;
    }
    return {
      ok: false as const,
      message: result.message || "Falha na comunicação com a API Focus NFS-e.",
      errors,
    };
  }

  const finalStatus = normalizarStatusNFSe(result.status);
  const consultationUrl = result.url_consulta || nfse.url_consulta || null;
  const oldPdfWasConsultation = Boolean(
    result.url_consulta
    && nfse.url_pdf
    && result.url_consulta === nfse.url_pdf,
  );
  const pdfUrl = result.url_pdf || (oldPdfWasConsultation ? null : nfse.url_pdf) || null;
  // O XML só existe depois de autorizar; guardado aqui, o visualizador abre sem
  // ter de consultar a Focus de novo a cada vez.
  const xmlUrl = result.url_xml || nfse.url_xml || null;
  const errors = result.erros && result.erros.length > 0 ? result.erros : null;
  const updateError = await atualizarRegistroNFSe(
    nfse.id,
    {
      status: finalStatus,
      url_consulta: consultationUrl,
      url_pdf: pdfUrl,
      url_xml: xmlUrl,
      erros: errors,
      protocolo: result.codigo_verificacao || nfse.protocolo || null,
      numero: result.numero || nfse.numero || null,
    },
    { retorno_bruto: result.retornoBruto },
  );

  if (updateError) throw updateError;

  return {
    ok: true as const,
    status: finalStatus,
    consultationUrl,
    pdfUrl,
  };
}
