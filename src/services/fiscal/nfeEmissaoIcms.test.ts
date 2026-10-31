// Integração: os cinco fluxos de emissão (venda, OS, entrada, saída de estoque
// e avulsa) passam pelo mesmo núcleo de ICMS e gravam em `nfe_item` exatamente
// o que foi para o XML e para o <ICMSTot>.
//
// O caso principal é a NF-e 136 do Demir: CRT 3, CST 60, alíquota de 20% no
// cadastro do produto, R$ 11.000, PB → MG, CFOP 6403. O banco gravou ICMS
// próprio de R$ 2.200 e o XML autorizado saiu com vBC/vICMS zerados.

import "./__testEnv";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { BancoFalso, instalarIbgeFalso } from "./__bancoFalso";
import {
  buscarNFeAvulsaDraft,
  salvarNFeAvulsaDraft,
  type NFeAvulsaDraftInput,
  type NFeAvulsaItemInput,
  type OpcoesSalvarNFe,
} from "./nfeAvulsaService";
import type { ResultadoRegistroCiencia } from "./cienciaAvisoFiscal";
import { salvarNFeDeOrigem, statusOcupaOrigem, type NFeOrigemDraftInput } from "./nfeOrigemService";
import { buscarContextoFiscalSaida, buscarEntradasCandidatasDaSaida, salvarContextoFiscalSaida, salvarNFeDaSaida } from "./nfeSaidaService";
import { blocoDasNotasFiscaisReferencia, concatenarBloco } from "@/lib/fiscal/blocosDeObservacao";
import { gerarChaveAcesso } from "@/lib/nfe/chaveAcesso";
import { resolverTratamentoIcms, validarCoerenciaCfopIcms } from "@/lib/nfe/icms";
import { chaveCiencia, pedidosDeCiencia } from "@/lib/nfe/issuesFiscais";
import { randomUUID } from "node:crypto";

/** Ciência como a tela grava: `code@fingerprint` da situação conferida. */
function cienciaCfopCst(cfop: string, cst: string) {
  const [aviso] = validarCoerenciaCfopIcms({ cfop, tratamento: resolverTratamentoIcms({ crt: 3, cst })! });
  const chave = aviso && chaveCiencia(aviso);
  assert.ok(chave, `sem aviso com ciência para ${cfop} + CST ${cst}`);
  return chave;
}
const AVISO_6403_CST60 = cienciaCfopCst("6403", "60");
const AVISO_6404_CST60 = cienciaCfopCst("6404", "60");

const ATOR = "00000000-0000-4000-8000-0000000000a1";

type SalvarComOpcoes<I, R> = (input: I, opcoes?: OpcoesSalvarNFe) => Promise<R>;

/**
 * O caminho da tela: o "estou ciente" vai para o servidor em modo registro e só
 * depois a nota é salva, na mesma sessão de emissão.
 */
async function comCiencia<
  I extends { itens: Array<{ avisosFiscaisConfirmados?: string[] | null }>; cienciaEscopo?: string | null },
  R,
>(salvar: SalvarComOpcoes<I, R>, input: I): Promise<R> {
  const comEscopo = { ...input, cienciaEscopo: input.cienciaEscopo ?? randomUUID() };
  const pedidos = pedidosDeCiencia(comEscopo.itens);
  if (pedidos.length) {
    const registro = (await salvar(comEscopo, { registrarCiencia: { atorId: ATOR, pedidos } })) as {
      ciencia?: ResultadoRegistroCiencia;
      errors?: unknown;
    };
    assert.ok(registro.ciencia, JSON.stringify(registro.errors));
    assert.deepEqual(registro.ciencia.recusadas, []);
  }
  return salvar(comEscopo);
}

const venda: SalvarComOpcoes<NFeOrigemDraftInput, Awaited<ReturnType<typeof salvarNFeDeOrigem>>> = (input, opcoes) =>
  salvarNFeDeOrigem("VENDA", 164, input, undefined, opcoes);

describe("nova emissão para uma origem já documentada", () => {
  it("libera origem com NF-e autorizada e preserva a trava durante rascunho/transmissão", () => {
    assert.equal(statusOcupaOrigem("AUTORIZADA"), false);
    assert.equal(statusOcupaOrigem("CANCELADA"), false);
    assert.equal(statusOcupaOrigem("RASCUNHO"), true);
    assert.equal(statusOcupaOrigem("ENVIADA"), true);
    assert.equal(statusOcupaOrigem("RESULTADO_INCERTO"), true);
  });
});

const produto = {
  id: 1964,
  titulo: "UNIDADE DE CONTROLE VALVULA APM",
  descricao: null,
  referencia: "APM-1964",
  codigobarras: null,
  unidade: "UN",
  ncm: "90328921",
  cfop: "5403",
  origem_mercadoria: "0",
  csosn: null,
  cst: "60",
  cest: "0104700",
  aliquotaicms: 20,
};

const empresa = {
  id: 1,
  cnpj: "12260723000109",
  razaosocial: "AUTO ELETRICA DEMIR LTDA",
  nomefantasia: "DEMIR DIESEL",
  inscricaoestadual: "161234567",
  inscricaoestadualst: null,
  inscricaomunicipal: null,
  endereco: "RUA DO TESTE",
  numero: "10",
  complemento: null,
  bairro: "CENTRO",
  codigomunicipio: "2507507",
  uf: "PB",
  cep: "58000000",
  regimetributario: 3,
  ambiente: "PRODUCAO",
  certificadocaminho: "certificado.pfx",
  certificadosenha: "senha",
  cnae: null,
  telefone: null,
};

const clienteContribuinteMG = {
  id: 10,
  tipopessoa: "JURIDICA",
  cpfcnpj: "19131243000197",
  nomerazaosocial: "SOMAR PECAS DIESEL LTDA",
  email: null,
  telefone: null,
  endereco: "AVENIDA DO CONTORNO",
  endereconumero: "100",
  enderecocomplemento: null,
  bairro: "CENTRO",
  cidade: "BELO HORIZONTE",
  estado: "MG",
  cep: "30110000",
  inscricaoestadual: "0017104840060",
  ind_ie_dest: 1,
  inscricaomunicipal: null,
  codigomunicipio: "3106200",
};

function semente() {
  return {
    nfe_config: [{
      id: 1, empresaid: 1, modelo: "NFE", serie: 3, ultimo_numero: 135, ambiente: "PRODUCAO",
      padroes_emissao: null, incluir_garantia_os: false, incluir_garantia_venda: false,
    }],
    empresa: [empresa],
    cliente: [clienteContribuinteMG],
    fornecedor: [{
      id: 20, cpfcnpj: "19131243000197", nomerazaosocial: "FORNECEDOR MG LTDA", contato: null,
      endereco: "RUA DO FORNECEDOR", endereconumero: "5", enderecocomplemento: null, bairro: "CENTRO",
      cidade: "BELO HORIZONTE", estado: "MG", cep: "30110000", codigomunicipio: "3106200",
    }],
    fiscal_nfe_classificacao_tributaria: [{
      codigo: "000001", cst: "000", nome: "Tributação integral", descricao: null,
      percentual_reducao_ibs: null, percentual_reducao_cbs: null, inicio_vigencia: "2026-01-01",
      fim_vigencia: null, permite_nfe: true, indicadores: {}, versao_fonte: "IT2025.002-v1.60-2026-06-22",
    }],
    fiscal_nfe_cst_ibscbs: [{
      cst: "000", indicadores: { ind_gIBSCBS: 1, ind_gDif: 0 }, versao_fonte: "IT2025.002-v1.60-2026-06-22",
    }],
    venda: [{
      id: 164, clienteid: 10, observacoes_fiscais: null, garantia: null, canal: "BALCAO",
      valor_frete: 0, valortotal: 11000,
    }],
    vendaproduto: [{
      id: 183, venda_id: 164, produtoid: 1964, quantidade: 1, sub_total: 11000, valor_total: 11000, produto,
    }],
    ordemservico: [{
      id: 50, clienteid: 10, observacoes_fiscais: null, garantia: null, subtotal: 11000,
      orcamentototal: 11000, valor_frete: 0,
    }],
    osproduto: [{ ordemservicoid: 50, produtoid: 1964, quantidade: 1, precounitario: 11000, subtotal: 11000, produto }],
    osservico: [],
    entrada: [{ id: 70, fornecedorid: 20, tipo: "COMPRA", status: "CONFIRMADA", origem: "MANUAL" }],
    entradaitens: [{
      id: 300, entrada_id: 70, produto_id: 1964, quantidade: 1, valor_unitario_compra: 11000, precovenda: 15000,
      referencia: "APM-1964", titulo: produto.titulo, unidade: "UN", produto,
    }],
    estoque_saida: [{
      id: 80, motivo: "CONSERTO", observacao: null, status: "CONFIRMADA", created_at: "2026-09-18T10:00:00Z",
      itens: [{ id: 800, produto_id: 1964, quantidade: 1, valor_custo_aplicado: 9000, produto }],
    }],
    estoque_saida_fiscal: [{
      id: 1, saida_id: 80, natureza_operacao: "OUTRA SAIDA DE MERCADORIA", finalidade: "NORMAL",
      documento_referenciado_obrigatorio: false, chave_acesso_referenciada: null, observacoes_fiscais: null,
      destinatario_snapshot: null, entrada_origem_id: null,
      itens: [{ saida_item_id: 800, numero_item_referenciado: null, percentual_devolucao: null, valor_ipi_devolvido: null, entrada_item_origem_id: null }],
    }],
    nfe_saida_item_vinculo: [],
    nfe: [],
    nfe_item: [],
  };
}

