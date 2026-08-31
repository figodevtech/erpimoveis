import assert from "node:assert/strict";
import test from "node:test";

import type { OperationalEvent, OperationalEventDetail } from "./contracts";
import {
  buildIndisponivelDetail,
  buildOperationalEventDetail,
  formatarDuracao,
  parseOperationalEntityId,
  resumirErrosNfse,
  rotuloDeStatus,
  situacaoDeEstoque,
  type DetailGrants,
  type OperationalDetailSource,
} from "./event-detail-view";

const GERADO_EM = "2026-08-28T12:00:00.000Z";

const TUDO: DetailGrants = { verCliente: true, verFinanceiro: true, verVendas: true };
const NADA: DetailGrants = { verCliente: false, verFinanceiro: false, verVendas: false };

function eventoDe(overrides: Partial<OperationalEvent> = {}): OperationalEvent {
  return {
    id: "3f2b8c1e-6d4a-4f1b-9c2e-8a7d5b3f1e04",
    tipo: "OS_FINALIZADA",
    modulo: "ORDENS",
    entidadeTipo: "ORDEM_SERVICO",
    entidadeId: "123",
    titulo: "OS #123 finalizada",
    descricao: null,
    valor: null,
    quantidade: null,
    prioridade: "INFO",
    metadata: { status: "CONCLUIDO" },
    ocorridoEm: "2026-08-28T11:00:00.000Z",
    ...overrides,
  };
}

/**
 * Dados pessoais que NUNCA podem sair no detalhe, plantados de propósito nas
 * fixtures. São strings improváveis para que a busca no payload serializado não
 * dê falso positivo.
 */
const SEGREDOS = [
  "12345678901",
  "84999990000",
  "cliente@exemplo.com",
  "Rua das Laranjeiras",
  "PAYLOAD-TOMADOR-SIGILOSO",
];

/** Todo builder recebe a mesma poluição, para o teste valer para os seis. */
function poluir<T extends Record<string, unknown>>(linha: T) {
  return {
    ...linha,
    cpfcnpj: SEGREDOS[0],
    telefone: SEGREDOS[1],
    email: SEGREDOS[2],
    endereco: SEGREDOS[3],
    payload_enviado: SEGREDOS[4],
    retorno_bruto: SEGREDOS[4],
    url_pdf: "https://prefeitura.exemplo/nfse.pdf",
  };
}

