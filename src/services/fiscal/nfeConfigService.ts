import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MODELO_NFCE, MODELO_NFE, modeloParaDb, rotuloModelo } from "@/lib/nfe/modeloDocumento";
import {
  ORIGEM_PADRAO,
  ORIGEM_PADRAO_HERDADO,
  ORIGEM_PADRAO_SAIDA_VENDA,
  padraoDaOperacao,
  type OperacaoPadrao,
  type PadraoFiscalItem,
} from "@/lib/nfe/padraoFiscalItem";
import type { CRT, ModeloDocumentoFiscal, ModeloDocumentoFiscalDb } from "@/lib/nfe/types";

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
  /** Padrão fiscal dos itens, por tipo de operação. Ver `padraoFiscalItem.ts`. */
  padroes_emissao: unknown;
  incluir_garantia_venda: boolean;
  incluir_garantia_os: boolean;
};

const CAMPOS_PUBLICOS =
  "id, empresaid, modelo, serie, ultimo_numero, ambiente, qrcode_versao, padroes_emissao, incluir_garantia_venda, incluir_garantia_os";

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

export type ContextoPadraoFiscal = {
  /** Padrão do modelo e da operação pedidos; `null` quando nada foi cadastrado. */
  padrao: PadraoFiscalItem | null;
  /** Regime tributário do emitente: decide entre CSOSN e CST de ICMS. */
  crt: CRT | null;
  /**
   * Rótulo de procedência a usar para os valores do padrão. Vira
   * `ORIGEM_PADRAO_HERDADO` quando a NFC-e aproveitou o padrão da NF-e, e
   * `ORIGEM_PADRAO_SAIDA_VENDA` quando a saída sem venda aproveitou o da venda.
   */
  rotuloPadrao: string;
  /** Opções de preenchimento automático do texto livre deste modelo. */
  garantiaPorOrigem: { VENDA: boolean; OS: boolean };
};

/**
 * Padrão fiscal dos itens + CRT, para as rotas que montam o snapshot da nota.
 *
 * Não explode quando não há padrão cadastrado: o snapshot continua saindo com o
 * que o produto tiver, exatamente como antes desta camada existir. Só o CRT
 * precisa da empresa, e ele já é cobrado por `validarEmpresa` na emissão.
 *
 * Há dois degraus de herança, e os dois existem para o mesmo motivo: padrão em
 * branco não pode virar item sem tributação, que é rejeição certa na SEFAZ.
 *
 *   NFC-e sem padrão próprio      → padrão de saída de venda da NF-e
 *   saída sem venda em branco     → padrão de saída de venda do mesmo modelo
 *
 * No primeiro, o perfil tributário da mercadoria é mesmo o mesmo nos dois
 * modelos — quem escolhe CSOSN e CST de PIS/COFINS é o produto e o regime, não
 * o documento —, e cadastrar duas vezes só criaria a chance de divergirem. No
 * segundo a operação é de fato outra, e a herança é só a ponte até o padrão de
 * remessa/devolução ser cadastrado. Nos dois casos os valores vão marcados, e
 * preencher o padrão próprio em Configurações passa a mandar.
 */
export async function buscarContextoPadraoFiscal(
  modelo: ModeloDocumentoFiscal,
  operacao: OperacaoPadrao,
  empresaId?: number,
): Promise<ContextoPadraoFiscal> {
  const config = await buscarFiscalConfig(modelo, empresaId);

  let query = supabaseAdmin.from("empresa").select("id, regimetributario");
  const alvo = empresaId ?? config?.empresaid;
  if (alvo != null) query = query.eq("id", alvo);

  const { data: empresa, error } = await query
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const regime = Number(empresa?.regimetributario ?? 0);
  const crt = [1, 2, 3, 4].includes(regime) ? (regime as CRT) : null;

  const proprio = padraoDaOperacao(config?.padroes_emissao, operacao);
  const garantiaPorOrigem = {
    VENDA: Boolean(config?.incluir_garantia_venda),
    OS: Boolean(config?.incluir_garantia_os),
  };
  if (proprio) return { padrao: proprio, crt, rotuloPadrao: ORIGEM_PADRAO, garantiaPorOrigem };

  // Degrau 1: a saída sem venda cai para a de venda do próprio modelo. Ela é a
  // única que já tem padrão cadastrado nos bancos em uso, e sem esta ponte todo
  // mundo que atualizasse passaria a emitir devolução e remessa sem CSOSN nem
  // CST de PIS/COFINS até abrir Configurações.
  if (operacao === "SAIDA_NAO_VENDA") {
    const daVenda = padraoDaOperacao(config?.padroes_emissao, "SAIDA");
    if (daVenda) {
      return { padrao: daVenda, crt, rotuloPadrao: ORIGEM_PADRAO_SAIDA_VENDA, garantiaPorOrigem };
    }
  }

  // Degrau 2: a NFC-e cai para o padrão de saída de venda da NF-e.
  if (modelo !== MODELO_NFCE) {
    return { padrao: null, crt, rotuloPadrao: ORIGEM_PADRAO, garantiaPorOrigem };
  }

  const configNfe = await buscarFiscalConfig(MODELO_NFE, empresaId ?? config?.empresaid);
  const herdado = padraoDaOperacao(configNfe?.padroes_emissao, "SAIDA");
  return {
    padrao: herdado,
    crt,
    rotuloPadrao: herdado ? ORIGEM_PADRAO_HERDADO : ORIGEM_PADRAO,
    garantiaPorOrigem,
  };
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