let banco: BancoFalso;

beforeEach(() => {
  banco = new BancoFalso(semente()).instalar();
  instalarIbgeFalso({ "2507507": "JOAO PESSOA", "3106200": "BELO HORIZONTE" });
});

afterEach(() => mock.restoreAll());

type SemOrigem = Partial<Omit<NFeAvulsaItemInput, "sourceItemId">>;

/** Item como a tela assistida monta a partir do cadastro do produto. */
function itemDaTela(overrides: SemOrigem & { sourceItemId?: string } = {}): NFeAvulsaItemInput & { sourceItemId: string } {
  return {
    sourceItemId: "venda:164:183",
    produtoId: 1964,
    codigo: "APM-1964",
    descricao: produto.titulo,
    ncm: produto.ncm,
    cfop: "6403",
    unidade: "UN",
    quantidade: 1,
    valorUnitario: 11000,
    valorDesconto: 0,
    orig: "0",
    cst: "60",
    aliquotaIcms: "20",
    cest: produto.cest,
    cstPis: "04",
    modoPis: "NAO_TRIBUTADO",
    cstCofins: "04",
    modoCofins: "NAO_TRIBUTADO",
    rtcHabilitado: true,
    cstIbsCbs: "000",
    cClassTrib: "000001",
    aliquotaIbsUf: "0.1",
    aliquotaIbsMunicipio: "0",
    aliquotaCbs: "0.9",
    avisosFiscaisConfirmados: [],
    procedenciaFiscal: { cst: "PRODUTO", aliquotaicms: "PRODUTO", cfop: "PRODUTO" },
    ...overrides,
  };
}

const configuracaoVenda = {
  destinoMercadoria: "REVENDA_INDUSTRIALIZACAO" as const,
  indicadorPresenca: "1",
  pagamentos: [{ meio: "01", valor: 11000 }],
  transporte: { modFrete: "9" },
};

const cobrancaDuplicata = { duplicatas: [
  { numero: "001", vencimento: "2026-10-25", valor: 5500 },
  { numero: "002", vencimento: "2026-11-25", valor: 5500 },
] };

function confirmarDuplicatas(nota: Emitida) {
  assert.match(nota.xml, /<\/transp><cobr><fat>/);
  assert.match(nota.xml, /<nDup>001<\/nDup><dVenc>2026-10-25<\/dVenc><vDup>5500\.00<\/vDup>/);
  assert.match(nota.xml, /<nDup>002<\/nDup><dVenc>2026-11-25<\/dVenc><vDup>5500\.00<\/vDup>/);
  assert.match(nota.xml, /<\/cobr><pag><detPag><tPag>14<\/tPag><vPag>11000\.00<\/vPag>/);
  assert.deepEqual(nota.nfe.dados_avulsos.cobranca.duplicatas, cobrancaDuplicata.duplicatas);
  assert.equal(banco.escritas.filter((escrita) => escrita.tabela === "transacao").length, 0);
}

type Emitida = {
  xml: string;
  itens: Array<Record<string, any>>;
  nfe: Record<string, any>;
};

function notaGravada(nfeId: number): Emitida {
  const nfe = banco.tabela("nfe").find((linha) => Number(linha.id) === nfeId);
  assert.ok(nfe, "a NF-e não foi gravada");
  const itens = banco.tabela("nfe_item").filter((linha) => Number(linha.nfe_id) === nfeId);
  return { xml: String(nfe.xml_assinado), itens, nfe };
}

function gruposIcms(xml: string) {
  return [...xml.matchAll(/<ICMS><(ICMS\w+)>([\s\S]*?)<\/\1><\/ICMS>/g)].map(([, grupo, corpo]) => {
    const campos: Record<string, number | string> = {};
    for (const [, nome, valor] of corpo.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) campos[nome] = valor;
    return { grupo, campos };
  });
}

function icmsTot(xml: string) {
  const bloco = /<ICMSTot>([\s\S]*?)<\/ICMSTot>/.exec(xml)?.[1] ?? "";
  const tot: Record<string, number> = {};
  for (const [, nome, valor] of bloco.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) tot[nome] = Number(valor);
  return tot;
}

const numero = (valor: unknown) => (valor === null || valor === undefined ? null : Number(valor));

/** O coração da correção: banco, XML e totais contam a mesma história. */
function assertBancoIgualXml(nota: Emitida) {
  const grupos = gruposIcms(nota.xml);
  assert.equal(grupos.length, nota.itens.length);
  const tot = icmsTot(nota.xml);
  let somaBc = 0;
  let somaIcms = 0;
  grupos.forEach(({ grupo, campos }, index) => {
    const item = nota.itens.find((linha) => Number(linha.n_item) === index + 1)!;
    assert.equal(item.grupo_icms_xml, grupo);
    assert.equal(numero(item.valor_bc_icms), numero(campos.vBC));
    assert.equal(numero(item.valor_icms), numero(campos.vICMS));
    assert.equal(numero(item.aliquotaicms), numero(campos.pICMS));
    assert.equal(numero(item.valor_bc_icms_st), numero(campos.vBCST));
    assert.equal(numero(item.valor_icms_st), numero(campos.vICMSST));
    assert.equal(numero(item.valor_bc_st_retido), numero(campos.vBCSTRet));
    assert.equal(numero(item.valor_icms_st_retido), numero(campos.vICMSSTRet));
    assert.deepEqual(item.tributacao_snapshot.icms?.grupoXml, grupo);
    somaBc += Number(campos.vBC ?? 0);
    somaIcms += Number(campos.vICMS ?? 0);
  });
  assert.equal(tot.vBC, Number(somaBc.toFixed(2)));
  assert.equal(tot.vICMS, Number(somaIcms.toFixed(2)));
}

function assertRegressao136(nota: Emitida) {
  const [{ grupo, campos }] = gruposIcms(nota.xml);
  assert.equal(grupo, "ICMS60");
  assert.deepEqual(campos, { orig: "0", CST: "60" });
  const tot = icmsTot(nota.xml);
  assert.equal(tot.vBC, 0);
  assert.equal(tot.vICMS, 0);

  const [item] = nota.itens;
  assert.equal(item.valor_bc_icms, null);
  assert.equal(item.valor_icms, null);
  assert.equal(item.aliquotaicms, null);
  // A alíquota do cadastro não some: fica registrada como não usada, com o motivo.
  const [ignorado] = item.tributacao_snapshot.icmsDecisao.camposIgnorados;
  assert.equal(ignorado.campo, "aliquotaicms");
  assert.equal(ignorado.valor, 20);
  assert.equal(ignorado.origem, "PRODUTO");
  assert.equal(item.tributacao_snapshot.icmsDecisao.tratamentoIcms, "ST_RETIDA_ANTERIORMENTE");
  assert.equal(item.tributacao_snapshot.icmsDecisao.icmsProprio, false);
  assertBancoIgualXml(nota);
}