const FONTES: Array<{ nome: string; evento: OperationalEvent; fonte: OperationalDetailSource }> = [
  {
    nome: "ORDEM_SERVICO",
    evento: eventoDe(),
    fonte: {
      entidadeTipo: "ORDEM_SERVICO",
      produtos: 3,
      servicos: 2,
      ordem: poluir({
        id: 123,
        status: "CONCLUIDO",
        descricao: "Revisão completa",
        dataentrada: "2026-08-27T12:00:00.000Z",
        execucao_inicio_em: "2026-08-28T09:00:00.000Z",
        execucao_fim_em: "2026-08-28T12:20:00.000Z",
        orcamentototal: 1250,
        veiculo: { id: 7, placa: "ABC1D23", marca: "VW", modelo: "Gol", cor: "Prata", kmatual: 90000 },
        cliente: { nomerazaosocial: "Maria Souza" },
        transacoes: [{ tipo: "RECEITA", pendente: false, valor: 500, valor_baixado: 0 }],
      }) as never,
    },
  },
  {
    nome: "VENDA",
    evento: eventoDe({ tipo: "VENDA_CONFIRMADA", modulo: "VENDAS", entidadeTipo: "VENDA", valor: 800 }),
    fonte: {
      entidadeTipo: "VENDA",
      venda: poluir({
        id: 55,
        status: "PAGO",
        valortotal: 800,
        datavenda: "2026-08-28T10:00:00.000Z",
        cliente: { nomerazaosocial: "Maria Souza" },
        vendedor_rel: { nome: "João Vendedor" },
        itens: [{ id: 1 }, { id: 2 }],
        transacoes: [],
      }) as never,
    },
  },
  {
    nome: "TRANSACAO",
    evento: eventoDe({
      tipo: "PIX_RECEBIDO",
      modulo: "FINANCEIRO",
      entidadeTipo: "TRANSACAO",
      valor: 300,
    }),
    fonte: {
      entidadeTipo: "TRANSACAO",
      transacao: poluir({
        id: 9001,
        descricao: "Pagamento OS #123",
        tipo: "RECEITA",
        pendente: false,
        metodopagamento: "PIX",
        valor: 300,
        banco: { titulo: "Conta corrente" },
        cliente: { nomerazaosocial: "Maria Souza" },
        fornecedor: null,
      }) as never,
      ordem: { id: 123, status: "CONCLUIDO", total: 1250 },
      venda: null,
    },
  },
  {
    nome: "PRODUTO",
    evento: eventoDe({
      tipo: "ESTOQUE_BAIXO",
      modulo: "ESTOQUE",
      entidadeTipo: "PRODUTO",
      quantidade: 2,
      prioridade: "ATENCAO",
      metadata: { estoqueAtual: 2, estoqueMinimo: 5 },
    }),
    fonte: {
      entidadeTipo: "PRODUTO",
      produto: poluir({
        id: 42,
        titulo: "Filtro de óleo",
        unidade: "un",
        estoque: 2,
        estoqueminimo: 5,
        precovenda: 39.9,
        precocompra: 18.5,
      }) as never,
    },
  },
  {
    nome: "NFE",
    evento: eventoDe({
      tipo: "NFE_REJEITADA",
      modulo: "FISCAL",
      entidadeTipo: "NFE",
      prioridade: "CRITICO",
    }),
    fonte: {
      entidadeTipo: "NFE",
      nfe: poluir({
        id: 12,
        numero: 907,
        status: "REJEITADA",
        total_nfe: 1250,
        codigo_rejeicao: "539",
        motivo_rejeicao: "Duplicidade de NF-e",
        cliente: { nomerazaosocial: "Maria Souza" },
      }) as never,
    },
  },
  {
    nome: "NFSE",
    evento: eventoDe({ tipo: "NFSE_AUTORIZADA", modulo: "FISCAL", entidadeTipo: "NFSE" }),
    fonte: {
      entidadeTipo: "NFSE",
      nfse: poluir({
        id: 8,
        numero: "2026/44",
        status: "AUTORIZADA",
        valor_total: 480,
        erros: null,
        cliente: { nomerazaosocial: "Maria Souza" },
      }) as never,
    },
  },
];

/* ------------------------------------------------------------------ */

test("nenhum builder deixa escapar documento, contato, endereço ou payload fiscal", () => {
  for (const { nome, evento, fonte } of FONTES) {
    for (const grants of [TUDO, NADA]) {
      const serializado = JSON.stringify(
        buildOperationalEventDetail(evento, fonte, grants, GERADO_EM),
      );
      for (const segredo of SEGREDOS) {
        assert.ok(
          !serializado.includes(segredo),
          `${nome} vazou "${segredo}" com verCliente=${grants.verCliente}`,
        );
      }
      assert.ok(!serializado.includes("url_pdf"), `${nome} expôs url_pdf`);
    }
  }
});

test("o nome do cliente só aparece com clientes:visualizar", () => {
  for (const { nome, evento, fonte } of FONTES) {
    const comPermissao = JSON.stringify(
      buildOperationalEventDetail(evento, fonte, TUDO, GERADO_EM),
    );
    const semPermissao = buildOperationalEventDetail(evento, fonte, NADA, GERADO_EM);

    // PRODUTO não tem cliente nenhum — nem nome, nem restrição a declarar.
    if (nome === "PRODUTO") {
      assert.ok(!semPermissao.restricoes.includes("CLIENTE_SEM_PERMISSAO"));
      continue;
    }

    assert.ok(comPermissao.includes("Maria Souza"), `${nome} deveria mostrar o nome`);
    assert.ok(
      !JSON.stringify(semPermissao).includes("Maria Souza"),
      `${nome} mostrou o nome sem permissão`,
    );
    assert.equal(
      semPermissao.restricoes.filter((r) => r === "CLIENTE_SEM_PERMISSAO").length,
      1,
      `${nome} deveria declarar a restrição uma única vez`,
    );
  }
});

