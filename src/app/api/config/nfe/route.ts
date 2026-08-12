// src/app/api/config/nfe/route.ts
//
// Configuração fiscal por modelo: série e natureza de operação da NF-e (55) e
// da NFC-e (65), mais o CSC da NFC-e.
//
// A versão anterior desta rota gravava em colunas que não existem em
// `nfe_config` (`empresa_id`, `serie_nfe`, `serie_nfce`, `id_csc`,
// `natureza_operacao`), com o erro engolido por um `try/catch` que só fazia
// `console.log` — a série da NFC-e digitada na tela era descartada em silêncio.
// Agora escreve na linha certa de cada modelo.
//
// O CSC é segredo: sai daqui sempre mascarado e só é regravado quando o usuário
// digita um valor novo (um valor com "*" é o mascarado voltando, e é ignorado).
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { buscarEmpresaAtual } from "@/services/fiscal/empresaAtual";
import { mascararCsc } from "@/services/fiscal/nfeConfigService";
import {
  descreverIssues,
  prepararPadroesFiscais,
} from "@/services/fiscal/padraoFiscalConfigService";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type ConfigRow = {
  id: number;
  modelo: "NFE" | "NFCE";
  serie: number | null;
  natureza_operacao: string | null;
  csc_homologacao: string | null;
  csc_id_homologacao: string | null;
  csc_producao: string | null;
  csc_id_producao: string | null;
  qrcode_versao: number | null;
  padroes_emissao: unknown;
};

const CAMPOS =
  "id, modelo, serie, natureza_operacao, csc_homologacao, csc_id_homologacao, csc_producao, csc_id_producao, qrcode_versao, padroes_emissao";