describe("VENDA — regressão da NF-e 136", () => {
  it("leva Duplicata Mercantil ao XML e ao snapshot", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ cfop: "6102", cst: "00" })],
      configuracaoFiscal: { ...configuracaoVenda, pagamentos: [{ meio: "14", valor: 11000 }], cobranca: cobrancaDuplicata },
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    confirmarDuplicatas(notaGravada(resultado.nfeId));
  });

  it("preserva duplicatas ao corrigir a mesma NF-e rejeitada", async () => {
    const input = {
      itens: [itemDaTela({ cfop: "6102", cst: "00" })],
      configuracaoFiscal: { ...configuracaoVenda, pagamentos: [{ meio: "14", valor: 11000 }], cobranca: cobrancaDuplicata },
    };
    const primeira = await salvarNFeDeOrigem("VENDA", 164, input);
    assert.ok(primeira.ok, JSON.stringify(!primeira.ok && primeira.errors));
    const linha = banco.tabela("nfe").find((nota) => Number(nota.id) === primeira.nfeId);
    assert.ok(linha);
    linha.status = "REJEITADA";
    const segunda = await salvarNFeDeOrigem("VENDA", 164, { ...input, nfeId: primeira.nfeId });
    assert.ok(segunda.ok, JSON.stringify(!segunda.ok && segunda.errors));
    assert.equal(segunda.nfeId, primeira.nfeId);
    confirmarDuplicatas(notaGravada(segunda.nfeId));
  });

  it("recupera pagamentos e duplicatas do rascunho e da nota rejeitada", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ cfop: "6102", cst: "00" })],
      configuracaoFiscal: { ...configuracaoVenda, pagamentos: [{ meio: "14", valor: 11000 }], cobranca: cobrancaDuplicata },
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    for (const status of ["RASCUNHO", "REJEITADA"]) {
      const linha = banco.tabela("nfe").find((nota) => Number(nota.id) === resultado.nfeId);
      assert.ok(linha);
      linha.status = status;
      const recuperado = await buscarNFeAvulsaDraft(resultado.nfeId);
      assert.deepEqual(
        recuperado?.nfe.dados_avulsos.pagamentos.map((pagamento: { meio: string; valor: number }) => ({ meio: pagamento.meio, valor: pagamento.valor })),
        [{ meio: "14", valor: 11000 }],
      );
      assert.deepEqual(recuperado?.nfe.dados_avulsos.cobranca.duplicatas, cobrancaDuplicata.duplicatas);
    }
  });

  it("permite novo rascunho quando a mesma venda já tem NF-e autorizada", async () => {
    const input = {
      itens: [itemDaTela({
        avisosFiscaisConfirmados: [
          AVISO_6403_CST60,
        ],
      })],
      configuracaoFiscal: configuracaoVenda,
    };
    const primeira = await comCiencia(venda, input);
    assert.ok(primeira.ok, JSON.stringify(!primeira.ok && primeira.errors));
    const notaExistente = banco.tabela("nfe").find((nota) => Number(nota.id) === primeira.nfeId);
    assert.ok(notaExistente);
    notaExistente.status = "AUTORIZADA";
    notaExistente.numero = 136;

    const segunda = await comCiencia(venda, input);

    assert.ok(segunda.ok, JSON.stringify(!segunda.ok && segunda.errors));
    assert.notEqual(segunda.nfeId, primeira.nfeId);
    assert.equal(banco.tabela("nfe").filter((nota) => Number(nota.vendaid) === 164).length, 2);
  });

  it("6403 com CST 60 não sai sem a ciência do usuário, e o CST não é trocado", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, { itens: [itemDaTela()], configuracaoFiscal: configuracaoVenda });
    assert.equal(resultado.ok, false);
    const [erro] = resultado.errors as Array<{ code?: string; requerCiencia?: boolean; fingerprint?: string }>;
    // O servidor devolve o fingerprint que ele calculou: é o que a ciência tem de citar.
    assert.equal(`${erro.code}@${erro.fingerprint}`, AVISO_6403_CST60);
    assert.equal(erro.requerCiencia, true);
    assert.equal(banco.tabela("nfe").length, 0);
  });

  it("com a ciência, grava ICMS60 sem ICMS próprio no banco, no XML e nos totais", async () => {
    const resultado = await comCiencia(venda, {
      itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60] })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.equal(resultado.ok, true, JSON.stringify(resultado.errors));
    const nota = notaGravada(resultado.ok ? resultado.nfeId : 0);
    assertRegressao136(nota);
    assert.deepEqual(
      nota.itens[0].tributacao_snapshot.icmsDecisao.avisosConfirmados.map(
        (aviso: { code: string; fingerprint: string }) => `${aviso.code}@${aviso.fingerprint}`,
      ),
      [AVISO_6403_CST60],
    );
    assert.deepEqual(nota.nfe.decisao_fiscal.icms[0].avisosConfirmados, [AVISO_6403_CST60]);
    // Quem confirmou e quando: a ciência registrada pelo servidor.
    const [confirmado] = nota.itens[0].tributacao_snapshot.icmsDecisao.avisosConfirmados;
    assert.equal(confirmado.ciencia.usuarioId, ATOR);
    const [linha] = banco.tabela("nfe_ciencia_aviso");
    assert.equal(confirmado.ciencia.id, linha.id);
    assert.equal(linha.nfe_id, resultado.ok ? resultado.nfeId : null);
    assert.match(nota.xml, /<CFOP>6403<\/CFOP>/);
    assert.equal(nota.nfe.decisao_fiscal.icms[0].grupoXmlIcms, "ICMS60");
  });

  it("não presume consumidor final: sem destino a nota não é gerada", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60] })],
      configuracaoFiscal: { ...configuracaoVenda, destinoMercadoria: null },
    });
    assert.equal(resultado.ok, false);
    assert.ok(resultado.errors.some((erro) => erro.field === "destinoMercadoria"));
  });

  it("o indFinal sai do destino escolhido, não do tipo de origem", async () => {
    const revenda = await comCiencia(venda, {
      itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60] })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.ok(revenda.ok);
    const nota = notaGravada(revenda.nfeId);
    assert.match(nota.xml, /<indFinal>0<\/indFinal>/);
    assert.equal(nota.nfe.dados_avulsos.operacao.destinoMercadoria, "REVENDA_INDUSTRIALIZACAO");
    assert.equal(nota.nfe.dados_avulsos.operacao.consumidorFinal, false);
  });

  it("CST 00 com a mesma alíquota: BC 11.000 e ICMS 2.200 no banco, no XML e no total", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ cfop: "6102", cst: "00" })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    const [{ grupo, campos }] = gruposIcms(nota.xml);
    assert.equal(grupo, "ICMS00");
    assert.equal(campos.vBC, "11000.00");
    assert.equal(campos.vICMS, "2200.00");
    assert.equal(numero(nota.itens[0].valor_bc_icms), 11000);
    assert.equal(numero(nota.itens[0].valor_icms), 2200);
    assert.equal(icmsTot(nota.xml).vICMS, 2200);
    assertBancoIgualXml(nota);
  });
});