test("todo detalhe montado satisfaz o contrato", () => {
  for (const { evento, fonte } of FONTES) {
    const detalhe = buildOperationalEventDetail(evento, fonte, TUDO, GERADO_EM);
    assert.equal(detalhe.estado, "DISPONIVEL");
    assert.ok(detalhe.indicadores.length <= 4);
    assert.ok(detalhe.secoes.length <= 6);
    assert.ok(detalhe.vinculos.length <= 6);
    for (const secao of detalhe.secoes) {
      assert.ok(secao.campos.length > 0, "seção vazia não deveria ser emitida");
      for (const campo of secao.campos) {
        assert.notEqual(campo.texto === null, campo.numero === null);
      }
    }
  }
});

/* ------------------------------------------------------------------ */

test("parseOperationalEntityId respeita o tipo da coluna de destino", () => {
  assert.equal(parseOperationalEntityId("ORDEM_SERVICO", "123"), "123");
  assert.equal(parseOperationalEntityId("ORDEM_SERVICO", ""), null);
  assert.equal(parseOperationalEntityId("ORDEM_SERVICO", "abc"), null);
  assert.equal(parseOperationalEntityId("ORDEM_SERVICO", "0"), null);
  assert.equal(parseOperationalEntityId("ORDEM_SERVICO", "-1"), null);
  assert.equal(parseOperationalEntityId("ORDEM_SERVICO", "1.5"), null);
  // Acima do teto de `integer` no Postgres.
  assert.equal(parseOperationalEntityId("ORDEM_SERVICO", "2147483648"), null);

  // `transacao.id` é bigint: precisa passar inteiro, sem virar Number.
  const grande = "9007199254740993";
  assert.equal(parseOperationalEntityId("TRANSACAO", grande), grande);
  assert.equal(parseOperationalEntityId("TRANSACAO", "0"), null);
  assert.equal(parseOperationalEntityId("TRANSACAO", "12a"), null);
});

test("a OS separa o total do detalhamento financeiro", () => {
  const fonte = FONTES[0].fonte;
  const evento = FONTES[0].evento;

  const semFinanceiro = buildOperationalEventDetail(evento, fonte, NADA, GERADO_EM);
  assert.deepEqual(
    semFinanceiro.indicadores.map((i) => i.chave),
    ["os.total"],
  );
  assert.ok(semFinanceiro.restricoes.includes("FINANCEIRO_SEM_PERMISSAO"));

  const comFinanceiro = buildOperationalEventDetail(evento, fonte, TUDO, GERADO_EM);
  assert.deepEqual(
    comFinanceiro.indicadores.map((i) => i.chave),
    ["os.total", "os.recebido", "os.saldo"],
  );
  assert.equal(comFinanceiro.indicadores[1].valor, 500);
});

test("OS migrada renderiza o veículo pelo snapshot histórico", () => {
  const detalhe = buildOperationalEventDetail(
    eventoDe(),
    {
      entidadeTipo: "ORDEM_SERVICO",
      produtos: 0,
      servicos: 0,
      ordem: {
        id: 900,
        status: "CONCLUIDO",
        veiculo: null,
        veiculo_snapshot: { placa: "XYZ9K88", marca: "Fiat", modelo: "Uno", cor: "Branco" },
        transacoes: [],
      },
    },
    TUDO,
    GERADO_EM,
  );

  const veiculo = detalhe.secoes.find((secao) => secao.id === "veiculo");
  assert.ok(veiculo, "a seção de veículo deveria existir");
  assert.equal(veiculo.campos.find((c) => c.chave === "os.placa")?.texto, "XYZ9K88");
  assert.equal(
    veiculo.campos.find((c) => c.chave === "os.historico")?.texto,
    "Dados históricos da OS migrada",
  );
});

