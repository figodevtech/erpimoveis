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
import { salvarNFeAvulsaDraft, type NFeAvulsaDraftInput, type NFeAvulsaItemInput } from "./nfeAvulsaService";
import { salvarNFeDeOrigem, statusOcupaOrigem } from "./nfeOrigemService";
import { salvarNFeDaSaida } from "./nfeSaidaService";

const AVISO_6403_CST60 = "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO";

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
    avisosFiscaisConfirmados: ["NFE_ST_RETIDA_POLITICA_UF", "NFE_ICMS_EFETIVO_POLITICA_UF"],
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
  it("permite novo rascunho quando a mesma venda já tem NF-e autorizada", async () => {
    const input = {
      itens: [itemDaTela({
        avisosFiscaisConfirmados: [
          AVISO_6403_CST60,
          "NFE_ST_RETIDA_POLITICA_UF",
          "NFE_ICMS_EFETIVO_POLITICA_UF",
        ],
      })],
      configuracaoFiscal: configuracaoVenda,
    };
    const primeira = await salvarNFeDeOrigem("VENDA", 164, input);
    assert.ok(primeira.ok, JSON.stringify(!primeira.ok && primeira.errors));
    const notaExistente = banco.tabela("nfe").find((nota) => Number(nota.id) === primeira.nfeId);
    assert.ok(notaExistente);
    notaExistente.status = "AUTORIZADA";
    notaExistente.numero = 136;

    const segunda = await salvarNFeDeOrigem("VENDA", 164, input);

    assert.ok(segunda.ok, JSON.stringify(!segunda.ok && segunda.errors));
    assert.notEqual(segunda.nfeId, primeira.nfeId);
    assert.equal(banco.tabela("nfe").filter((nota) => Number(nota.vendaid) === 164).length, 2);
  });

  it("6403 com CST 60 não sai sem a ciência do usuário, e o CST não é trocado", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, { itens: [itemDaTela()], configuracaoFiscal: configuracaoVenda });
    assert.equal(resultado.ok, false);
    const [erro] = resultado.errors as Array<{ code?: string; requerCiencia?: boolean }>;
    assert.equal(erro.code, AVISO_6403_CST60);
    assert.equal(erro.requerCiencia, true);
    assert.equal(banco.tabela("nfe").length, 0);
  });

  it("com a ciência, grava ICMS60 sem ICMS próprio no banco, no XML e nos totais", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60, "NFE_ST_RETIDA_POLITICA_UF", "NFE_ICMS_EFETIVO_POLITICA_UF"] })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.equal(resultado.ok, true, JSON.stringify(resultado.errors));
    const nota = notaGravada(resultado.ok ? resultado.nfeId : 0);
    assertRegressao136(nota);
    assert.deepEqual(
      nota.itens[0].tributacao_snapshot.icmsDecisao.avisosConfirmados.map((aviso: { code: string }) => aviso.code),
      [AVISO_6403_CST60, "NFE_ST_RETIDA_POLITICA_UF"],
    );
    assert.match(nota.xml, /<CFOP>6403<\/CFOP>/);
    assert.equal(nota.nfe.decisao_fiscal.icms[0].grupoXmlIcms, "ICMS60");
  });

  it("não presume consumidor final: sem destino a nota não é gerada", async () => {
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60, "NFE_ST_RETIDA_POLITICA_UF", "NFE_ICMS_EFETIVO_POLITICA_UF"] })],
      configuracaoFiscal: { ...configuracaoVenda, destinoMercadoria: null },
    });
    assert.equal(resultado.ok, false);
    assert.ok(resultado.errors.some((erro) => erro.field === "destinoMercadoria"));
  });

  it("o indFinal sai do destino escolhido, não do tipo de origem", async () => {
    const revenda = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60, "NFE_ST_RETIDA_POLITICA_UF", "NFE_ICMS_EFETIVO_POLITICA_UF"] })],
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