describe("OS removida do ERP", () => {
  it("recusa emissão de OS sem criar uma nota fiscal", async () => {
    const resultado = await salvarNFeDeOrigem("OS", 50, {
      itens: [itemDaTela({ sourceItemId: "os:50:1964", cfop: "6102", cst: "00" })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.equal(resultado.ok, false);
    assert.match(resultado.errors[0].message, /módulo de ordens de serviço foi removido/);
  });
});

describe("ENTRADA — mesmo núcleo", () => {
  const destinatarioFornecedor = {
    clienteId: null,
    fornecedorId: 20,
    tipoPessoa: "JURIDICA" as const,
    cpfCnpj: "19131243000197",
    nomeRazaoSocial: "FORNECEDOR MG LTDA",
    indicadorIe: "1",
    inscricaoEstadual: "0017104840060",
    endereco: "RUA DO FORNECEDOR",
    numero: "5",
    bairro: "CENTRO",
    cidade: "BELO HORIZONTE",
    estado: "MG",
    cep: "30110000",
    codigoMunicipio: "3106200",
  };
  const itemEntrada = (overrides: SemOrigem = {}) =>
    itemDaTela({ sourceItemId: "entrada:70:300", cfop: "2403", ...overrides });

  it("leva Duplicata Mercantil ao XML e ao snapshot", async () => {
    const resultado = await salvarNFeDeOrigem("ENTRADA", 70, {
      itens: [itemEntrada({ cfop: "2102", cst: "00", aliquotaIcms: "12" })],
      destinatario: destinatarioFornecedor,
      configuracaoFiscal: { pagamentos: [{ meio: "14", valor: 11000 }], cobranca: cobrancaDuplicata },
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    confirmarDuplicatas(notaGravada(resultado.nfeId));
  });

  it("CST 60 na entrada também não ganha ICMS próprio pela alíquota", async () => {
    const resultado = await salvarNFeDeOrigem("ENTRADA", 70, {
      itens: [itemEntrada()],
      destinatario: destinatarioFornecedor,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assertRegressao136(nota);
    assert.match(nota.xml, /<tpNF>0<\/tpNF>/);
    assert.match(nota.xml, /<indFinal>0<\/indFinal>/);
  });

  it("CST 00 na entrada", async () => {
    const resultado = await salvarNFeDeOrigem("ENTRADA", 70, {
      itens: [itemEntrada({ cfop: "2102", cst: "00", aliquotaIcms: "12" })],
      destinatario: destinatarioFornecedor,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assert.equal(numero(nota.itens[0].valor_icms), 1320);
    assertBancoIgualXml(nota);
  });
});

describe("SAÍDA DE ESTOQUE — mesmo núcleo", () => {
  const chaveFiscalOrigem = gerarChaveAcesso({
    cUF: "35", ano: 2026, mes: 8, cnpj: "12345678000199",
    mod: "55", serie: 1, nNF: 123, tpEmis: 1, cNF: "00000123",
  }).chave;
  const destinatario = {
    clienteId: 10,
    tipoPessoa: "JURIDICA" as const,
    cpfCnpj: clienteContribuinteMG.cpfcnpj,
    nomeRazaoSocial: clienteContribuinteMG.nomerazaosocial,
    indicadorIe: "1",
    inscricaoEstadual: clienteContribuinteMG.inscricaoestadual,
    endereco: clienteContribuinteMG.endereco,
    numero: clienteContribuinteMG.endereconumero,
    bairro: clienteContribuinteMG.bairro,
    cidade: clienteContribuinteMG.cidade,
    estado: "MG",
    cep: clienteContribuinteMG.cep,
    codigoMunicipio: clienteContribuinteMG.codigomunicipio,
  };
  const itemSaida = (overrides: SemOrigem = {}) =>
    itemDaTela({ sourceItemId: "saida:80:800", cfop: "6949", ...overrides });

  it("contexto e candidatas carregam dados da NF-e somente com entrada efetivamente vinculada", async () => {
    const contexto = banco.tabela("estoque_saida_fiscal")[0];
    contexto.entrada_origem_id = 70;
    contexto.itens[0].entrada_item_origem_id = 300;
    contexto.entradaReferencia = {
      id: 70, notachave: chaveFiscalOrigem, numero_nota: "12345", serie_nota: "1",
      data_emissao: "2026-09-25T10:00:00-03:00",
      fornecedor: { nomerazaosocial: "FORNECEDOR MG LTDA" },
    };
    const dados = await buscarContextoFiscalSaida(80);
    assert.deepEqual(dados.notaFiscalReferencia, {
      entradaId: 70, entradaItemOrigemIds: [300], chaveAcesso: chaveFiscalOrigem,
      numeroNota: "12345", serieNota: "1", dataEmissao: "2026-09-25T10:00:00-03:00",
      fornecedor: "FORNECEDOR MG LTDA",
    });
    const bloco = blocoDasNotasFiscaisReferencia([dados.notaFiscalReferencia]);
    assert.ok(bloco?.texto.includes("nº 12345; série 1; emissão 25/09/2026"));

    banco.tabela("entradaitens")[0].entrada = {
      id: 70, status: "CONFIRMADA", notachave: chaveFiscalOrigem,
      numero_nota: "12345", serie_nota: "1", data_emissao: "2026-09-25T10:00:00-03:00",
      fornecedor: { id: 20, nomerazaosocial: "FORNECEDOR MG LTDA" },
    };
    const candidatas = await buscarEntradasCandidatasDaSaida(80);
    const entradaCandidata = candidatas[0].entrada as unknown as {
      numero_nota: string; serie_nota: string; data_emissao: string;
    };
    assert.equal(entradaCandidata.numero_nota, "12345");
    assert.equal(entradaCandidata.serie_nota, "1");
    assert.equal(entradaCandidata.data_emissao, "2026-09-25T10:00:00-03:00");

    contexto.itens[0].entrada_item_origem_id = null;
    assert.equal((await buscarContextoFiscalSaida(80)).notaFiscalReferencia, null);
    contexto.itens[0].entrada_item_origem_id = 300;
    contexto.entrada_origem_id = null;
    assert.equal((await buscarContextoFiscalSaida(80)).notaFiscalReferencia, null);
  });

  function configurarSemOrigem(codigo: string, natureza: string) {
    const contexto = banco.tabela("estoque_saida_fiscal")[0];
    contexto.operacao_fiscal_codigo = codigo;
    contexto.natureza_operacao = natureza;
    contexto.finalidade = "NORMAL";
    contexto.documento_referenciado_obrigatorio = false;
    contexto.entrada_origem_id = null;
    contexto.chave_acesso_referenciada = null;
    contexto.itens[0].entrada_item_origem_id = null;
    contexto.itens[0].numero_item_referenciado = null;
    banco.tabela("entrada").splice(0);
    banco.tabela("entradaitens").splice(0);
  }

  for (const [cfop, estado, codigoMunicipio] of [
    ["5915", "PB", "2507507"],
    ["6915", "MG", "3106200"],
  ]) {
    it(`emite remessa ${cfop} sem nenhuma entrada fiscal anterior`, async () => {
      configurarSemOrigem("REMESSA_CONSERTO_REPARO", "REMESSA PARA CONSERTO OU REPARO");
      const resultado = await salvarNFeDaSaida(80, {
        itens: [itemSaida({ cfop, cst: "00", dfeReferenciado: {
          chaveAcesso: chaveFiscalOrigem, nItem: 1,
        } })],
        destinatario: { ...destinatario, estado, cidade: estado === "PB" ? "JOAO PESSOA" : "BELO HORIZONTE", codigoMunicipio },
        destinoMercadoria: "USO_CONSUMO",
      });
      assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
      const nota = notaGravada(resultado.nfeId);
      assert.match(nota.xml, new RegExp(`<CFOP>${cfop}</CFOP>`));
      assert.doesNotMatch(nota.xml, /<NFref>|<DFeReferenciado>/);
      assert.equal(banco.tabela("entradaitens").length, 0);
    });
  }

  it("emite OUTRA + NORMAL sem origem e sem referência no XML", async () => {
    configurarSemOrigem("OUTRA", "OUTRA SAIDA SEM DOCUMENTO ANTERIOR");
    banco.tabela("estoque_saida_fiscal")[0].itens[0].entrada_item_origem_id = 999999;
    const resultado = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cst: "00" })], destinatario,
      destinoMercadoria: "USO_CONSUMO",
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    assert.doesNotMatch(notaGravada(resultado.nfeId).xml, /<NFref>|<DFeReferenciado>/);
    const vinculo = banco.chamadasRpc.find((item) => item.nome === "vincular_nfe_saidas");
    assert.equal(vinculo?.args.p_itens[0].entrada_item_origem_id, null);
  });

  it("emite bem próprio em garantia sem compra anterior", async () => {
    configurarSemOrigem("REMESSA_BEM_PROPRIO_GARANTIA", "REMESSA DE BEM PROPRIO PARA GARANTIA OU REPARO");
    const resultado = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cst: "00" })], destinatario,
      destinoMercadoria: "USO_CONSUMO",
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    assert.doesNotMatch(notaGravada(resultado.nfeId).xml, /<NFref>|<DFeReferenciado>/);
  });

  it("devolução sem chave e retorno de conserto sem origem continuam bloqueados", async () => {
    const contexto = banco.tabela("estoque_saida_fiscal")[0];
    contexto.finalidade = "DEVOLUCAO";
    contexto.documento_referenciado_obrigatorio = true;
    contexto.itens[0].numero_item_referenciado = 1;
    const devolucao = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cfop: "6202", cst: "00" })], destinatario,
      destinoMercadoria: "USO_CONSUMO",
    });
    assert.equal(devolucao.ok, false);
    assert.match(JSON.stringify(devolucao.errors), /chave/i);

    contexto.finalidade = "NORMAL";
    contexto.documento_referenciado_obrigatorio = true;
    contexto.operacao_fiscal_codigo = "RETORNO_CONSERTO_REPARO";
    const retorno = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cfop: "6916", cst: "00" })], destinatario,
      destinoMercadoria: "USO_CONSUMO",
    });
    assert.equal(retorno.ok, false);
    assert.match(JSON.stringify(retorno.errors), /chave/i);
  });

  it("devolução válida preserva a referência no item", async () => {
    const contexto = banco.tabela("estoque_saida_fiscal")[0];
    contexto.operacao_fiscal_codigo = "DEVOLUCAO_COMPRA_COMERCIALIZACAO";
    contexto.finalidade = "DEVOLUCAO";
    contexto.documento_referenciado_obrigatorio = true;
    contexto.chave_acesso_referenciada = chaveFiscalOrigem;
    contexto.itens[0].numero_item_referenciado = 1;
    contexto.itens[0].entrada_item_origem_id = 300;
    const bloco = blocoDasNotasFiscaisReferencia([{ chaveAcesso: chaveFiscalOrigem, numeroNota: "12345" }]);
    assert.ok(bloco);
    const observacoesFiscais = concatenarBloco("Texto existente", bloco.texto, 500).texto;
    const resultado = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cfop: "6202", cst: "00" })], destinatario,
      destinoMercadoria: "USO_CONSUMO",
      observacoesFiscais,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const xml = notaGravada(resultado.nfeId).xml;
    assert.match(xml, new RegExp(`<DFeReferenciado><chaveAcesso>${chaveFiscalOrigem}</chaveAcesso><nItem>1</nItem>`));
    assert.doesNotMatch(xml, /<NFref>/);
    assert.match(xml, /<infCpl>.*Texto existente NF-e de referencia: n 12345; chave /);
  });

  it("o servidor descarta vínculos antigos sem consultar entrada inexistente", async () => {
    banco.tabela("entradaitens").splice(0);
    await salvarContextoFiscalSaida(80, {
      operacaoFiscalCodigo: "OUTRA",
      naturezaOperacao: "OUTRA SAIDA SEM DOCUMENTO ANTERIOR",
      finalidade: "NORMAL",
      documentoReferenciadoObrigatorio: false,
      chaveAcessoReferenciada: chaveFiscalOrigem,
      destinatario,
      itens: [{
        saidaItemId: 800, entradaItemOrigemId: 999999,
        numeroItemReferenciado: 3, percentualDevolucao: 50, valorIpiDevolvido: 10,
      }],
    });
    const chamada = banco.chamadasRpc.find((item) => item.nome === "salvar_contexto_fiscal_saida");
    assert.ok(chamada);
    assert.equal(chamada.args.p_contexto.chave_acesso_referenciada, null);
    assert.equal(chamada.args.p_contexto.entrada_origem_id, null);
    assert.equal(chamada.args.p_itens[0].entrada_item_origem_id, null);
    assert.equal(chamada.args.p_itens[0].numero_item_referenciado, null);
    assert.equal(chamada.args.p_itens[0].valor_ipi_devolvido, 0);
  });

  it("devolução sem item de entrada continua bloqueada no servidor", async () => {
    await assert.rejects(() => salvarContextoFiscalSaida(80, {
      operacaoFiscalCodigo: "DEVOLUCAO_COMPRA_COMERCIALIZACAO",
      destinatario,
      itens: [{ saidaItemId: 800, numeroItemReferenciado: 1 }],
    }), /Vincule o item 1 à entrada fiscal/);
  });

  it("saídas agrupadas não misturam decisões opostas sobre documento de origem", async () => {
    const contexto = banco.tabela("estoque_saida_fiscal")[0];
    contexto.operacao_fiscal_codigo = "OUTRA";
    contexto.chave_acesso_referenciada = chaveFiscalOrigem;
    contexto.entrada_origem_id = 70;
    banco.tabela("estoque_saida").push({
      id: 81, motivo: "CONSERTO", observacao: null, status: "CONFIRMADA", created_at: "2026-09-18T11:00:00Z",
      itens: [{ id: 801, produto_id: 1964, quantidade: 1, valor_custo_aplicado: 9000, produto }],
    });
    banco.tabela("estoque_saida_fiscal").push({
      ...structuredClone(contexto), id: 2, saida_id: 81,
      documento_referenciado_obrigatorio: true,
      itens: [{ saida_item_id: 801, entrada_item_origem_id: 300, numero_item_referenciado: 1 }],
    });
    const resultado = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cst: "00" }), itemDaTela({ sourceItemId: "saida:81:801", cfop: "6949", cst: "00" })],
      destinatario, destinoMercadoria: "USO_CONSUMO",
    });
    assert.equal(resultado.ok, false);
    assert.match(JSON.stringify(resultado.errors), /mesma entrada e operação fiscal/);
    assert.equal(banco.tabela("nfe").length, 0);
  });

  it("leva Duplicata Mercantil ao XML e ao snapshot", async () => {
    const resultado = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cst: "00" })], destinatario,
      destinoMercadoria: "USO_CONSUMO",
      pagamentos: [{ meio: "14", valor: 11000 }], cobranca: cobrancaDuplicata,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    confirmarDuplicatas(notaGravada(resultado.nfeId));
  });

  it("leva pagamentos e cobrança ao XML também na saída agrupada", async () => {
    banco.tabela("estoque_saida").push({
      id: 81, motivo: "CONSERTO", observacao: null, status: "CONFIRMADA", created_at: "2026-09-18T11:00:00Z",
      itens: [{ id: 801, produto_id: 1964, quantidade: 1, valor_custo_aplicado: 9000, produto }],
    });
    banco.tabela("estoque_saida_fiscal").push({
      id: 2, saida_id: 81, natureza_operacao: "OUTRA SAIDA DE MERCADORIA", finalidade: "NORMAL",
      documento_referenciado_obrigatorio: false, chave_acesso_referenciada: null, observacoes_fiscais: null,
      destinatario_snapshot: null, entrada_origem_id: null,
      itens: [{ saida_item_id: 801, numero_item_referenciado: null, percentual_devolucao: null, valor_ipi_devolvido: null, entrada_item_origem_id: null }],
    });
    const resultado = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cst: "00" }), itemDaTela({ sourceItemId: "saida:81:801", cfop: "6949", cst: "00" })],
      destinatario, destinoMercadoria: "USO_CONSUMO",
      pagamentos: [{ meio: "14", valor: 22000 }],
      cobranca: { duplicatas: [
        { vencimento: "2026-10-25", valor: 11000 },
        { vencimento: "2026-11-25", valor: 11000 },
      ] },
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assert.match(nota.xml, /<\/transp><cobr><fat>/);
    assert.match(nota.xml, /<nDup>001<\/nDup><dVenc>2026-10-25<\/dVenc><vDup>11000\.00<\/vDup>/);
    assert.match(nota.xml, /<nDup>002<\/nDup><dVenc>2026-11-25<\/dVenc><vDup>11000\.00<\/vDup>/);
    assert.match(nota.xml, /<\/cobr><pag><detPag><tPag>14<\/tPag><vPag>22000\.00<\/vPag>/);
    assert.doesNotMatch(nota.xml, /<NFref>|<DFeReferenciado>/);
    assert.equal(nota.nfe.dados_avulsos.cobranca.duplicatas.length, 2);
    assert.equal(banco.escritas.filter((escrita) => escrita.tabela === "transacao").length, 0);
  });

  it("CST 60 sem ICMS próprio; indFinal vem do destino, não do indicador de IE", async () => {
    const resultado = await salvarNFeDaSaida(80, {
      itens: [itemSaida()],
      destinatario,
      destinoMercadoria: "OUTRO",
      consumidorFinal: false,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assertRegressao136(nota);
    assert.match(nota.xml, /<indFinal>0<\/indFinal>/);
  });

  it("saída sem destino da mercadoria é recusada", async () => {
    const resultado = await salvarNFeDaSaida(80, { itens: [itemSaida()], destinatario });
    assert.equal(resultado.ok, false);
    assert.ok(resultado.errors.some((erro) => (erro as { field?: string }).field === "destinoMercadoria"));
  });

  it("CST 00 pela saída", async () => {
    const resultado = await salvarNFeDaSaida(80, {
      itens: [itemSaida({ cst: "00" })],
      destinatario,
      destinoMercadoria: "USO_CONSUMO",
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assert.equal(numero(nota.itens[0].valor_icms), 2200);
    assertBancoIgualXml(nota);
  });
});

describe("AVULSA — mesmo núcleo", () => {
  it("seleciona CST e cClassTrib da mesma edição sem depender da ordem das linhas", async () => {
    const versao = "IT2025.002-v1.71-2026-10-30";
    banco.tabela("fiscal_nfe_cst_ibscbs").push({
      ...banco.tabela("fiscal_nfe_cst_ibscbs")[0], versao_fonte: versao,
    });
    banco.tabela("fiscal_nfe_classificacao_tributaria").unshift({
      ...banco.tabela("fiscal_nfe_classificacao_tributaria")[0], versao_fonte: versao,
    });
    const resultado = await salvarNFeAvulsaDraft(draftAvulso([itemDaTela({ cfop: "6102", cst: "00" })]));
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    assert.equal(notaGravada(resultado.nfeId).itens[0].tributacao_snapshot.rtc.versaoClassificacao, versao);
  });

  it("não recupera código de edição antiga quando ele está ausente na edição atual", async () => {
    banco.tabela("fiscal_nfe_cst_ibscbs").push({
      ...banco.tabela("fiscal_nfe_cst_ibscbs")[0], versao_fonte: "IT2025.002-v1.71-2026-10-30",
    });
    const resultado = await salvarNFeAvulsaDraft(draftAvulso([itemDaTela({ cfop: "6102", cst: "00" })]));
    assert.equal(resultado.ok, false);
    assert.match(JSON.stringify(resultado.errors), /NFE_IBSCBS_CLASS_NOT_FOUND/);
    assert.equal(banco.tabela("nfe").length, 0);
  });

  function draftAvulso(itens: NFeAvulsaItemInput[], destinoMercadoria: NFeAvulsaDraftInput["operacao"]["destinoMercadoria"] = "REVENDA_INDUSTRIALIZACAO"): NFeAvulsaDraftInput {
    return {
      operacao: {
        tipoOperacao: "SAIDA",
        naturezaOperacao: "VENDA DE MERCADORIA",
        finalidade: "NORMAL",
        destinoMercadoria,
        indicadorPresenca: "1",
      },
      destinatario: {
        clienteId: 10,
        tipoPessoa: "JURIDICA",
        cpfCnpj: clienteContribuinteMG.cpfcnpj,
        nomeRazaoSocial: clienteContribuinteMG.nomerazaosocial,
        indicadorIe: "1",
        inscricaoEstadual: clienteContribuinteMG.inscricaoestadual,
        endereco: clienteContribuinteMG.endereco,
        numero: clienteContribuinteMG.endereconumero,
        bairro: "CENTRO",
        cidade: "BELO HORIZONTE",
        estado: "MG",
        cep: "30110000",
        codigoMunicipio: "3106200",
      },
      pagamentos: [{ meio: "01", valor: itens.reduce((soma, item) => soma + Number(item.valorUnitario) * Number(item.quantidade), 0), tipoIntegracao: "2" }],
      transporte: { modFrete: "9" },
      itens,
    };
  }

  it("leva Duplicata Mercantil ao XML e ao snapshot", async () => {
    const resultado = await salvarNFeAvulsaDraft({
      ...draftAvulso([itemDaTela({ cfop: "6102", cst: "00" })]),
      pagamentos: [{ meio: "14", valor: 11000 }], cobranca: cobrancaDuplicata,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    confirmarDuplicatas(notaGravada(resultado.nfeId));
  });

  it("regressão da NF-e 136 pela avulsa", async () => {
    const resultado = await comCiencia(salvarNFeAvulsaDraft, draftAvulso([itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60] })]));
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    assertRegressao136(notaGravada(resultado.nfeId));
  });

  it("CST 60 com ST retida informada vai para as colunas próprias e para o XML", async () => {
    const resultado = await comCiencia(salvarNFeAvulsaDraft, draftAvulso([itemDaTela({
      cfop: "6404",
      icms: { stRetida: { vBCSTRet: 13200, pST: 18, vICMSSTRet: 1656, vICMSSubstituto: 720 } },
      avisosFiscaisConfirmados: [
        AVISO_6404_CST60,
      ],
    })]));
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    const [{ campos }] = gruposIcms(nota.xml);
    assert.equal(campos.vBCSTRet, "13200.00");
    assert.equal(campos.vICMSSTRet, "1656.00");
    assert.equal(nota.itens[0].valor_icms, null);
    assert.equal(numero(nota.itens[0].valor_icms_st_retido), 1656);
    assertBancoIgualXml(nota);
  });

  it("vários CST na mesma nota: o total soma só o ICMS próprio serializado", async () => {
    const resultado = await comCiencia(salvarNFeAvulsaDraft, draftAvulso([
      itemDaTela({
        cfop: "6404",
        avisosFiscaisConfirmados: [
          AVISO_6404_CST60,
        ],
      }),
      itemDaTela({ cfop: "6102", cst: "00", valorUnitario: 1000 }),
      itemDaTela({ cfop: "6102", cst: "20", aliquotaIcms: "18", valorUnitario: 1000, icms: { proprio: { pRedBC: 50 } } }),
      itemDaTela({ cfop: "6102", cst: "41", aliquotaIcms: "18", valorUnitario: 1000 }),
    ]));
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    const tot = icmsTot(nota.xml);
    // 1000 × 20% + (1000 × 50%) × 18%
    assert.equal(tot.vBC, 1500);
    assert.equal(tot.vICMS, 290);
    assertBancoIgualXml(nota);
  });

  it("bloqueia PIS-ST/COFINS-ST antes de calcular IBS/CBS ou gravar o rascunho", async () => {
    await assert.rejects(
      () => salvarNFeAvulsaDraft(draftAvulso([itemDaTela({
        pisST: { modo: "PERCENTUAL", base: 11000, aliquota: 1, valor: 110, compoeTotal: false },
      })])),
      /NFE_PIS_COFINS_ST_NAO_SUPORTADO/,
    );
    assert.equal(banco.tabela("nfe").length, 0);
    assert.equal(banco.tabela("nfe_item").length, 0);
  });
});

describe("VENDA — frete na base do ICMS", () => {
  const vendaCom = (transporte: Record<string, unknown>) =>
    salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ cfop: "6102", cst: "00" })],
      configuracaoFiscal: { ...configuracaoVenda, transporte: { valorFrete: 500, ...transporte } },
    });

  it("transporte do remetente: frete na BC própria no banco, no XML e no total", async () => {
    const resultado = await vendaCom({ modFrete: "0" });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    const [{ campos }] = gruposIcms(nota.xml);
    assert.equal(campos.vBC, "11500.00");
    assert.equal(campos.vICMS, "2300.00");
    assert.match(nota.xml, /<vFrete>500\.00<\/vFrete>/);
    assert.equal(icmsTot(nota.xml).vNF, 11500);
    assert.equal(numero(nota.itens[0].valor_bc_icms), 11500);
    assert.equal(nota.itens[0].tributacao_snapshot.icmsDecisao.composicaoBase.frete, 500);
    assert.equal(nota.nfe.decisao_fiscal.freteNaBaseIcms.fonte, "LEI");
    assertBancoIgualXml(nota);
  });

  it("frete cobrado com modalidade FOB: sem decisão a nota não é gerada", async () => {
    const resultado = await vendaCom({ modFrete: "1" });
    assert.equal(resultado.ok, false);
    const erro = resultado.errors.find((item) => item.field === "transporte.freteIntegraBaseIcms");
    assert.ok(erro);
    assert.equal(erro.step, "transport");
    assert.equal(banco.tabela("nfe").length, 0);
  });

  it("frete cobrado com modalidade FOB: vale a decisão do usuário, e ela fica gravada", async () => {
    const resultado = await vendaCom({ modFrete: "1", freteIntegraBaseIcms: false });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assert.equal(gruposIcms(nota.xml)[0].campos.vBC, "11000.00");
    assert.equal(nota.nfe.decisao_fiscal.freteNaBaseIcms.fonte, "USUARIO");
    assert.equal(nota.nfe.dados_avulsos.transporte.freteIntegraBaseIcms, false);
    assertBancoIgualXml(nota);
  });
});