test("a transação distingue baixa parcial, transferência e origem", () => {
  const evento = eventoDe({ tipo: "CONTA_CRIADA", modulo: "CONTAS_PAGAR", entidadeTipo: "TRANSACAO" });

  const parcial = buildOperationalEventDetail(
    evento,
    {
      entidadeTipo: "TRANSACAO",
      transacao: {
        id: 5,
        tipo: "DESPESA",
        pendente: true,
        valor: 1000,
        valor_baixado: 400,
        ordemservicoid: 77,
      },
      ordem: { id: 77, status: "EM_ANDAMENTO", total: 1000 },
    },
    TUDO,
    GERADO_EM,
  );
  assert.equal(parcial.status?.codigo, "BAIXA_PARCIAL");
  assert.equal(parcial.indicadores.find((i) => i.chave === "transacao.aberto")?.valor, 600);
  assert.equal(parcial.subtitulo, "Origem: ordem de serviço");

  const transferencia = buildOperationalEventDetail(
    evento,
    {
      entidadeTipo: "TRANSACAO",
      transacao: { id: 6, tipo: "SAQUE", pendente: false, valor: 200, transferencia_id: 3 },
    },
    TUDO,
    GERADO_EM,
  );
  const natureza = transferencia.secoes.find((secao) => secao.id === "natureza");
  assert.equal(natureza?.campos[0]?.texto, "Transferência entre contas");
});

test("vínculo de venda fica sem status, valor e link sem vendas:visualizar", () => {
  const evento = eventoDe({ tipo: "PAGAMENTO_RECEBIDO", modulo: "FINANCEIRO", entidadeTipo: "TRANSACAO" });
  const fonte: OperationalDetailSource = {
    entidadeTipo: "TRANSACAO",
    transacao: { id: 7, tipo: "RECEITA", pendente: false, valor: 90, vendaid: 31 },
    venda: { id: 31, status: "PAGO", total: 90 },
  };

  const sem = buildOperationalEventDetail(evento, fonte, { ...TUDO, verVendas: false }, GERADO_EM);
  const vinculoSem = sem.vinculos.find((v) => v.tipo === "VENDA");
  assert.equal(vinculoSem?.rotulo, "Venda #31");
  assert.equal(vinculoSem?.detalhe, null);
  assert.equal(vinculoSem?.valor, null);
  assert.equal(vinculoSem?.href, null);
  assert.ok(sem.restricoes.includes("VENDAS_SEM_PERMISSAO"));

  const com = buildOperationalEventDetail(evento, fonte, TUDO, GERADO_EM);
  const vinculoCom = com.vinculos.find((v) => v.tipo === "VENDA");
  assert.equal(vinculoCom?.valor, 90);
  assert.equal(vinculoCom?.href, "/print/venda/31/orcamento");
});

test("o produto esconde custo sem financeiro e avisa movimento posterior", () => {
  const fonte = FONTES[3].fonte;
  const evento = FONTES[3].evento;

  const sem = buildOperationalEventDetail(evento, fonte, NADA, GERADO_EM);
  assert.ok(!JSON.stringify(sem).includes("produto.preco_compra"));
  assert.ok(sem.restricoes.includes("FINANCEIRO_SEM_PERMISSAO"));

  const com = buildOperationalEventDetail(evento, fonte, TUDO, GERADO_EM);
  assert.ok(JSON.stringify(com).includes("produto.preco_compra"));

  // O evento registrou saldo 2 e o produto ainda está em 2: sem aviso.
  const secaoEstoque = com.secoes.find((secao) => secao.id === "estoque");
  assert.ok(!secaoEstoque?.campos.some((c) => c.chave === "produto.movimento_posterior"));

  // Mesmo produto, evento que registrou outro saldo: o card avisa.
  const defasado = buildOperationalEventDetail(
    { ...evento, metadata: { estoqueAtual: 9, estoqueMinimo: 5 } },
    fonte,
    TUDO,
    GERADO_EM,
  );
  const aviso = defasado.secoes
    .find((secao) => secao.id === "estoque")
    ?.campos.find((c) => c.chave === "produto.movimento_posterior");
  assert.ok(aviso?.texto?.includes("9"));
});

