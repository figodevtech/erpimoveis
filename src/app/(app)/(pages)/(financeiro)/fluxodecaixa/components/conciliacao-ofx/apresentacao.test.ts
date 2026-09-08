import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comoMovimentoAnalisado,
  chavesDaDecisao,
  conflitosDeSelecao,
  dataDaTransacao,
  decisaoCompleta,
  decisoesIniciais,
  decisoesUnicas,
  ehAgrupada,
  descricaoMovimento,
  formatarDia,
  resolvido,
  semDecisoesDe,
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

/* ------------------------------------------------- conciliação N:1 */

/** Uma decisão de grupo, guardada sob a chave de cada participante. */
const emGrupo = (chaves: string[], extra: Partial<Decisao> = {}): Decisao[] => {
  const decisao: Decisao = {
    fingerprint: chaves[0],
    acao: "VINCULAR",
    transacaoId: 1342,
    grupo: chaves,
    ...extra,
  };
  return chaves.map(() => decisao);
};

test("a decisão de grupo responde por todas as linhas, e a comum só pela sua", () => {
  const [decisao] = emGrupo(["a", "b"]);
  assert.deepEqual(chavesDaDecisao(decisao), ["a", "b"]);
  assert.equal(ehAgrupada(decisao), true);

  const sozinha: Decisao = { fingerprint: "c", acao: "IGNORAR" };
  assert.deepEqual(chavesDaDecisao(sozinha), ["c"]);
  assert.equal(ehAgrupada(sozinha), false);
  assert.equal(ehAgrupada(undefined), false);
});

test("o grupo é enviado uma vez só, não uma por participante", () => {
  // A mesma decisão está sob "a" e sob "b". Mandar as duas faria a segunda
  // chegar depois de o banco já ter marcado as linhas, e voltar como
  // "movimento já resolvido".
  assert.equal(decisoesUnicas(emGrupo(["a", "b"])).length, 1);
  assert.equal(decisoesUnicas(emGrupo(["a", "b", "c"])).length, 1);
});

test("grupos distintos e decisões comuns continuam sendo atos separados", () => {
  const misturado = [
    ...emGrupo(["a", "b"]),
    ...emGrupo(["c", "d"], { transacaoId: 99 }),
    { fingerprint: "e", acao: "IGNORAR" } as Decisao,
  ];
  assert.equal(decisoesUnicas(misturado).length, 3);
});

test("uma conciliação N:1 não é conflito consigo mesma", () => {
  // Duas linhas para a mesma transação são o ato, não duas reivindicações dela.
  assert.equal(conflitosDeSelecao(emGrupo(["a", "b"])).size, 0);
});

test("dois grupos na mesma transação são conflito, e todas as linhas são marcadas", () => {
  const conflito = conflitosDeSelecao([
    ...emGrupo(["a", "b"]),
    ...emGrupo(["c", "d"]),
  ]);
  assert.deepEqual([...conflito].sort(), ["a", "b", "c", "d"]);
});

test("um grupo e um vínculo solto na mesma transação também colidem", () => {
  const conflito = conflitosDeSelecao([
    ...emGrupo(["a", "b"]),
    { fingerprint: "z", acao: "VINCULAR", transacaoId: 1342 },
  ]);
  assert.deepEqual([...conflito].sort(), ["a", "b", "z"]);
});

test("desfazer uma linha do grupo desfaz o ato inteiro", () => {
  // Apagar só a chave pedida deixaria a outra linha apontando para uma decisão
  // que ainda promete conciliá-la, e a soma enviada não seria a montada.
  const [decisao] = emGrupo(["a", "b"]);
  const mapa: Record<string, Decisao> = {
    a: decisao,
    b: decisao,
    c: { fingerprint: "c", acao: "IGNORAR" },
  };

  assert.deepEqual(Object.keys(semDecisoesDe(mapa, ["b"])), ["c"]);
  assert.deepEqual(Object.keys(semDecisoesDe(mapa, ["a"])), ["c"]);
  assert.deepEqual(Object.keys(semDecisoesDe(mapa, ["c"])).sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(semDecisoesDe(mapa, ["inexistente"])).sort(), ["a", "b", "c"]);
});

test("desfazer não mexe no mapa original", () => {
  const mapa: Record<string, Decisao> = { a: { fingerprint: "a", acao: "IGNORAR" } };
  semDecisoesDe(mapa, ["a"]);
  assert.deepEqual(Object.keys(mapa), ["a"]);
});