/** Base do IBS/CBS serializada no item (gIBSCBS/vBC) e no total. */
function baseIbsCbsNoXml(xml: string) {
  return {
    item: Number(/<gIBSCBS><vBC>([\d.]+)<\/vBC>/.exec(xml)?.[1]),
    total: Number(/<vBCIBSCBS>([\d.]+)<\/vBCIBSCBS>/.exec(xml)?.[1]),
  };
}

describe("IBS/CBS — base pela composição oficial (UB16-10) nos fluxos", () => {
  it("VENDA CST 00: base = valor − ICMS próprio, igual no XML, no total e no snapshot", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ cfop: "6102", cst: "00" })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assert.deepEqual(baseIbsCbsNoXml(nota.xml), { item: 8800, total: 8800 });
    assert.equal(nota.itens[0].tributacao_snapshot.rtc.baseCalculo, 8800);
    assert.equal(nota.itens[0].tributacao_snapshot.rtc.composicaoBase.componentes.vICMS, 2200);
  });

  it("VENDA com frete CIF: o frete entra nas bases do ICMS e do IBS/CBS", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ cfop: "6102", cst: "00" })],
      configuracaoFiscal: { ...configuracaoVenda, transporte: { modFrete: "0", valorFrete: 500 } },
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    // 11.000 + 500 de frete − 2.300 de ICMS (20% sobre 11.500)
    assert.deepEqual(baseIbsCbsNoXml(notaGravada(resultado.nfeId).xml), { item: 9200, total: 9200 });
  });

  it("VENDA CST 60 da NF-e 136: sem ICMS próprio, a base é o valor da operação", async () => {
    const resultado = await comCiencia(venda, {
      itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60] })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    assert.deepEqual(baseIbsCbsNoXml(notaGravada(resultado.nfeId).xml), { item: 11000, total: 11000 });
  });
});