test("a NF-e só abre a seção de rejeição quando foi rejeitada", () => {
  const rejeitada = buildOperationalEventDetail(FONTES[4].evento, FONTES[4].fonte, TUDO, GERADO_EM);
  const secaoRejeicao = rejeitada.secoes.find((secao) => secao.id === "rejeicao");
  assert.equal(secaoRejeicao?.campos.find((c) => c.chave === "nfe.codigo_rejeicao")?.texto, "539");

  const autorizada = buildOperationalEventDetail(
    FONTES[4].evento,
    {
      entidadeTipo: "NFE",
      nfe: { id: 12, numero: 907, status: "AUTORIZADA", total_nfe: 1250 },
    },
    TUDO,
    GERADO_EM,
  );
  assert.ok(!autorizada.secoes.some((secao) => secao.id === "rejeicao"));
});

/* ------------------------------------------------------------------ */

test("situacaoDeEstoque acompanha a régua do gatilho", () => {
  assert.equal(situacaoDeEstoque(10, 5), "NORMAL");
  assert.equal(situacaoDeEstoque(5, 5), "BAIXO");
  assert.equal(situacaoDeEstoque(1, 5), "BAIXO");
  assert.equal(situacaoDeEstoque(0, 5), "ZERADO");
  assert.equal(situacaoDeEstoque(-3, 5), "ZERADO");
});

test("resumirErrosNfse aceita as formas soltas do retorno e trunca", () => {
  assert.equal(resumirErrosNfse(null), null);
  assert.equal(resumirErrosNfse([]), null);
  assert.equal(resumirErrosNfse("falhou"), "falhou");
  assert.equal(resumirErrosNfse([{ mensagem: "código 42" }]), "código 42");
  assert.equal(resumirErrosNfse([{ message: "code 42" }]), "code 42");
  assert.equal(resumirErrosNfse(["primeiro", "segundo"]), "primeiro");
  assert.equal(resumirErrosNfse([{ semNada: true }]), null);

  const gigante = resumirErrosNfse("x".repeat(5_000));
  assert.equal(gigante?.length, 200);
  assert.ok(gigante?.endsWith("…"));
});

test("formatarDuracao e rotuloDeStatus", () => {
  assert.equal(formatarDuracao("2026-08-28T09:00:00Z", "2026-08-28T12:20:00Z"), "3h20");
  assert.equal(formatarDuracao("2026-08-28T09:00:00Z", null), null);
  // Fim antes do início não é duração; é dado inconsistente.
  assert.equal(formatarDuracao("2026-08-28T12:00:00Z", "2026-08-28T09:00:00Z"), null);

  // O código no banco é ASCII (`ORCAMENTO_APROVADO`) e o rótulo não inventa
  // acento — mesma escolha do `fmtEnum` das telas de impressão.
  assert.equal(rotuloDeStatus("ORCAMENTO_APROVADO"), "Orcamento Aprovado");
  assert.equal(rotuloDeStatus("EM_ANDAMENTO"), "Em Andamento");
  assert.equal(rotuloDeStatus(null), null);
});

test("evento órfão rende um detalhe legível em vez de erro", () => {
  const detalhe: OperationalEventDetail = buildIndisponivelDetail(
    eventoDe({
      titulo: "OS #999 finalizada",
      valor: 400,
      // `jsonb_strip_nulls` faz as chaves de vínculo virem AUSENTES, não nulas.
      metadata: { status: "CONCLUIDO", ordemServicoId: 999 },
    }),
    "ORDEM_SERVICO",
    GERADO_EM,
  );

  assert.equal(detalhe.estado, "ENTIDADE_INDISPONIVEL");
  assert.equal(detalhe.status, null);
  assert.equal(detalhe.vinculos[0]?.rotulo, "OS #999");
  assert.ok(detalhe.secoes[0]?.campos.some((c) => c.chave === "evento.valor"));

  // Sem nenhuma chave de vínculo na metadata, não inventa vínculo.
  const semVinculo = buildIndisponivelDetail(eventoDe({ metadata: {} }), "VENDA", GERADO_EM);
  assert.deepEqual(semVinculo.vinculos, []);
});
