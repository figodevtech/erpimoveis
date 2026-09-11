import test from "node:test";
import assert from "node:assert/strict";

import { classificarExclusaoEmLote } from "./classificar-exclusao";
import type { ImpactoTransacao } from "./impacto-exclusao";

/** Um impacto "sem nada": pendente, avulso, sem vínculo. */
function impacto(id: number, patch: Partial<ImpactoTransacao> = {}): ImpactoTransacao {
  const vinculos = {
    pendente: true,
    ehAdiantamento: false,
    adiantamentoId: null,
    pagamentoMultiploId: null,
    transferenciaId: null,
    lancamentoId: null,
    ordemservicoId: null,
    vendaId: null,
    baixaDeTransacaoId: null,
    competenciaEm: null,
    descricao: `Lançamento ${id}`,
    valor: 100,
    ...(patch.vinculos ?? {}),
  };

  return {
    reabriraPagamento: false,
    targets: [],
    adiantamento: null,
    pagamentoMultiplo: null,
    transferencia: null,
    lancamentoDeEventos: null,
    liquidado: null,
    conciliadoNoExtrato: null,
    estornoApontando: null,
    filhasDeBaixaParcial: [],
    irmasDoGrupo: [id],
    ...patch,
    vinculos,
  };
}

const mapa = (...pares: Array<[number, ImpactoTransacao]>) => new Map(pares);

const LIQUIDADO = {
  bloqueado: true as const,
  estornavel: true as const,
  motivo: "está liquidada",
  sentido: "RECEBER" as const,
  valorReaberto: 100,
  acrescimos: 0,
  abonado: false,
  creditoCliente: false,
};

const classe = (r: ReturnType<typeof classificarExclusaoEmLote>, id: number) =>
  r.itens.find((i) => i.id === id)?.classificacao;

