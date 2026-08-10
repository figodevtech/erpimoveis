import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { modeloParaDb, rotuloModelo } from "@/lib/nfe/modeloDocumento";
import type { ModeloDocumentoFiscal, ModeloDocumentoFiscalDb } from "@/lib/nfe/types";

/**
 * Configuração fiscal de um modelo de documento.
 *
 * Uma linha por empresa E modelo (constraint `nfe_config_empresaid_modelo_key`):
 * a NFC-e tem série, contador e ambiente próprios, independentes da NF-e.
 *
 * Os campos de CSC ficam de fora de propósito — são segredo e só saem por
 * `getCscCredencial`, que nunca é exposto a rota de leitura de tela.
 */
export type FiscalConfigRow = {
  id: number;
  empresaid: number;
  modelo: ModeloDocumentoFiscalDb;
  serie: number;
  ultimo_numero: number;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  qrcode_versao: number;
};

const CAMPOS_PUBLICOS = "id, empresaid, modelo, serie, ultimo_numero, ambiente, qrcode_versao";

/**
 * Configuração do modelo pedido. `empresaId` omitido pega a primeira empresa
 * configurada — o sistema opera com uma empresa só, mas a coluna existe e o
 * filtro por modelo é obrigatório em qualquer caso.
 */
export async function buscarFiscalConfig(
  modelo: ModeloDocumentoFiscal,
  empresaId?: number,
): Promise<FiscalConfigRow | null> {
  let query = supabaseAdmin
    .from("nfe_config")
    .select(CAMPOS_PUBLICOS)
    .eq("modelo", modeloParaDb(modelo));

  if (empresaId != null) query = query.eq("empresaid", empresaId);

  const { data, error } = await query
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<FiscalConfigRow>();

  if (error) throw error;
  return data ?? null;
}

/** Mesma busca, mas exige que exista — usada nos caminhos de emissão. */
export async function exigirFiscalConfig(
  modelo: ModeloDocumentoFiscal,
  empresaId?: number,
): Promise<FiscalConfigRow> {
  const config = await buscarFiscalConfig(modelo, empresaId);
  if (!config) {
    throw new Error(
      `Configuração de ${rotuloModelo(modelo)} não encontrada. Cadastre a série e o ambiente em Configurações › Fiscal.`,
    );
  }
  return config;
}

/**
 * Versão do leiaute do QR Code configurada para a NFC-e.
 *
 * Fica separada da credencial porque a versão 3 não usa CSC: perguntar a versão
 * não pode exigir um segredo que talvez nem precise existir.
 */
export async function getQrCodeVersao(empresaId?: number): Promise<number> {
  let query = supabaseAdmin.from("nfe_config").select("qrcode_versao").eq("modelo", "NFCE");
  if (empresaId != null) query = query.eq("empresaid", empresaId);

  const { data, error } = await query.order("id", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Configuração de NFC-e não encontrada.");

  return Number(data.qrcode_versao ?? 3);
}

export type CscCredencial = {
  /** CSC em claro. Só circula dentro do backend, na geração do QR Code. */
  csc: string;
  /** Identificador do CSC (`idCSC`/`cIdToken`), 1 a 6 dígitos no QR Code. */
  idCsc: string;
  qrCodeVersao: number;
};

/**
 * CSC do ambiente em uso, para assinar o QR Code da NFC-e.
 *
 * Nunca devolver isto para o frontend, nunca logar. Produção e homologação têm
 * CSCs distintos e trocá-los invalida o QR Code de todas as notas emitidas.
 */
export async function getCscCredencial(
  ambiente: "HOMOLOGACAO" | "PRODUCAO",
  empresaId?: number,
): Promise<CscCredencial> {
  let query = supabaseAdmin
    .from("nfe_config")
    .select("csc_homologacao, csc_id_homologacao, csc_producao, csc_id_producao, qrcode_versao")
    .eq("modelo", "NFCE");

  if (empresaId != null) query = query.eq("empresaid", empresaId);

  const { data, error } = await query.order("id", { ascending: true }).limit(1).maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("Configuração de NFC-e não encontrada para ler o CSC.");
  }

  const producao = ambiente === "PRODUCAO";
  const csc = String((producao ? data.csc_producao : data.csc_homologacao) ?? "").trim();
  const idCsc = String((producao ? data.csc_id_producao : data.csc_id_homologacao) ?? "").trim();

  if (!csc || !idCsc) {
    throw new Error(
      `CSC de ${producao ? "produção" : "homologação"} não configurado. Gere o CSC no portal da SEFAZ e cadastre em Configurações › Fiscal.`,
    );
  }

  return { csc, idCsc, qrCodeVersao: Number(data.qrcode_versao ?? 3) };
}

/**
 * Versão exibível do CSC: só os 4 últimos caracteres.
 *
 * O usuário precisa conferir que cadastrou o código certo sem que o segredo
 * trafegue de volta para a tela.
 */
export function mascararCsc(valor: string | null | undefined): string {
  const csc = String(valor ?? "").trim();
  if (!csc) return "";
  if (csc.length <= 4) return "*".repeat(csc.length);
  return `${"*".repeat(Math.min(csc.length - 4, 24))}${csc.slice(-4)}`;
}
