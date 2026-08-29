import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  identificarModeloEmissao,
  listarPendenciasNFSe,
  type NFSeModeloEmissao,
} from "@/lib/services/fiscais/nfse-service";
import type { CodigosFiscaisForm } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types";
import { CAMPOS_ALVO_OS, carregarAlvoDaOs } from "@/services/fiscal/alvoDaOs";
import { distribuirDinheiro, particionarDescontoDaOs } from "@/lib/nfe/descontoOrigem";
import { inferirDescontoGeralOs } from "@/lib/ordens/totais";
import { comporObservacoesComGarantia } from "@/lib/fiscal/garantiaObservacoes";

export const runtime = "nodejs";

function toNumber(value: unknown) {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : 0;
}

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
        observacoes_fiscais,
        garantia,
        subtotal,
        orcamentototal,
        valor_frete,
        ${CAMPOS_ALVO_OS},
        cliente (*),
        osproduto (quantidade, precounitario, subtotal),
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
      .select("padroes_emissao, incluir_garantia_os")
      .eq("empresa_id", empresa?.id ?? 1)
      .maybeSingle();

    const padroesEmissao = (nfseConfig?.padroes_emissao ?? {}) as Partial<
      Record<NFSeModeloEmissao, Partial<CodigosFiscaisForm>>
    >;
    const padraoFiscal = modeloEmissao ? padroesEmissao[modeloEmissao] ?? null : null;

    // O desconto geral da OS é rateado entre peças e mão de obra: a NF-e leva a
    // fatia dos produtos, esta NFS-e leva a dos serviços. Mesma partição e mesmos
    // pesos da rota `produtos-para-nfe`, para os dois diálogos mostrarem o mesmo
    // número. Aqui é só informativo: o valor enviado continua sendo o digitado.
    const itensServico = (Array.isArray(os.osservico) ? os.osservico : []) as any[];
    const brutoPorServico = itensServico.map(
      (item) => toNumber(item.quantidade) * toNumber(item.precounitario),
    );
    const liquidoPorServico = itensServico.map((item, index) => {
      const liquido = toNumber(item.subtotal);
      return liquido > 0 ? Math.min(liquido, brutoPorServico[index]) : brutoPorServico[index];
    });
    const itensProduto = (Array.isArray(os.osproduto) ? os.osproduto : []) as any[];
    const liquidoPorProduto = itensProduto.map((item) => {
      const bruto = toNumber(item.quantidade) * toNumber(item.precounitario);
      const liquido = toNumber(item.subtotal);
      return liquido > 0 ? Math.min(liquido, bruto) : bruto;
    });
    // Peso do serviço é o subtotal gravado, cru — o mesmo que a rota de produtos
    // usa do outro lado da conta.
    const pesosDosServicos = itensServico.map((item) => toNumber(item.subtotal));
    const descontoGeral = inferirDescontoGeralOs({
      subtotal: os.subtotal,
      orcamentoTotal: os.orcamentototal,
      valorFrete: os.valor_frete,
    });
    const particao = particionarDescontoDaOs(descontoGeral, liquidoPorProduto, pesosDosServicos);
    // Fecha exatamente com `particao.servicos`: a sobra de centavos vai no último.
    const rateioPorServico = distribuirDinheiro(particao.servicos, pesosDosServicos);

    // Mescla os dados
    const servicosMapeados = itensServico.map((item: any, index: number) => {
      const notaGerada = notas?.find((nota: any) => (
        Array.isArray(nota.servico_ids)
        && nota.servico_ids.map(Number).includes(Number(item.servicoid))
      ));
      const itemEmitido = Array.isArray(notaGerada?.itens)
        ? notaGerada.itens.find((snapshot: any) => Number(snapshot?.servicoid) === Number(item.servicoid))
        : null;

      const descontoItem = Number(
        Math.max(0, brutoPorServico[index] - liquidoPorServico[index]).toFixed(2),
      );
      const descontoRateado = rateioPorServico[index] ?? 0;

      return {
        ...item,
        descontoItem,
        descontoRateado,
        valorLiquidoSugerido: Number(
          Math.max(0, liquidoPorServico[index] - descontoRateado).toFixed(2),
        ),
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
      // A observação da OS continua vencendo o padrão do modelo, como antes.
      // A garantia é acrescentada sobre o texto que efetivamente abriria no
      // campo, sem fazer o padrão municipal/nacional desaparecer.
      observacoesFiscais: comporObservacoesComGarantia({
        observacoes:
          String(os.observacoes_fiscais ?? "").trim()
          || padraoFiscal?.informacoesComplementares,
        garantia: os.garantia,
        incluir: Boolean(nfseConfig?.incluir_garantia_os),
      }) || null,
      // Alvo do reparo, para o botão que injeta os dados dele no texto livre.
      alvo: await carregarAlvoDaOs(os),
      // Null quando a OS não tem desconto geral: a tela não ganha painel nenhum.
      descontoOrigem: particao.total > 0 ? particao : null,
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