describe("AVULSA — CST 90 com diferimento (PL_010e/010f)", () => {
  it("serializa o diferimento no ICMS90, grava valor_icms_diferido e desconta só o ICMS devido do IBS/CBS", async () => {
    const draft = {
      operacao: { tipoOperacao: "SAIDA" as const, naturezaOperacao: "VENDA", finalidade: "NORMAL" as const, destinoMercadoria: "REVENDA_INDUSTRIALIZACAO" as const, indicadorPresenca: "1" },
      destinatario: {
        clienteId: 10, tipoPessoa: "JURIDICA" as const, cpfCnpj: clienteContribuinteMG.cpfcnpj,
        nomeRazaoSocial: clienteContribuinteMG.nomerazaosocial, indicadorIe: "1",
        inscricaoEstadual: clienteContribuinteMG.inscricaoestadual, endereco: "AV", numero: "1", bairro: "CENTRO",
        cidade: "BELO HORIZONTE", estado: "MG", cep: "30110000", codigoMunicipio: "3106200",
      },
      pagamentos: [{ meio: "01", valor: 11000, tipoIntegracao: "2" }],
      transporte: { modFrete: "9" },
      itens: [itemDaTela({ cfop: "6102", cst: "90", icms: { proprio: { destacar: true }, diferimento: { pDif: 50 } } })],
    };
    const resultado = await salvarNFeAvulsaDraft(draft);
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assert.match(nota.xml, /<ICMS90>.*<pICMS>20\.0000<\/pICMS><vICMSOp>2200\.00<\/vICMSOp><pDif>50\.0000<\/pDif><vICMSDif>1100\.00<\/vICMSDif><vICMS>1100\.00<\/vICMS>/);
    assert.equal(numero(nota.itens[0].valor_icms_diferido), 1100);
    assert.equal(numero(nota.itens[0].valor_icms), 1100);
    assert.deepEqual(baseIbsCbsNoXml(nota.xml), { item: 9900, total: 9900 });
    assertBancoIgualXml(nota);
  });
});

