import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

// Colunas nomeadas de propósito: payload_enviado e retorno_bruto existem para
// diagnóstico no banco e não têm uso nesta tela, então não viajam até o
// navegador a cada abertura do diálogo.
const COLUNAS =
  "id, ordemservicoid, clienteid, empresaid, numero, referencia, status, protocolo, valor_total, erros, dataemissao, createdat, updatedat, url_pdf, url_consulta, modelo_emissao";

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const osId = Number(id);

    if (!Number.isFinite(osId) || osId <= 0) {
      return NextResponse.json({ ok: false, message: "ID da OS inválido." }, { status: 400 });
    }

    /*
     * Duas consultas, como em `/api/nfe/por-origem`: a coluna escalar (que
     * cobre as notas anteriores à junção) e o vínculo, que é o único lugar
     * onde a OS agregada aparece. Sem a segunda, uma NFS-e agrupada sumiria
     * da lista de todas as OS menos a âncora.
     */
    const [{ data: diretas, error: diretasError }, { data: vinculos, error: vinculosError }] =
      await Promise.all([
        supabaseAdmin.from("nfse").select(COLUNAS).eq("ordemservicoid", osId),
        supabaseAdmin
          .from("nfse_os_servico_vinculo")
          .select("nfse_id")
          .eq("ordemservico_id", osId),
      ]);

    if (diretasError) {
      console.error("[GET /api/nfse/por-os]", diretasError);
      return NextResponse.json({ ok: false, message: "Erro ao buscar NFS-e." }, { status: 500 });
    }
    if (vinculosError) {
      console.error("[GET /api/nfse/por-os] vínculos", vinculosError);
      return NextResponse.json({ ok: false, message: "Erro ao buscar NFS-e." }, { status: 500 });
    }

    const idsVinculadas = [
      ...new Set((vinculos ?? []).map((linha: any) => Number(linha.nfse_id))),
    ];

    const { data: vinculadas, error: vinculadasError } = idsVinculadas.length
      ? await supabaseAdmin.from("nfse").select(COLUNAS).in("id", idsVinculadas)
      : { data: [] as any[], error: null };

    if (vinculadasError) {
      console.error("[GET /api/nfse/por-os] vinculadas", vinculadasError);
      return NextResponse.json({ ok: false, message: "Erro ao buscar NFS-e." }, { status: 500 });
    }

    // A âncora volta nas duas consultas; o Map por id resolve a duplicata.
    const porId = new Map<number, any>();
    for (const nota of [...(diretas ?? []), ...(vinculadas ?? [])] as any[]) {
      porId.set(Number(nota.id), nota);
    }

    // As origens de cada nota, para o badge — inclusive as que estão fora
    // desta OS.
    const notas = [...porId.values()];
    const origensPorNota = new Map<number, Array<{ tipo: "OS"; id: number; ancora: boolean }>>();

    if (notas.length > 0) {
      const { data: todasOrigens, error: origensError } = await supabaseAdmin
        .from("nfse_os_servico_vinculo")
        .select("nfse_id, ordemservico_id, ancora")
        .in("nfse_id", notas.map((nota) => Number(nota.id)));

      if (origensError) throw origensError;

      for (const linha of todasOrigens ?? []) {
        const nfseId = Number(linha.nfse_id);
        const atuais = origensPorNota.get(nfseId) ?? [];
        // O vínculo é por linha de serviço, então a mesma OS aparece várias
        // vezes; o badge quer a OS, não o serviço.
        if (!atuais.some((origem) => origem.id === Number(linha.ordemservico_id))) {
          atuais.push({
            tipo: "OS",
            id: Number(linha.ordemservico_id),
            ancora: Boolean(linha.ancora),
          });
          origensPorNota.set(nfseId, atuais);
        }
      }
    }

    // O merge quebra o `order` do Postgres, então a ordenação final é aqui.
    const nfses = notas
      .map((nota) => {
        const origens = origensPorNota.get(Number(nota.id)) ?? [];
        const escalar = Number(nota.ordemservicoid);
        if (Number.isInteger(escalar) && escalar > 0 && !origens.some((o) => o.id === escalar)) {
          origens.push({ tipo: "OS", id: escalar, ancora: true });
        }
        return { ...nota, origens };
      })
      .sort(
        (a, b) => new Date(b.createdat ?? 0).getTime() - new Date(a.createdat ?? 0).getTime(),
      );

    return NextResponse.json(
      { ok: true, osId, nfses },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    console.error("[GET /api/nfse/por-os] exception", e);
    return NextResponse.json(
      { ok: false, message: "Erro inesperado ao buscar NFS-e." },
      { status: 500 },
    );
  }
}
