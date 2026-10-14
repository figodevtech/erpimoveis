import "server-only";

import { fetchLogoEmpresaDataUrl } from "@/lib/empresa-logo";
import { nomeOficialMunicipioIbge } from "@/lib/ibge/municipio";
import { loadPrintPaymentSummary } from "@/lib/print-payment-display-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { contextoDaOS, contextoDaVenda, contextoDoAluguel, type EmissaoDocumento } from "./contexto";
import type { ContextoDocumento, ModuloDocumento } from "./tipos";

const COLUNAS_CLIENTE =
  "id, nomerazaosocial, tipopessoa, cpfcnpj, inscricaoestadual, email, telefone, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep";

const SELECT_VENDA = `
  id, status, canal, datavenda, createdat,
  desconto_tipo, desconto_valor, valor_frete, acrescimo_financeiro_tipo, acrescimo_financeiro_valor,
  forma_pagamento, parcelas_pagamento, pagamentos_previstos,
  garantia, descricao, observacoes, nfe_chave_acesso,
  codigo_rastreio, transportadora_rastreio, endereco_entrega_snapshot,
  cliente:clienteid ( ${COLUNAS_CLIENTE} ),
  categoria_venda:categoriavendaid ( nome ),
  vendedor_rel:vendedor ( nome ),
  criador:created_by ( nome ),
  itens:vendaproduto (
    id, quantidade, sub_total, valor_total, tipo_desconto, valor_desconto, valor_frete,
    produto:produtoid ( id, titulo, descricao, unidade, etiqueta, codigobarras )
  )
`;

const SELECT_OS = `
  *,
  cliente:clienteid ( ${COLUNAS_CLIENTE} ),
  veiculo:veiculoid ( * ),
  peca:pecaid ( titulo, descricao, lacre ),
  setor:setorid ( nome ),
  criador:usuariocriadorid ( nome ),
  servicos:osservico ( *, servico:servicoid ( codigo, descricao ) ),
  produtos:osproduto ( *, produto:produtoid ( id, titulo, descricao, unidade, etiqueta ) ),
  produtosAvulsos:osproduto_avulso ( * ),
  itensHistoricos:ositem_historico ( * )
`;

const SELECT_ALUGUEL = `
  id, status, data_inicio, data_limite, pausado_em, encerrado_em, observacao, valor_total,
  cliente_nome, cliente_documento, cliente_telefone, cliente_email,
  cliente:cliente_id ( ${COLUNAS_CLIENTE} ),
  destinatario:usuario_id ( nome, email ),
  criador:created_by ( nome ),
  itens:aluguel_item ( id, tipo, descricao, identificacao, quantidade, quantidade_devolvida, valor, devolvido_em )
`;

/** Mesmo cadastro que o cabeçalho das demais folhas lê. */
async function lerEmpresa() {
  const { data, error } = await supabaseAdmin
    .from("empresa")
    .select("razaosocial, nomefantasia, cnpj, inscricaoestadual, inscricaomunicipal, telefone, endereco, numero, complemento, bairro, uf, cep, codigomunicipio")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  // Sem empresa o documento ainda sai; o erro fica no log.
  if (error) console.error("Erro ao buscar a empresa para o documento:", error);
  if (!data) return null;
  return { ...data, cidade: await cidadeDaEmpresa(data.codigomunicipio) };
}

/**
 * O cadastro da empresa guarda só o código IBGE do município; o nome vem do
 * IBGE. Fora do ar, o documento sai sem a cidade, e o erro fica no log.
 */
async function cidadeDaEmpresa(codigo: unknown): Promise<string | null> {
  if (!String(codigo ?? "").trim()) return null;
  try {
    return await nomeOficialMunicipioIbge(String(codigo));
  } catch (erro) {
    console.error("Erro ao buscar a cidade da empresa para o documento:", erro);
    return null;
  }
}

function lista<T>(valor: unknown): T[] | null {
  return Array.isArray(valor) ? (valor as T[]) : null;
}

/**
 * Contexto do registro, lido do banco — o documento sai com o que está salvo,
 * de qualquer tela que o abra. `null` quando o registro não existe.
 */
export async function montarContexto(
  modulo: ModuloDocumento,
  registroId: number,
  emissao: Omit<EmissaoDocumento, "logoUrl">,
): Promise<ContextoDocumento | null> {
  const [empresa, logoUrl] = await Promise.all([lerEmpresa(), fetchLogoEmpresaDataUrl()]);
  const comLogo: EmissaoDocumento = { ...emissao, logoUrl };

  if (modulo === "venda") {
    const { data: venda, error } = await supabaseAdmin.from("venda").select(SELECT_VENDA).eq("id", registroId).maybeSingle();
    if (error) throw error;
    if (!venda) return null;
    const v = venda as Record<string, any>;
    const pagamentos = await loadPrintPaymentSummary({
      type: "VENDA",
      documentId: registroId,
      status: v.status,
      pagamentosPrevistos: lista(v.pagamentos_previstos),
      formaPagamento: v.forma_pagamento ?? null,
      parcelasPagamento: v.parcelas_pagamento ?? null,
    });
    return contextoDaVenda({ venda: v, empresa, pagamentos, emissao: comLogo });
  }

  if (modulo === "os") {
    const [{ data: os, error }, { data: realizadores, error: erroRealizadores }] = await Promise.all([
      supabaseAdmin.from("ordemservico").select(SELECT_OS).eq("id", registroId).maybeSingle(),
      supabaseAdmin.from("osservico_realizador").select("servicoid, usuario:usuarioid ( nome )").eq("ordemservicoid", registroId),
    ]);
    if (error) throw error;
    if (erroRealizadores) throw erroRealizadores;
    if (!os) return null;
    const o = os as Record<string, any>;
    // Pagamento previsto ou registrado, como na folha da OS. Custo e
    // rentabilidade não entram no documento.
    const pagamentos = await loadPrintPaymentSummary({
      type: "OS",
      documentId: registroId,
      status: o.status,
      pagamentosPrevistos: lista(o.pagamentos_previstos),
      formaPagamento: o.forma_pagamento ?? null,
      parcelasPagamento: o.parcelas_pagamento ?? null,
    });
    return contextoDaOS({ os: o, realizadores: realizadores ?? [], empresa, pagamentos, emissao: comLogo });
  }

  const { data: aluguel, error } = await supabaseAdmin
    .from("aluguel")
    .select(SELECT_ALUGUEL)
    .eq("id", registroId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  if (!aluguel) return null;
  return contextoDoAluguel({ aluguel: aluguel as Record<string, any>, empresa, emissao: comLogo });
}