describe("AVULSA — DIFAL antes do IBS/CBS", () => {
  const naoContribuinte = {
    clienteId: null, tipoPessoa: "FISICA" as const, cpfCnpj: "12345678909", nomeRazaoSocial: "CONSUMIDOR MG",
    indicadorIe: "9", endereco: "RUA", numero: "1", bairro: "CENTRO", cidade: "BELO HORIZONTE", estado: "MG",
    cep: "30110000", codigoMunicipio: "3106200",
  };
  const draft = (item: Partial<NFeAvulsaItemInput>) => ({
    operacao: { tipoOperacao: "SAIDA" as const, naturezaOperacao: "VENDA", finalidade: "NORMAL" as const, destinoMercadoria: "USO_CONSUMO" as const, indicadorPresenca: "1" },
    destinatario: naoContribuinte,
    pagamentos: [{ meio: "01", valor: 11000, tipoIntegracao: "2" }],
    transporte: { modFrete: "9" },
    itens: [itemDaTela({ cfop: "6102", cst: "00", aliquotaIcms: "12", ...item, sourceItemId: item.sourceItemId ?? undefined })],
  });

  it("sem regra fiscal cadastrada e sem FCP informado, a nota não é gerada", async () => {
    const resultado = await salvarNFeAvulsaDraft(draft({}));
    assert.equal(resultado.ok, false);
    const codigos = resultado.errors.map((erro) => (erro as { code?: string }).code);
    // Cada pendência tem código próprio: antes um bloqueio genérico não dizia
    // se faltava a alíquota interna, o FCP, ou se havia conflito de regra.
    assert.ok(
      codigos.includes("NFE_DIFAL_ALIQUOTA_INTERNA_SEM_REGRA"),
      `esperava o bloqueio do fallback de tabela; veio ${JSON.stringify(codigos)}`,
    );
    assert.ok(
      codigos.includes("NFE_DIFAL_FCP_NAO_DETERMINADO"),
      `esperava o bloqueio do FCP indeterminado; veio ${JSON.stringify(codigos)}`,
    );
  });

  it("com DIFAL configurado, a base do IBS/CBS desconta vICMSUFDest e vFCPUFDest", async () => {
    const resultado = await salvarNFeAvulsaDraft(draft({ aliquotaInternaDestino: "18", aliquotaFcpDestino: "2" }));
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    const vICMSUFDest = Number(/<vICMSUFDest>([\d.]+)<\/vICMSUFDest>/.exec(nota.xml)?.[1]);
    const vFCPUFDest = Number(/<vFCPUFDest>([\d.]+)<\/vFCPUFDest>/.exec(nota.xml)?.[1]);
    assert.ok(vICMSUFDest > 0 && vFCPUFDest > 0);
    // 11.000 − ICMS próprio (12%) − DIFAL − FCP de destino
    const esperado = Number((11000 - 1320 - vICMSUFDest - vFCPUFDest).toFixed(2));
    assert.deepEqual(baseIbsCbsNoXml(nota.xml), { item: esperado, total: esperado });
    assert.equal(nota.itens[0].tributacao_snapshot.difalDecisao.origemAliquotaInterna, "ITEM");
  });

  it("o servidor preserva a marca de edição manual que a tela envia", async () => {
    // Antes o overrideDifalManual era descartado em mapInputToTaxItem: o que a
    // pessoa digitava virava "ITEM", e a interestadual digitada entrava no XML
    // sem conferência — foi assim que a NF-e 230 saiu com pICMSInter 0.
    const resultado = await salvarNFeAvulsaDraft(draft({
      aliquotaInternaDestino: "18",
      aliquotaFcpDestino: "2",
      aliquotaInterestadual: "7",
      // Chave desconhecida vinda do cliente não entra no snapshot.
      overrideDifalManual: { aliquotaInterna: true, aliquotaFcp: true, aliquotaInterestadual: true, injetado: true } as Record<string, unknown>,
    }));
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    const decisao = nota.itens[0].tributacao_snapshot.difalDecisao;
    assert.equal(decisao.origemAliquotaInterna, "MANUAL");
    assert.equal(decisao.origemFcp, "MANUAL");
    assert.equal(decisao.origemAliquotaInterestadual, "MANUAL");
    assert.match(nota.xml, /<pICMSInter>7\.00<\/pICMSInter>/);
    assert.deepEqual(
      Object.keys(nota.itens[0].tributacao_snapshot.overrideDifalManual).sort(),
      ["aliquotaFcp", "aliquotaInterestadual", "aliquotaInterna"],
    );
  });

  it("interestadual digitada fora de 4/7/12 não gera a nota", async () => {
    const resultado = await salvarNFeAvulsaDraft(draft({
      aliquotaInternaDestino: "18",
      aliquotaFcpDestino: "2",
      aliquotaInterestadual: "0",
      overrideDifalManual: { aliquotaInterestadual: true },
    }));
    assert.equal(resultado.ok, false);
    const codigos = resultado.errors.map((erro) => (erro as { code?: string }).code);
    assert.ok(codigos.includes("NFE_DIFAL_ALIQUOTA_INTERESTADUAL_INVALIDA"), JSON.stringify(codigos));
  });
});

describe("descrição do item é o xProd da nota", () => {
  const draftComDescricao = (descricao: string) => ({
    operacao: {
      tipoOperacao: "SAIDA" as const,
      naturezaOperacao: "VENDA",
      finalidade: "NORMAL" as const,
      destinoMercadoria: "USO_CONSUMO" as const,
      indicadorPresenca: "1",
    },
    destinatario: {
      clienteId: null, tipoPessoa: "FISICA" as const, cpfCnpj: "12345678909",
      nomeRazaoSocial: "CONSUMIDOR PB", indicadorIe: "9", endereco: "RUA", numero: "1",
      bairro: "CENTRO", cidade: "JOAO PESSOA", estado: "PB", cep: "58000000",
      codigoMunicipio: "2507507",
    },
    pagamentos: [{ meio: "01", valor: 11000, tipoIntegracao: "2" }],
    transporte: { modFrete: "9" },
    itens: [itemDaTela({ cfop: "5102", cst: "00", aliquotaIcms: "12", descricao })],
  });

  it("o texto ajustado na emissão vai para o XML, sem alterar o produto", async () => {
    // O cadastro continua "UNIDADE DE CONTROLE VALVULA APM"; a nota sai com o
    // texto que o operador escreveu para este documento.
    const ajustada = "MODULO INJECAO VOLVO FH 6792 - RECONDICIONADO";
    const resultado = await salvarNFeAvulsaDraft(draftComDescricao(ajustada));

    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assert.match(nota.xml, new RegExp(`<xProd>${ajustada}</xProd>`));
    assert.notEqual(ajustada, produto.titulo);
  });

  it("descrição vazia não gera nota", async () => {
    const resultado = await salvarNFeAvulsaDraft(draftComDescricao("   "));
    assert.equal(resultado.ok, false);
    assert.ok(
      resultado.errors.some((erro) => (erro as { field?: string }).field === "descricao"),
    );
  });

  it("descrição acima do limite do leiaute é recusada antes da SEFAZ", async () => {
    // xProd tem 120 caracteres. Enquanto a descrição vinha do cadastro isso
    // nunca acontecia; digitada na emissão, passa a ser possível.
    const resultado = await salvarNFeAvulsaDraft(draftComDescricao("A".repeat(121)));

    assert.equal(resultado.ok, false);
    const erro = resultado.errors.find((e) => (e as { field?: string }).field === "descricao");
    assert.ok(erro, JSON.stringify(resultado.errors));
    assert.match((erro as { message: string }).message, /120 caracteres/);
  });

  it("exatamente no limite é aceita", async () => {
    const resultado = await salvarNFeAvulsaDraft(draftComDescricao("A".repeat(120)));
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
  });
});