function padroesDoModelo(config: ConfigRow | null) {
  const valor = config?.padroes_emissao;
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function crtDaEmpresa(empresa: Awaited<ReturnType<typeof buscarEmpresaAtual>>): number | null {
  const regime = Number(empresa?.regimetributario ?? 0);
  return [1, 2, 3, 4].includes(regime) ? regime : null;
}

/**
 * As linhas de configuração da empresa emitente.
 *
 * O filtro sai de `buscarEmpresaAtual`, não de um `1` fixo: em banco cuja
 * empresa tem outro id, o filtro fixo devolvia zero linhas e a tela mostrava os
 * padrões vazios enquanto a emissão usava a linha real.
 */
async function carregarConfigs(empresaId: number | null) {
  let query = supabase.from("nfe_config").select(CAMPOS);
  if (empresaId != null) query = query.eq("empresaid", empresaId);

  const { data, error } = await query.order("id", { ascending: true });

  if (error) throw error;

  const linhas = (data ?? []) as ConfigRow[];
  return {
    nfe: linhas.find((linha) => linha.modelo === "NFE") ?? null,
    nfce: linhas.find((linha) => linha.modelo === "NFCE") ?? null,
  };
}

function serializar(configs: Awaited<ReturnType<typeof carregarConfigs>>) {
  return {
    serieNFe: configs.nfe?.serie != null ? String(configs.nfe.serie) : "",
    serieNFCe: configs.nfce?.serie != null ? String(configs.nfce.serie) : "",
    naturezaOperacao: configs.nfe?.natureza_operacao ?? "",
    naturezaOperacaoNFCe: configs.nfce?.natureza_operacao ?? "",
    idCscHomologacao: configs.nfce?.csc_id_homologacao ?? "",
    idCscProducao: configs.nfce?.csc_id_producao ?? "",
    // Mascarados: o segredo nunca volta inteiro para a tela.
    cscHomologacao: mascararCsc(configs.nfce?.csc_homologacao),
    cscProducao: mascararCsc(configs.nfce?.csc_producao),
    qrCodeVersao: String(configs.nfce?.qrcode_versao ?? 3),
    nfceConfigurada: Boolean(configs.nfce),
    // Perfil tributário padrão dos itens, por modelo e por operação. É o que
    // preenche CSOSN, origem e CST de PIS/COFINS na emissão, para o operador
    // não redigitar o mesmo perfil em cada item de cada nota.
    padroesFiscais: {
      NFE: padroesDoModelo(configs.nfe),
      NFCE: padroesDoModelo(configs.nfce),
    },
  };
}

/** Série é inteiro positivo; texto vazio ou lixo mantém o que já está gravado. */
function parseSerie(valor: unknown): number | undefined {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (!digitos) return undefined;
  const numero = Number(digitos);
  return Number.isInteger(numero) && numero >= 0 && numero <= 999 ? numero : undefined;
}

/**
 * Valor de segredo que veio da tela.
 *
 * `undefined` = não mexer. Só aceita o que o usuário realmente digitou: string
 * vazia limpa o campo, e qualquer coisa com "*" é o mascarado do GET voltando.
 */
function parseSegredo(valor: unknown): string | null | undefined {
  if (valor === undefined || valor === null) return undefined;
  const texto = String(valor).trim();
  if (!texto) return null;
  if (texto.includes("*")) return undefined;
  return texto;
}

function parseTexto(valor: unknown): string | null | undefined {
  if (valor === undefined || valor === null) return undefined;
  const texto = String(valor).trim();
  return texto || null;
}

export async function GET() {
  try {
    const empresa = await buscarEmpresaAtual();
    const configs = await carregarConfigs(empresa?.id ?? null);
    // Envelope `{ nfe }` para casar com o PUT e com o que a tela lê. Antes o GET
    // devolvia o objeto solto e a página, que procura `json.nfe`, nunca aplicava
    // nada — os campos ficavam nos defaults do formulário.
    return NextResponse.json(
      { nfe: serializar(configs) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: unknown) {
    console.error("GET /api/config/nfe", e);
    return NextResponse.json({ error: "Falha ao carregar a configuração fiscal." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const nfe = body?.nfe ?? {};

    const empresa = await buscarEmpresaAtual();
    const configs = await carregarConfigs(empresa?.id ?? null);
    if (!configs.nfe) {
      return NextResponse.json(
        { error: "Configuração de NF-e não encontrada para a empresa." },
        { status: 404 },
      );
    }

    // ---- padrão fiscal dos itens ------------------------------------------
    // Validado antes de qualquer gravação: padrão inválido não estraga uma
    // nota, estraga todas as emitidas depois, e a rejeição aparece longe daqui.
    const crt = crtDaEmpresa(empresa);
    const padroesRecebidos = (nfe.padroesFiscais ?? {}) as Record<string, unknown>;
    const padroesNFe =
      "NFE" in padroesRecebidos
        ? await prepararPadroesFiscais(padroesRecebidos.NFE, crt)
        : null;
    const padroesNFCe =
      "NFCE" in padroesRecebidos
        ? await prepararPadroesFiscais(padroesRecebidos.NFCE, crt)
        : null;

    const problemas = [
      ...(padroesNFe?.issues ?? []).map((issue) => ({ ...issue, modelo: "NF-e" })),
      ...(padroesNFCe?.issues ?? []).map((issue) => ({ ...issue, modelo: "NFC-e" })),
    ];
    if (problemas.length > 0) {
      return NextResponse.json(
        {
          error: "Corrija o padrão fiscal antes de salvar.",
          detalhe: problemas
            .map((issue) => `${issue.modelo}: ${descreverIssues([issue])}`)
            .join(" "),
        },
        { status: 422 },
      );
    }

    // ---- modelo 55 -------------------------------------------------------
    const serieNFe = parseSerie(nfe.serieNFe);
    const naturezaNFe = parseTexto(nfe.naturezaOperacao);
    const patchNFe = {
      ...(serieNFe !== undefined ? { serie: serieNFe } : {}),
      ...(naturezaNFe !== undefined ? { natureza_operacao: naturezaNFe } : {}),
      ...(padroesNFe ? { padroes_emissao: padroesNFe.padroes } : {}),
    };

    if (Object.keys(patchNFe).length > 0) {
      const { error } = await supabase
        .from("nfe_config")
        .update({ ...patchNFe, updatedat: new Date().toISOString() })
        .eq("id", configs.nfe.id);
      if (error) throw error;
    }

    // ---- modelo 65 -------------------------------------------------------
    if (configs.nfce) {
      const serieNFCe = parseSerie(nfe.serieNFCe);
      const naturezaNFCe = parseTexto(nfe.naturezaOperacaoNFCe);
      const cscHomologacao = parseSegredo(nfe.cscHomologacao);
      const cscProducao = parseSegredo(nfe.cscProducao);
      const idCscHomologacao = parseTexto(nfe.idCscHomologacao);
      const idCscProducao = parseTexto(nfe.idCscProducao);
      // Só 2 e 3 existem; qualquer outro valor é ignorado e mantém o gravado.
      const qrCodeVersao = ["2", "3"].includes(String(nfe.qrCodeVersao))
        ? Number(nfe.qrCodeVersao)
        : undefined;

      const patchNFCe = {
        ...(serieNFCe !== undefined ? { serie: serieNFCe } : {}),
        ...(naturezaNFCe !== undefined ? { natureza_operacao: naturezaNFCe } : {}),
        ...(qrCodeVersao !== undefined ? { qrcode_versao: qrCodeVersao } : {}),
        ...(cscHomologacao !== undefined ? { csc_homologacao: cscHomologacao } : {}),
        ...(cscProducao !== undefined ? { csc_producao: cscProducao } : {}),
        ...(idCscHomologacao !== undefined ? { csc_id_homologacao: idCscHomologacao } : {}),
        ...(idCscProducao !== undefined ? { csc_id_producao: idCscProducao } : {}),
        ...(padroesNFCe ? { padroes_emissao: padroesNFCe.padroes } : {}),
      };

      if (Object.keys(patchNFCe).length > 0) {
        const { error } = await supabase
          .from("nfe_config")
          .update({ ...patchNFCe, updatedat: new Date().toISOString() })
          .eq("id", configs.nfce.id);
        if (error) throw error;
      }
    }

    return NextResponse.json({
      ok: true,
      nfe: serializar(await carregarConfigs(empresa?.id ?? null)),
    });
  } catch (e: unknown) {
    console.error("PUT /api/config/nfe", e);
    return NextResponse.json({ error: "Falha ao salvar a configuração fiscal." }, { status: 500 });
  }
}
