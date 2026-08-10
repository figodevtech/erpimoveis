import "server-only";

import { assinarNFeXml } from "@/lib/nfe/assinatura";
import { carregarCertificadoA1 } from "@/lib/nfe/certificado";
import { exigirModelo, MODELO_NFCE } from "@/lib/nfe/modeloDocumento";
import { converterParaContingencia } from "@/lib/nfe/nfce/contingencia";
import type { EmpresaRow } from "@/lib/nfe/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { garantirNumeroDefinitivo } from "@/services/fiscal/nfeNumeracaoService";
import { anexarQrCodeNfce } from "@/services/fiscal/nfceQrCodeService";

/**
 * Emissão de NFC-e em contingência offline.
 *
 * O documento é montado, assinado e guardado — mas NÃO é transmitido. O cupom
 * sai na hora para o consumidor e a transmissão acontece depois, quando a
 * conexão voltar, pela mesma rota de autorização.
 *
 * A regra que este serviço protege: contingência só vale para falha técnica de
 * comunicação. Rejeição da SEFAZ significa que ela está no ar e que o documento
 * está errado — o caminho ali é corrigir, não emitir offline.
 */

/**
 * Estados a partir dos quais é legítimo emitir em contingência.
 *
 * RESULTADO_INCERTO fica de fora de propósito: naquele caso o lote pode ter
 * sido processado pela SEFAZ, e reemitir criaria um segundo documento para a
 * mesma venda. Lá o caminho é consultar a chave.
 */
const STATUS_PERMITIDOS = new Set(["RASCUNHO", "REJEITADA", "PENDENTE_ENVIO"]);

export type ResultadoContingencia = {
  ok: true;
  nfeId: number;
  chave: string;
  numero: number;
  serie: number;
  dhEmi: string;
};

export async function emitirNfceEmContingencia(
  nfeId: number,
): Promise<ResultadoContingencia | { ok: false; message: string }> {
  const { data: nfe, error } = await supabaseAdmin
    .from("nfe")
    .select("id, empresaid, modelo, status, numero, serie, xml_assinado")
    .eq("id", nfeId)
    .maybeSingle();

  if (error) throw error;
  if (!nfe) return { ok: false as const, message: "Nota não encontrada." };

  if (exigirModelo(nfe.modelo) !== MODELO_NFCE) {
    return {
      ok: false as const,
      message: "Contingência offline (tpEmis 9) é exclusiva da NFC-e modelo 65.",
    };
  }

  if (!STATUS_PERMITIDOS.has(String(nfe.status))) {
    const emIncerteza = String(nfe.status) === "RESULTADO_INCERTO";
    return {
      ok: false as const,
      message: emIncerteza
        ? "Esta NFC-e foi enviada e a resposta se perdeu. Consulte a situação da chave antes " +
          "de qualquer nova emissão — emitir em contingência agora duplicaria o documento."
        : `Não é possível emitir em contingência uma NFC-e com status ${nfe.status}.`,
    };
  }

  const xmlRascunho = typeof nfe.xml_assinado === "string" ? nfe.xml_assinado.trim() : "";
  if (!xmlRascunho) {
    return { ok: false as const, message: "A NFC-e não tem XML gerado. Refaça o rascunho." };
  }

  const { data: empresa, error: empresaError } = await supabaseAdmin
    .from("empresa")
    .select("*")
    .eq("id", nfe.empresaid)
    .maybeSingle<EmpresaRow>();
  if (empresaError) throw empresaError;
  if (!empresa) return { ok: false as const, message: "Empresa da nota não encontrada." };

  // O número precisa ser definitivo ANTES de converter: ele compõe a chave, e a
  // chave é congelada no papel entregue ao consumidor.
  const numeracao = await garantirNumeroDefinitivo(nfeId, xmlRascunho);

  const convertido = converterParaContingencia(numeracao.xml);

  const { privateKeyPem, certificatePem } = await carregarCertificadoA1(empresa);
  const xmlAssinado = assinarNFeXml(convertido.xml, privateKeyPem, certificatePem);

  const ambiente = empresa.ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO";
  const { xml: xmlComQrCode } = await anexarQrCodeNfce({
    xmlAssinado,
    chaveAcesso: convertido.chave,
    uf: String(empresa.uf ?? ""),
    ambiente,
    empresaId: Number(nfe.empresaid),
    privateKeyPem,
  });

  const { error: updateError } = await supabaseAdmin
    .from("nfe")
    .update({
      status: "CONTINGENCIA",
      chave_acesso: convertido.chave,
      xml_assinado: xmlComQrCode,
      dataemissao: convertido.dhEmi,
      // Contingência anterior a uma rejeição não interessa mais.
      codigo_rejeicao: null,
      motivo_rejeicao: null,
      rejeitada_em: null,
      updatedat: new Date().toISOString(),
    })
    .eq("id", nfeId);

  if (updateError) throw updateError;

  console.info("[nfce] emitida em contingência", {
    nfeId,
    numero: numeracao.numero,
    serie: numeracao.serie,
    ambiente,
    tpEmis: 9,
  });

  return {
    ok: true as const,
    nfeId,
    chave: convertido.chave,
    numero: numeracao.numero,
    serie: numeracao.serie,
    dhEmi: convertido.dhEmi,
  };
}

/** NFC-e emitidas offline que ainda não foram transmitidas. */
export async function listarContingenciasPendentes(empresaId?: number) {
  let query = supabaseAdmin
    .from("nfe")
    .select("id, numero, serie, chave_acesso, dataemissao, vendaid, ordemservicoid, total_nfe")
    .eq("modelo", "NFCE")
    .eq("status", "CONTINGENCIA")
    .order("dataemissao", { ascending: true });

  if (empresaId != null) query = query.eq("empresaid", empresaId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
