import "server-only";

import { fetchPrimeiroLogoEmpresa } from "@/lib/empresa-logo";
import { nomeOficialMunicipioIbge } from "@/lib/ibge/municipio";
import { loadPrintPaymentSummary } from "@/lib/print-payment-display-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { contextoDaVenda, type EmissaoDocumento } from "./contexto";
import type { ContextoDocumento, ModuloDocumento } from "./tipos";

const COLUNAS_CLIENTE =
  "id, nomerazaosocial, tipopessoa, cpfcnpj, inscricaoestadual, email, telefone, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep, codigo_sistema";

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
  // A logo vai pela URL pública, não embutida: o frame da folha a carrega
  // e a paginação espera a imagem. Embutida, uma logo de 1,3 MB virava 1,75 MB
  // de texto em cada documento aberto — e derrubava a página no `next dev`.
  const [empresa, logoUrl] = await Promise.all([lerEmpresa(), fetchPrimeiroLogoEmpresa()]);
  const comLogo: EmissaoDocumento = { ...emissao, logoUrl };

  if (modulo !== "venda") return null; // único módulo com documentos por enquanto
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
