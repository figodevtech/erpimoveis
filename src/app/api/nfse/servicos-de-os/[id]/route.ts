import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  identificarModeloEmissao,
  listarPendenciasNFSe,
  type NFSeModeloEmissao,
} from "@/lib/services/fiscais/nfse-service";
import type { CodigosFiscaisForm } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const osId = Number(id);

    if (!Number.isFinite(osId) || osId <= 0) {
      return NextResponse.json(
        { ok: false, message: "ID da OS inválido." },
        { status: 400 }
      );
    }

    // Busca serviços da OS
    const { data: os, error } = await supabaseAdmin
      .from("ordemservico")
      .select(`
        id,
        cliente (*),
        osservico (
          *,
          servico (*)
        )
      `)
      .eq("id", osId)
      .single();

    if (error || !os) {
      console.error("[GET /api/nfse/servicos-de-os] Erro Supabase:", error);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar serviços da OS.", error: error?.message },
        { status: 404 }
      );
    }

    // Busca Notas Fiscais de Serviço vinculadas a esta OS para verificar o status
    const { data: notas } = await supabaseAdmin
      .from("nfse")
      .select("id, referencia, status, erros, modelo_emissao, servico_ids, itens")
      .eq("ordemservicoid", osId)
      .order("id", { ascending: false });

    const { data: empresa } = await supabaseAdmin
      .from("empresa")
      .select("id, cnpj, inscricaomunicipal, codigomunicipio, regimetributario")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    const codigoMunicipio = String(empresa?.codigomunicipio ?? "").replace(/\D/g, "");
    const modeloEmissao: NFSeModeloEmissao | null = identificarModeloEmissao(empresa);

    // Mesma empresa que resolveu o modelo acima. Fixar `1` aqui fazia o padrão
    // sumir em banco cuja empresa tem outro id, e a emissão abria sem código
    // nenhum preenchido.
    const { data: nfseConfig } = await supabaseAdmin
      .from("nfse_config")
      .select("padroes_emissao")
      .eq("empresa_id", empresa?.id ?? 1)
      .maybeSingle();

    const padroesEmissao = (nfseConfig?.padroes_emissao ?? {}) as Partial<
      Record<NFSeModeloEmissao, Partial<CodigosFiscaisForm>>
    >;
    const padraoFiscal = modeloEmissao ? padroesEmissao[modeloEmissao] ?? null : null;

    // Mescla os dados
    const servicosMapeados = os.osservico.map((item: any) => {
      const notaGerada = notas?.find((nota: any) => (
        Array.isArray(nota.servico_ids)
        && nota.servico_ids.map(Number).includes(Number(item.servicoid))
      ));
      const itemEmitido = Array.isArray(notaGerada?.itens)
        ? notaGerada.itens.find((snapshot: any) => Number(snapshot?.servicoid) === Number(item.servicoid))
        : null;

      return {
        ...item,
        pendenciasCadastro: modeloEmissao
          ? listarPendenciasNFSe(os, empresa, item, modeloEmissao)
          : [{ origem: "EMPRESA" as const, mensagem: "município da empresa sem modelo de NFS-e configurado" }],
        notaFiscalStatus: notaGerada ? notaGerada.status : null,
        notaFiscalId: notaGerada ? notaGerada.id : null,
        notaFiscalErros: notaGerada ? notaGerada.erros : null,
        notaFiscalModelo: notaGerada ? notaGerada.modelo_emissao : null,
        notaFiscalReferencia: notaGerada ? notaGerada.referencia : null,
        notaFiscalValor: itemEmitido ? Number(itemEmitido.valor) : null,
      };
    });

    // O dialog de emissão mostra e edita o cadastro do tomador sem sair da tela.
    // Só os campos que entram na nota — o resto do cadastro fica com o dialog do
    // cliente, que busca por conta própria.
    const clienteOS = os.cliente as any;

    return NextResponse.json({
      ok: true,
      servicos: servicosMapeados,
      modeloEmissao,
      codigoMunicipio,
      padraoFiscal,
      cliente: clienteOS
        ? {
            id: Number(clienteOS.id),
            nomerazaosocial: clienteOS.nomerazaosocial ?? null,
            tipopessoa: clienteOS.tipopessoa ?? null,
            cpfcnpj: clienteOS.cpfcnpj ?? null,
            email: clienteOS.email ?? null,
            telefone: clienteOS.telefone ?? null,
            endereco: clienteOS.endereco ?? null,
            endereconumero: clienteOS.endereconumero ?? null,
            enderecocomplemento: clienteOS.enderecocomplemento ?? null,
            bairro: clienteOS.bairro ?? null,
            cidade: clienteOS.cidade ?? null,
            estado: clienteOS.estado ?? null,
            cep: clienteOS.cep ?? null,
            codigomunicipio: clienteOS.codigomunicipio ?? null,
            inscricaomunicipal: clienteOS.inscricaomunicipal ?? null,
          }
        : null,
    });
  } catch (e: any) {
    console.error("[GET /api/nfse/servicos-de-os]", e);
    return NextResponse.json({ ok: false, message: "Erro inesperado." }, { status: 500 });
  }
}