describe("ciência de aviso registrada pelo servidor", () => {
  const input = () => ({
    itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60] })],
    configuracaoFiscal: configuracaoVenda,
    cienciaEscopo: randomUUID(),
  });
  const pedido6403 = () => {
    const [code, fingerprint] = AVISO_6403_CST60.split("@");
    return { itemIndex: 0, code, fingerprint };
  };

  it("a chave certa no payload, sem registro no servidor, não libera a nota", async () => {
    const resultado = await venda(input());
    assert.equal(resultado.ok, false);
    const [erro] = resultado.errors as Array<{ code?: string; requerCiencia?: boolean }>;
    assert.equal(erro.code, "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO");
    assert.equal(erro.requerCiencia, true);
    assert.equal(banco.tabela("nfe").length, 0);
  });

  it("registra quem, quando, a mensagem, os dados e a regra, sem gravar nada da NF-e", async () => {
    const dados = input();
    const registro = await venda(dados, { registrarCiencia: { atorId: ATOR, pedidos: [pedido6403()] } });
    const ciencia = (registro as { ciencia?: ResultadoRegistroCiencia }).ciencia;
    assert.equal(registro.ok, false);
    assert.deepEqual(ciencia?.registradas.map((item) => item.code), ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"]);
    assert.equal(banco.tabela("nfe").length, 0);
    assert.equal(banco.tabela("nfe_item").length, 0);

    const [linha] = banco.tabela("nfe_ciencia_aviso");
    assert.equal(linha.usuario_id, ATOR);
    assert.equal(linha.escopo, dados.cienciaEscopo);
    assert.equal(linha.item_ref, "venda:164:183");
    assert.equal(linha.origem_tipo, "VENDA");
    assert.equal(linha.origem_id, 164);
    assert.equal(`${linha.code}@${linha.fingerprint}`, AVISO_6403_CST60);
    assert.match(linha.mensagem, /6403/);
    assert.equal(linha.dados.cfop, "6403");
    assert.equal(linha.dados.codigoIcms, "60");
    assert.ok(linha.fontes.length > 0);
    assert.match(linha.versao_regra, /^regras_nfe@/);
    assert.equal(linha.nfe_id, null);

    const salvo = await venda(dados);
    assert.ok(salvo.ok, JSON.stringify(!salvo.ok && salvo.errors));
    assert.equal(banco.tabela("nfe_ciencia_aviso")[0].nfe_id, salvo.nfeId);
  });

  it("repetir o clique não duplica a ciência", async () => {
    const dados = input();
    await venda(dados, { registrarCiencia: { atorId: ATOR, pedidos: [pedido6403()] } });
    const segunda = await venda(dados, { registrarCiencia: { atorId: ATOR, pedidos: [pedido6403()] } });
    const ciencia = (segunda as { ciencia?: ResultadoRegistroCiencia }).ciencia;
    assert.equal(ciencia?.registradas.length, 0);
    assert.equal(ciencia?.jaRegistradas.length, 1);
    assert.equal(banco.tabela("nfe_ciencia_aviso").length, 1);
  });

  it("pedido forjado (fingerprint de outra situação, item inexistente, INFO) é recusado e não grava", async () => {
    const [code6404, fp6404] = AVISO_6404_CST60.split("@");
    const registro = await venda(input(), {
      registrarCiencia: {
        atorId: ATOR,
        pedidos: [
          { itemIndex: 0, code: code6404, fingerprint: fp6404 },
          { itemIndex: 7, code: "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO", fingerprint: pedido6403().fingerprint },
          { itemIndex: 0, code: "NFE_ST_RETIDA_POLITICA_UF", fingerprint: "fp1.qualquer" },
        ],
      },
    });
    const ciencia = (registro as { ciencia?: ResultadoRegistroCiencia }).ciencia;
    assert.equal(ciencia?.recusadas.length, 3);
    assert.equal(ciencia?.registradas.length, 0);
    assert.equal(banco.tabela("nfe_ciencia_aviso").length, 0);
  });

  it("ciência de outra sessão de emissão não vale para esta", async () => {
    const primeira = input();
    await venda(primeira, { registrarCiencia: { atorId: ATOR, pedidos: [pedido6403()] } });
    const outraSessao = { ...primeira, cienciaEscopo: randomUUID() };
    const resultado = await venda(outraSessao);
    assert.equal(resultado.ok, false);
  });

  it("reabrir a nota salva aceita a ciência já ligada a ela", async () => {
    const dados = input();
    const salvo = await comCiencia(venda, dados);
    assert.ok(salvo.ok);
    const reaberto = await venda({ ...dados, nfeId: salvo.nfeId, cienciaEscopo: randomUUID() });
    assert.ok(reaberto.ok, JSON.stringify(!reaberto.ok && reaberto.errors));
  });

  /** O usuário muda o item e confirma o aviso novo, como a tela faria. */
  async function confirmarPendenteDoServidor(dados: NFeOrigemDraftInput) {
    const pendente = await venda(dados);
    assert.equal(pendente.ok, false);
    const [erro] = pendente.errors as unknown as Array<{ code: string; fingerprint: string; requerCiencia?: boolean }>;
    assert.equal(erro.requerCiencia, true, JSON.stringify(pendente.errors));
    await venda(dados, {
      registrarCiencia: { atorId: ATOR, pedidos: [{ itemIndex: 0, code: erro.code, fingerprint: erro.fingerprint }] },
    });
    return `${erro.code}@${erro.fingerprint}`;
  }

  it("só a ciência usada na situação final é ligada à NF-e; a de uma situação abandonada fica sem nota", async () => {
    // 1-2. 6403 + CST 60: aviso A, confirmado.
    const dados = input();
    await venda(dados, { registrarCiencia: { atorId: ATOR, pedidos: [pedido6403()] } });
    // 3-4. O usuário troca o CST: A some, aparece B (mesmo código, outra situação).
    const cst00 = { ...dados, itens: [itemDaTela({ cst: "00", avisosFiscaisConfirmados: [] })] };
    const chaveB = await confirmarPendenteDoServidor(cst00);
    assert.notEqual(chaveB, AVISO_6403_CST60);
    // 5. Salva.
    const salvo = await venda(cst00);
    assert.ok(salvo.ok, JSON.stringify(!salvo.ok && salvo.errors));

    const linhas = banco.tabela("nfe_ciencia_aviso");
    const a = linhas.find((linha) => `${linha.code}@${linha.fingerprint}` === AVISO_6403_CST60);
    const b = linhas.find((linha) => `${linha.code}@${linha.fingerprint}` === chaveB);
    assert.ok(a && b);
    assert.equal(a.nfe_id, null, "ciência de situação abandonada não pode aparecer como usada na nota");
    assert.equal(b.nfe_id, salvo.nfeId);
    // Tabela e snapshot contam a mesma história.
    const nota = notaGravada(salvo.nfeId);
    assert.deepEqual(
      nota.itens[0].tributacao_snapshot.icmsDecisao.avisosConfirmados.map(
        (aviso: { ciencia: { id: number } }) => aviso.ciencia.id,
      ),
      [b.id],
    );
  });

  it("ciência registrada ao editar uma nota salva só é ligada a ela quando libera o aviso", async () => {
    const dados = input();
    const salvo = await comCiencia(venda, dados);
    assert.ok(salvo.ok);
    const edicao = {
      ...dados,
      nfeId: salvo.nfeId,
      cienciaEscopo: randomUUID(),
      itens: [itemDaTela({ cst: "00", avisosFiscaisConfirmados: [] })],
    };
    const chaveB = await confirmarPendenteDoServidor(edicao);
    const b = () => banco.tabela("nfe_ciencia_aviso").find((linha) => `${linha.code}@${linha.fingerprint}` === chaveB);
    assert.equal(b()?.nfe_id, null);
    const resalvo = await venda(edicao);
    assert.ok(resalvo.ok, JSON.stringify(!resalvo.ok && resalvo.errors));
    assert.equal(b()?.nfe_id, salvo.nfeId);
  });

  it("registro com o motor bloqueado devolve os erros e não grava ciência", async () => {
    const registro = await venda(
      { ...input(), configuracaoFiscal: { ...configuracaoVenda, destinoMercadoria: null } },
      { registrarCiencia: { atorId: ATOR, pedidos: [pedido6403()] } },
    );
    assert.equal((registro as { ciencia?: unknown }).ciencia, undefined);
    assert.ok(registro.errors.length > 0);
    assert.equal(banco.tabela("nfe_ciencia_aviso").length, 0);
  });
});
