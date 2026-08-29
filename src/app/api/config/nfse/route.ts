// src/app/api/config/nfse/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { buscarEmpresaAtual } from "@/services/fiscal/empresaAtual";
import { identificarModeloEmissao } from "@/lib/services/fiscais/nfse-service";
import {
  prepararPatchGarantiaNfse,
  serializarConfigGarantiaNfse,
} from "@/lib/fiscal/configGarantia";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * Modelos que podem ter padrão gravado. Chave errada no jsonb é padrão que
 * nunca é lido: a emissão procura por `identificarModeloEmissao(empresa)` e
 * ignora o resto.
 */
const MODELOS = ["NACIONAL", "MUNICIPAL_CABEDELO", "MUNICIPAL_JOAO_PESSOA"] as const;

/**
 * Deixa o padrão pronto para a emissão usar sem retoque.
 *
 * A versão anterior gravava o texto cru do formulário. Um espaço sobrando no
 * CNAE ou um "1401" no lugar de "14.01" ficavam guardados assim e voltavam
 * assim para a tela de emissão — no banco da Demir o CNAE está gravado com um
 * branco no fim, e no da Demonstração o item da lista está sem o ponto. Campo
 * vazio é descartado em vez de virar string vazia, para não mascarar um padrão
 * que nunca foi preenchido como se fosse um preenchido em branco.
 */
function normalizarPadrao(entrada: unknown): Record<string, string> | null {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return null;

  const saida: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(entrada as Record<string, unknown>)) {
    if (valor == null) continue;
    const texto = String(valor).trim();
    if (!texto) continue;
    saida[campo] = campo === "codigoCnae" ? texto.replace(/\D/g, "") : texto;
  }
  return Object.keys(saida).length > 0 ? saida : null;
}

function normalizarPadroesEmissao(entrada: unknown): Record<string, unknown> {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return {};

  const bruto = entrada as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  for (const modelo of MODELOS) {
    const padrao = normalizarPadrao(bruto[modelo]);
    if (padrao) saida[modelo] = padrao;
  }
  return saida;
}

function serializar(row: Record<string, any> | null | undefined) {
  return {
    provedor: row?.provedor ?? "",
    ...serializarConfigGarantiaNfse(row),
    inscricaoMunicipal: row?.inscricao_municipal ?? "",
    serieRPS: row?.serie_rps ?? "",
    usuario: row?.usuario ?? "",
    senha: row?.senha ?? "",
    token: row?.token ?? "",
    certificadoA1Base64: row?.certificado_a1_base64 ?? "",
    senhaCertificado: row?.senha_certificado ?? "",
    padroesEmissao: row?.padroes_emissao ?? {},
  };
}

export async function GET() {
  try {
    // O id sai da empresa cadastrada, não de um `1` fixo: em banco cuja empresa
    // tem outro id o filtro fixo não achava linha nenhuma e a tela abria com os
    // padrões vazios, dando a impressão de que nada tinha sido salvo.
    const empresa = await buscarEmpresaAtual();
    const r = await supabase
      .from("nfse_config")
      .select("*")
      .eq("empresa_id", empresa?.id ?? 1)
      .maybeSingle();
    if (r.error) throw r.error;

    // Envelope `{ nfse }` para casar com o PUT e com o que a tela lê. Sem ele a
    // página, que procura `json.nfse`, nunca aplicava nada: a aba abria com o
    // padrão em branco e o primeiro "Salvar" mandava `padroesEmissao: {}` de
    // volta, apagando no banco o padrão que estava lá. Mesmo defeito que o GET
    // de `/api/config/nfe` já tinha tido.
    return NextResponse.json(
      {
        nfse: {
          ...serializar(r.data),
          // O modelo que a emissão vai procurar no jsonb. Vai junto para a tela
          // conferir se o padrão cadastrado é o que será realmente lido.
          modeloEmissao: identificarModeloEmissao(empresa),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    console.error("GET /api/config/nfse", e);
    return NextResponse.json({ error: "Falha ao carregar NFS-e" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const nfse = body?.nfse || {};

    const empresa = await buscarEmpresaAtual();
    const empresaId = empresa?.id ?? 1;
    const padroesEmissao = normalizarPadroesEmissao(nfse.padroesEmissao);
    const garantiaRecebida = prepararPatchGarantiaNfse(nfse);
    const atual = await supabase
      .from("nfse_config")
      .select("incluir_garantia_os")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (atual.error) throw atual.error;
    const incluirGarantiaOs = "incluir_garantia_os" in garantiaRecebida
      ? garantiaRecebida.incluir_garantia_os
      : Boolean(atual.data?.incluir_garantia_os);

    const up = await supabase
      .from("nfse_config")
      .upsert(
        {
          empresa_id: empresaId,
          provedor: nfse.provedor ?? null,
          incluir_garantia_os: incluirGarantiaOs,
          inscricao_municipal: nfse.inscricaoMunicipal ?? null,
          serie_rps: nfse.serieRPS ?? null,
          usuario: nfse.usuario ?? null,
          senha: nfse.senha ?? null,
          token: nfse.token ?? null,
          certificado_a1_base64: nfse.certificadoA1Base64 ?? null,
          senha_certificado: nfse.senhaCertificado ?? null,
          padroes_emissao: padroesEmissao,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id" },
      )
      .select("*")
      .maybeSingle();
    if (up.error) throw up.error;

    return NextResponse.json({
      ok: true,
      nfse: {
        ...serializar(up.data),
        modeloEmissao: identificarModeloEmissao(empresa),
      },
    });
  } catch (e: any) {
    console.error("PUT /api/config/nfse", e);
    return NextResponse.json({ error: "Falha ao salvar NFS-e" }, { status: 500 });
  }
}