describe("OS — mesmo núcleo", () => {
  const itemOs = (overrides: SemOrigem = {}) => itemDaTela({ sourceItemId: "os:50:1964", ...overrides });

  it("regressão da NF-e 136 pela OS", async () => {
    const resultado = await salvarNFeDeOrigem("OS", 50, {
      itens: [itemOs({ avisosFiscaisConfirmados: [AVISO_6403_CST60, "NFE_ST_RETIDA_POLITICA_UF", "NFE_ICMS_EFETIVO_POLITICA_UF"] })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    assertRegressao136(notaGravada(resultado.nfeId));
  });

  it("CST 00 pela OS", async () => {
    const resultado = await salvarNFeDeOrigem("OS", 50, {
      itens: [itemOs({ cfop: "6102", cst: "00" })],
      configuracaoFiscal: { ...configuracaoVenda, destinoMercadoria: "USO_CONSUMO" },
    });
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    const nota = notaGravada(resultado.nfeId);
    assert.equal(numero(nota.itens[0].valor_icms), 2200);
    // Contribuinte comprando para uso próprio: consumidor final por decisão, não por presunção.
    assert.match(nota.xml, /<indFinal>1<\/indFinal>/);
    assertBancoIgualXml(nota);
  });

  it("CST 60 com base de ICMS próprio informada é recusado com a explicação", async () => {
    const resultado = await salvarNFeDeOrigem("OS", 50, {
      itens: [itemOs({
        cfop: "6404",
        icms: { proprio: { vBC: 11000, vICMS: 2200 } },
      })],
      configuracaoFiscal: configuracaoVenda,
    });
    assert.equal(resultado.ok, false);
    const erro = resultado.errors.find((item) => (item as { code?: string }).code === "NFE_ICMS_BLOCO_PROIBIDO_PROPRIO");
    assert.ok(erro);
    assert.match(erro.message, /O CST 60 utiliza o grupo de ICMS cobrado anteriormente por substituição tributária/);
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

  it("regressão da NF-e 136 pela avulsa", async () => {
    const resultado = await salvarNFeAvulsaDraft(draftAvulso([itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60, "NFE_ST_RETIDA_POLITICA_UF", "NFE_ICMS_EFETIVO_POLITICA_UF"] })]));
    assert.ok(resultado.ok, JSON.stringify(!resultado.ok && resultado.errors));
    assertRegressao136(notaGravada(resultado.nfeId));
  });

  it("CST 60 com ST retida informada vai para as colunas próprias e para o XML", async () => {
    const resultado = await salvarNFeAvulsaDraft(draftAvulso([itemDaTela({
      cfop: "6404",
      icms: { stRetida: { vBCSTRet: 13200, pST: 18, vICMSSTRet: 1656, vICMSSubstituto: 720 } },
      avisosFiscaisConfirmados: [
        AVISO_6403_CST60,
        "NFE_ST_RETIDA_POLITICA_UF",
        "NFE_ICMS_EFETIVO_POLITICA_UF",
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
    const resultado = await salvarNFeAvulsaDraft(draftAvulso([
      itemDaTela({
        cfop: "6404",
        avisosFiscaisConfirmados: [
          AVISO_6403_CST60,
          "NFE_ST_RETIDA_POLITICA_UF",
          "NFE_ICMS_EFETIVO_POLITICA_UF",
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
    const resultado = await salvarNFeDeOrigem("VENDA", 164, {
      itens: [itemDaTela({ avisosFiscaisConfirmados: [AVISO_6403_CST60, "NFE_ST_RETIDA_POLITICA_UF"] })],
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

  it("sem alíquota interna e FCP configurados, a nota não é gerada (a tabela por UF é só referência)", async () => {
    const resultado = await salvarNFeAvulsaDraft(draft({}));
    assert.equal(resultado.ok, false);
    assert.ok(resultado.errors.some((erro) => (erro as { code?: string }).code === "NFE_DIFAL_CONFIGURACAO_REQUIRED"));
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
});
