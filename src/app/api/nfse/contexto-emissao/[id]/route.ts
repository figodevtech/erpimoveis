import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { listarPendenciasNFSe } from "@/lib/services/fiscais/nfse-service";
import { comporObservacoesComGarantia } from "@/lib/fiscal/garantiaObservacoes";
import {
  contextoEmissaoOuErro,
  dataDoDiaNFSe,
  itensListaDosServicos,
} from "@/lib/services/fiscais/nfse-politica";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * Modelo de emissão e padrão fiscal dos serviços SELECIONADOS, para a etapa de
 * revisão da NFS-e.
 *
 * A listagem da OS decide o modelo pela OS inteira, só para o cabeçalho. Quem
 * pré-preenche o formulário é esta rota, chamada no "Revisar nota" com a
 * seleção real — a mesma que a emissão vai receber e resolver de novo pela
 * mesma função (`contextoEmissaoOuErro`). Assim a tela nunca carrega o padrão
 * de um modelo e a emissão sai por outro.
 *
 * Nas OS agregadas entram todos os serviços, como na emissão agrupada.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const osId = Number(id);
    if (!Number.isInteger(osId) || osId <= 0) {
      return NextResponse.json({ ok: false, message: "ID da OS inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const selecionados = [...new Set((Array.isArray(body?.servicos) ? body!.servicos : []).map(Number))]
      .filter((valor) => Number.isInteger(valor) && valor > 0);
    if (selecionados.length === 0) {
      return NextResponse.json({ ok: false, message: "Selecione ao menos um serviço para emitir a NFS-e." }, { status: 400 });
    }
    const osIdsAdicionais = [...new Set((Array.isArray(body?.osIdsAdicionais) ? body!.osIdsAdicionais : []).map(Number))]
      .filter((valor) => Number.isInteger(valor) && valor > 0 && valor !== osId);

    const { data: os, error: osError } = await supabaseAdmin
      .from("ordemservico")
      .select("*, cliente (*), osservico (*, servico (*))")
      .eq("id", osId)
      .single();
    if (osError || !os) {
      return NextResponse.json({ ok: false, message: "OS não encontrada." }, { status: 404 });
    }

    const daAncora = (Array.isArray(os.osservico) ? os.osservico : []) as any[];
    const itens: any[] = [];
    for (const servicoId of selecionados) {
      const item = daAncora.find((linha) => Number(linha.servicoid) === servicoId);
      if (!item) {
        return NextResponse.json({ ok: false, message: `O serviço ${servicoId} não pertence a esta OS.` }, { status: 400 });
      }
      itens.push(item);
    }

    if (osIdsAdicionais.length > 0) {
      const { data: outras, error: outrasError } = await supabaseAdmin
        .from("ordemservico")
        .select("id, osservico (*, servico (*))")
        .in("id", osIdsAdicionais);
      if (outrasError) throw outrasError;
      for (const outra of outras ?? []) {
        itens.push(...((Array.isArray(outra.osservico) ? outra.osservico : []) as any[]));
      }
    }

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa")
      .select("*")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (empresaError) throw empresaError;
    if (!empresa) {
      return NextResponse.json({ ok: false, message: "A aplicação não possui uma empresa configurada." }, { status: 400 });
    }

    const { data: nfseConfig, error: configError } = await supabaseAdmin
      .from("nfse_config")
      .select("padroes_emissao, incluir_garantia_os")
      .eq("empresa_id", empresa.id)
      .maybeSingle();
    if (configError) throw configError;

    const resolvido = contextoEmissaoOuErro({
      empresa,
      itensListaServico: itensListaDosServicos(itens),
      dataCompetencia: dataDoDiaNFSe(new Date(), empresa.timezone_iana),
      padroesEmissao: nfseConfig?.padroes_emissao,
    });
    if (!resolvido.ok) {
      return NextResponse.json({ ok: false, message: resolvido.message }, { status: 400 });
    }

    const { politica, modeloEmissao, padraoFiscal, padraoAusente } = resolvido.contexto;
    return NextResponse.json({
      ok: true,
      modeloEmissao,
      politicaEmissao: {
        exigeRtc: politica.exigeRtc,
        motivo: politica.motivo,
        regimeTributario: String(empresa.regimetributario ?? ""),
      },
      padraoFiscal,
      padraoAusente,
      // Texto livre composto com o padrão do modelo FINAL — o da listagem usava
      // o do modelo da OS inteira. Mesma regra: a observação da OS vence o
      // padrão, e a garantia vai por cima quando configurada.
      observacoesFiscais: comporObservacoesComGarantia({
        observacoes:
          String(os.observacoes_fiscais ?? "").trim()
          || String(padraoFiscal?.informacoesComplementares ?? "").trim(),
        garantia: os.garantia,
        incluir: Boolean(nfseConfig?.incluir_garantia_os),
      }) || null,
      // A exigência de inscrição municipal muda com o modelo: as pendências
      // da listagem foram calculadas com o modelo da OS inteira.
      pendenciasCadastro: listarPendenciasNFSe(os, empresa, itens, modeloEmissao),
    });
  } catch (error: unknown) {
    console.error("[POST /api/nfse/contexto-emissao]", error);
    return NextResponse.json({ ok: false, message: "Erro ao preparar a revisão da NFS-e." }, { status: 500 });
  }
}