test("classificação da exclusão em massa", async (t) => {
  await t.test("pendente e avulsa sai sozinha", () => {
    const r = classificarExclusaoEmLote([1], mapa([1, impacto(1)]));
    assert.equal(classe(r, 1), "EXCLUI");
    assert.equal(r.plano.length, 1);
    assert.equal(r.plano[0].acao, "EXCLUIR_TRANSACAO");
    assert.deepEqual(r.plano[0].cobre, [1]);
  });

  await t.test("liquidada estornável vira estorna-e-exclui", () => {
    const r = classificarExclusaoEmLote(
      [1],
      mapa([1, impacto(1, { liquidado: LIQUIDADO, vinculos: { pendente: false } as any })]),
    );
    assert.equal(classe(r, 1), "ESTORNA_E_EXCLUI");
    assert.equal(r.plano[0].acao, "ESTORNAR_E_EXCLUIR");
  });

  await t.test("as duas pernas da transferência viram UM passo", () => {
    const perna = (id: number) =>
      impacto(id, {
        irmasDoGrupo: [10, 11],
        transferencia: { id: 7, valor: 500, origem: "A", destino: "B", motivo: "duas pernas" },
        vinculos: { pendente: false, transferenciaId: 7 } as any,
      });

    const r = classificarExclusaoEmLote([10, 11], mapa([10, perna(10)], [11, perna(11)]));

    assert.equal(r.plano.length, 1, "uma transferência, um passo");
    assert.equal(r.plano[0].acao, "EXCLUIR_TRANSFERENCIA");
    assert.deepEqual(r.plano[0].cobre.sort(), [10, 11]);
    assert.equal(r.resumo.saem, 2);
    assert.equal(r.resumo.arrastados, 0, "as duas estavam marcadas");
  });

  await t.test("uma perna só ainda leva as duas, e a outra conta como arrastada", () => {
    const r = classificarExclusaoEmLote(
      [10],
      mapa([
        10,
        impacto(10, {
          irmasDoGrupo: [10, 11],
          transferencia: { id: 7, valor: 500, origem: "A", destino: "B", motivo: "duas pernas" },
          vinculos: { pendente: false, transferenciaId: 7 } as any,
        }),
      ]),
    );

    assert.equal(r.plano.length, 1);
    assert.equal(r.resumo.selecionados, 1);
    assert.equal(r.resumo.saem, 2, "some a perna que ninguém clicou");
    assert.equal(r.resumo.arrastados, 1);
  });

  await t.test("lançamento com parcela paga bloqueia o grupo inteiro", () => {
    const parcela = (id: number) =>
      impacto(id, {
        irmasDoGrupo: [20, 21],
        lancamentoDeEventos: {
          id: 5, parcelas: 2, parcelasBaixadas: 1, despesas: 3, motivo: "tem parcela paga",
        },
        vinculos: { lancamentoId: 5 } as any,
      });

    const r = classificarExclusaoEmLote([20, 21], mapa([20, parcela(20)], [21, parcela(21)]));

    assert.equal(classe(r, 20), "BLOQUEADO");
    assert.equal(classe(r, 21), "BLOQUEADO");
    assert.equal(r.plano.length, 0);
    assert.equal(r.resumo.saem, 0);
  });

  await t.test("lançamento sem parcela paga vira um passo só", () => {
    const parcela = (id: number) =>
      impacto(id, {
        irmasDoGrupo: [20, 21, 22],
        lancamentoDeEventos: {
          id: 5, parcelas: 3, parcelasBaixadas: 0, despesas: 4, motivo: "desfaz o lançamento",
        },
        vinculos: { lancamentoId: 5 } as any,
      });

    const r = classificarExclusaoEmLote([20, 21], mapa([20, parcela(20)], [21, parcela(21)]));

    assert.equal(r.plano.length, 1);
    assert.equal(r.plano[0].acao, "EXCLUIR_LANCAMENTO");
    assert.equal(r.resumo.saem, 3, "a terceira parcela vai junto");
    assert.equal(r.resumo.arrastados, 1);
  });

  await t.test("antecipação junto com o título: o título passa a sair", () => {
    const antecipacao = impacto(30, {
      adiantamento: { bloqueado: false, desfaz: true, quantidade: 1, motivo: "devolve 1 título" },
      vinculos: { pendente: false, ehAdiantamento: true } as any,
    });
    const titulo = impacto(31, {
      adiantamento: { bloqueado: true, motivo: "faz parte da antecipação #30" },
      vinculos: { pendente: false, adiantamentoId: 30 } as any,
    });

    const r = classificarExclusaoEmLote([30, 31], mapa([30, antecipacao], [31, titulo]));

    assert.equal(classe(r, 30), "EXCLUI_EM_GRUPO");
    assert.equal(classe(r, 31), "EXCLUI", "a antecipação sai primeiro e o reabre");

    // E a antecipação tem que vir ANTES na ordem de execução.
    const posAntecipacao = r.plano.findIndex((p) => p.alvo === 30);
    const posTitulo = r.plano.findIndex((p) => p.alvo === 31);
    assert.ok(posAntecipacao < posTitulo, "antecipação antes do título");
  });

  await t.test("o título sozinho continua bloqueado", () => {
    const r = classificarExclusaoEmLote(
      [31],
      mapa([
        31,
        impacto(31, {
          adiantamento: { bloqueado: true, motivo: "faz parte da antecipação #30" },
          vinculos: { pendente: false, adiantamentoId: 30 } as any,
        }),
      ]),
    );

    assert.equal(classe(r, 31), "BLOQUEADO");
    assert.match(r.itens[0].motivo, /antecipação #30/);
  });

  await t.test("filha de baixa parcial com o pai marcado é absorvida", () => {
    const pai = impacto(40, { irmasDoGrupo: [40, 41], filhasDeBaixaParcial: [41] });
    const filha = impacto(41, {
      liquidado: LIQUIDADO,
      vinculos: { pendente: false, baixaDeTransacaoId: 40 } as any,
    });

    const r = classificarExclusaoEmLote([40, 41], mapa([40, pai], [41, filha]));

    assert.equal(classe(r, 41), "EXCLUI_EM_GRUPO");
    assert.equal(r.plano.length, 1, "um passo no pai");
    assert.equal(r.plano[0].alvo, 40);
    assert.deepEqual(r.plano[0].cobre.sort(), [40, 41]);
  });

  await t.test("filha sozinha cai na regra da liquidada", () => {
    const r = classificarExclusaoEmLote(
      [41],
      mapa([
        41,
        impacto(41, {
          liquidado: LIQUIDADO,
          vinculos: { pendente: false, baixaDeTransacaoId: 40 } as any,
        }),
      ]),
    );
    assert.equal(classe(r, 41), "ESTORNA_E_EXCLUI");
  });

  await t.test("conciliada no extrato bloqueia, antes de qualquer outra regra", () => {
    const r = classificarExclusaoEmLote(
      [50],
      mapa([
        50,
        impacto(50, {
          conciliadoNoExtrato: { movimentos: 1, motivo: "conciliada com o extrato" },
          // Mesmo com vínculo de transferência, o bloqueio vem primeiro.
          vinculos: { transferenciaId: 9 } as any,
        }),
      ]),
    );
    assert.equal(classe(r, 50), "BLOQUEADO");
    assert.match(r.itens[0].motivo, /extrato/);
  });

  await t.test("estorno apontando para ela bloqueia", () => {
    const r = classificarExclusaoEmLote(
      [51],
      mapa([51, impacto(51, { estornoApontando: { id: 99, motivo: "já foi estornada" } })]),
    );
    assert.equal(classe(r, 51), "BLOQUEADO");
  });

  await t.test("pagamento múltiplo com parcela baixada bloqueia; sem, vira um passo", () => {
    const grupoBase = {
      id: 8, valorTotal: 900, modo: "PARCELADO", documentos: [], quantidadeBaixada: 0,
      bloqueado: false,
    };

    const travado = classificarExclusaoEmLote(
      [60],
      mapa([
        60,
        impacto(60, {
          pagamentoMultiplo: { ...grupoBase, quantidadeBaixada: 1, bloqueado: true, motivo: "tem parcela baixada" },
          vinculos: { pagamentoMultiploId: 8 } as any,
        }),
      ]),
    );
    assert.equal(classe(travado, 60), "BLOQUEADO");

    const perna = (id: number) =>
      impacto(id, {
        irmasDoGrupo: [60, 61],
        pagamentoMultiplo: grupoBase,
        vinculos: { pagamentoMultiploId: 8 } as any,
      });
    const livre = classificarExclusaoEmLote([60, 61], mapa([60, perna(60)], [61, perna(61)]));

    assert.equal(livre.plano.length, 1);
    assert.equal(livre.plano[0].acao, "EXCLUIR_PAGAMENTO_MULTIPLO");
    assert.equal(livre.plano[0].alvo, 8, "o alvo é o grupo, não a perna");
  });

  await t.test("três pagamentos da mesma OS reabrem o documento uma vez só", () => {
    const alvo = { tipo: "OS" as const, id: 12 };
    const pagamento = (id: number) =>
      impacto(id, {
        reabriraPagamento: true,
        targets: [alvo],
        vinculos: { ordemservicoId: 12 } as any,
      });

    const r = classificarExclusaoEmLote(
      [70, 71, 72],
      mapa([70, pagamento(70)], [71, pagamento(71)], [72, pagamento(72)]),
    );

    assert.equal(r.resumo.reabrem.length, 1);
    assert.deepEqual(r.resumo.reabrem[0], alvo);
    assert.equal(r.plano.length, 3);
  });

  await t.test("lançamento de mês anterior é contado", () => {
    const r = classificarExclusaoEmLote(
      [80, 81],
      mapa(
        [80, impacto(80, { vinculos: { competenciaEm: "2026-07-15T12:00:00-03:00" } as any })],
        [81, impacto(81, { vinculos: { competenciaEm: "2026-09-15T12:00:00-03:00" } as any })],
      ),
      { hoje: new Date("2026-09-10T12:00:00-03:00") },
    );

    assert.equal(r.resumo.competenciaAnterior, 1);
  });

  await t.test("id que não existe mais vira bloqueado, não quebra", () => {
    const r = classificarExclusaoEmLote([1, 999], mapa([1, impacto(1)]));
    assert.equal(classe(r, 999), "BLOQUEADO");
    assert.equal(r.plano.length, 1);
  });

  await t.test("a mesma seleção em qualquer ordem produz o mesmo plano", () => {
    const impactos = mapa(
      [10, impacto(10, { irmasDoGrupo: [10, 11], transferencia: { id: 7, valor: 1, origem: null, destino: null, motivo: "x" }, vinculos: { pendente: false, transferenciaId: 7 } as any })],
      [11, impacto(11, { irmasDoGrupo: [10, 11], transferencia: { id: 7, valor: 1, origem: null, destino: null, motivo: "x" }, vinculos: { pendente: false, transferenciaId: 7 } as any })],
      [30, impacto(30, { adiantamento: { bloqueado: false, desfaz: true, quantidade: 1, motivo: "y" }, vinculos: { pendente: false, ehAdiantamento: true } as any })],
      [1, impacto(1)],
      [2, impacto(2)],
    );

    const a = classificarExclusaoEmLote([1, 2, 10, 11, 30], impactos);
    const b = classificarExclusaoEmLote([30, 11, 2, 10, 1], impactos);

    assert.deepEqual(
      a.plano.map((p) => [p.acao, p.alvo, [...p.cobre].sort()]),
      b.plano.map((p) => [p.acao, p.alvo, [...p.cobre].sort()]),
    );
  });

  await t.test("a ordem das faixas é respeitada", () => {
    const impactos = mapa(
      [1, impacto(1)],
      [10, impacto(10, { transferencia: { id: 7, valor: 1, origem: null, destino: null, motivo: "x" }, vinculos: { pendente: false, transferenciaId: 7 } as any })],
      [30, impacto(30, { adiantamento: { bloqueado: false, desfaz: true, quantidade: 1, motivo: "y" }, vinculos: { pendente: false, ehAdiantamento: true } as any })],
      [50, impacto(50, { liquidado: LIQUIDADO, vinculos: { pendente: false } as any })],
    );

    const r = classificarExclusaoEmLote([1, 10, 30, 50], impactos);

    assert.deepEqual(
      r.plano.map((p) => p.acao),
      [
        "EXCLUIR_ANTECIPACAO",
        "EXCLUIR_TRANSFERENCIA",
        "ESTORNAR_E_EXCLUIR",
        "EXCLUIR_TRANSACAO",
      ],
    );
  });
});
