import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comoMovimentoAnalisado,
  conflitosDeSelecao,
  dataDaTransacao,
  decisaoCompleta,
  decisoesIniciais,
  descricaoMovimento,
  formatarDia,
  resolvido,
} from "./apresentacao";
import type { Decisao, MovimentoAnalisado, MovimentoGravado } from "./types";

const movimento = (
  situacao: MovimentoAnalisado["analise"]["situacao"],
  statusGravado: string | null = null,
): MovimentoAnalisado => ({
  sequencia: 1,
  tipoOfx: "DEBIT",
  dataPostagem: "2026-08-04",
  dataDisponivel: null,
  valorCentavos: -10000,
  fitid: "original",
  checknum: null,
  refnum: null,
  nome: null,
  memo: "PAGAMENTO DE BOLETO 123456",
  fingerprint: situacao,
  jaImportado: Boolean(statusGravado),
  movimentoId: null,
  statusGravado,
  metodoSugerido: "BOLETO",
  analise: {
    situacao,
    score: 100,
    acaoSugerida: situacao === "MATCH_EXATO" ? "VINCULAR" : "LIQUIDAR",
    observacao: null,
    sugestoes: [
      {
        transacaoId: 1,
        origem: "FLUXO",
        score: 100,
        diferencaEmDias: 0,
        parcial: false,
        valorCentavos: 10000,
        descricao: "Energia",
        tipo: "DESPESA",
        data: "2026-08-04",
        metodopagamento: "BOLETO",
        contraparte: null,
        ordemservicoid: null,
        vendaid: null,
      },
    ],
  },
});

test("somente matches exatos pendentes têm decisão inicial, mesmo com método sugerido", () => {
  const linhas = [
    movimento("MATCH_EXATO"),
    movimento("MATCH_PROVAVEL"),
    movimento("AMBIGUO"),
    movimento("REVISAO_MANUAL"),
    movimento("SEM_CORRESPONDENCIA"),
  ];
  assert.deepEqual(Object.keys(decisoesIniciais(linhas)), ["MATCH_EXATO"]);
  assert.deepEqual(
    decisoesIniciais([movimento("MATCH_EXATO", "CONCILIADO")]),
    {},
  );
});

test("baixa sem método e criação incompleta não podem entrar na confirmação", () => {
  assert.equal(
    decisaoCompleta({ fingerprint: "a", acao: "LIQUIDAR", transacaoId: 1 }),
    false,
  );
  assert.equal(
    decisaoCompleta({
      fingerprint: "a",
      acao: "CRIAR",
      metodopagamento: "PIX",
      nova: { descricao: "   ", tipo: "DESPESA" },
    }),
    false,
  );
  assert.equal(
    decisaoCompleta({
      fingerprint: "a",
      acao: "LIQUIDAR",
      transacaoId: 1,
      metodopagamento: "PIX",
    }),
    true,
  );
  assert.equal(decisaoCompleta({ fingerprint: "a", acao: "IGNORAR" }), true);
});

test("dois vínculos na mesma transação são sinalizados, sem bloquear baixas parciais legítimas", () => {
  const vinculos: Decisao[] = [
    { fingerprint: "a", acao: "VINCULAR", transacaoId: 1 },
    { fingerprint: "b", acao: "VINCULAR", transacaoId: 1 },
  ];
  assert.deepEqual([...conflitosDeSelecao(vinculos)], ["a", "b"]);
  const parciais = vinculos.map(
    (d): Decisao => ({
      ...d,
      acao: "LIQUIDAR",
      valor: 50,
      metodopagamento: "PIX",
    }),
  );
  assert.equal(conflitosDeSelecao(parciais).size, 0);
  assert.equal(
    conflitosDeSelecao([{ ...parciais[0], valor: null }, parciais[1]]).size,
    2,
  );
});

test("conciliados e ignorados entram no progresso; apenas importar não resolve", () => {
  assert.equal(resolvido(movimento("MATCH_EXATO", "CONCILIADO")), true);
  assert.equal(resolvido(movimento("MATCH_EXATO", "IGNORADO")), true);
  assert.equal(resolvido(movimento("MATCH_EXATO", "PENDENTE")), false);
  assert.equal(resolvido(movimento("MATCH_EXATO")), false);
});

test("datas sem fuso são preservadas; instantes usam o dia da oficina", () => {
  assert.equal(formatarDia("2026-08-04"), "04/08/2026");
  assert.equal(dataDaTransacao("2026-08-04T01:00:00Z"), "03/08/2026");
  assert.equal(dataDaTransacao("2026-08-04"), "04/08/2026");
});

test("tratamento visual preserva o texto original e a auditoria da conciliação", () => {
  const m = movimento("MATCH_EXATO");
  assert.deepEqual(descricaoMovimento(m), {
    titulo: "Pagamento de boleto",
    complemento: "123456",
  });
  assert.equal(m.memo, "PAGAMENTO DE BOLETO 123456");
  const gravado = {
    id: 9,
    sequencia: 1,
    data_postagem: "2026-08-04",
    valor_centavos: "-10000",
    status: "CONCILIADO",
    transacao_id: 7,
    titulo_origem_id: 5,
    acao_conciliacao: "BAIXA_PARCIAL",
    conciliado_em: "2026-09-08T12:00:00Z",
    analise: m.analise,
  } as MovimentoGravado;
  const convertido = comoMovimentoAnalisado(gravado);
  assert.equal(convertido.transacaoId, 7);
  assert.equal(convertido.tituloOrigemId, 5);
  assert.equal(convertido.acaoGravada, "BAIXA_PARCIAL");
});
