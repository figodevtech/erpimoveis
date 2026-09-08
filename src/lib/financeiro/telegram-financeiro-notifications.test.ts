import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinanceiroNotificationMessage,
  type TelegramFinanceiroTransaction,
} from "./telegram-financeiro-notification-format";
import {
  classifyFinanceiroNotificationEvent,
  classifyFinanceiroOrigem,
  isFinanceiroNotificationEvent,
} from "./telegram-financeiro-events";

test("criação classifica pelo tipo e pelo estado inicial do título", () => {
  const base = { operacao: "INSERT" as const, pendente: true, tipo: "DESPESA" };
  assert.equal(classifyFinanceiroNotificationEvent(base), "CONTA_PAGAR_CRIADA");
  assert.equal(classifyFinanceiroNotificationEvent({ ...base, tipo: "RECEITA" }), "CONTA_RECEBER_CRIADA");
  assert.equal(classifyFinanceiroNotificationEvent({ ...base, pendente: false }), "MOVIMENTO_CAIXA_CRIADO");
  assert.equal(
    classifyFinanceiroNotificationEvent({ ...base, transferenciaId: 9 }),
    "TRANSFERENCIA_ENTRE_CONTAS",
  );
});

test("baixa, estorno e exclusão saem da transição de pendente", () => {
  assert.equal(
    classifyFinanceiroNotificationEvent({ operacao: "UPDATE", tipo: "DESPESA", pendenteAnterior: true, pendente: false }),
    "CONTA_PAGAR_LIQUIDADA",
  );
  assert.equal(
    classifyFinanceiroNotificationEvent({ operacao: "UPDATE", tipo: "RECEITA", pendenteAnterior: true, pendente: false }),
    "CONTA_RECEBER_LIQUIDADA",
  );
  assert.equal(
    classifyFinanceiroNotificationEvent({ operacao: "UPDATE", tipo: "DESPESA", pendenteAnterior: false, pendente: true }),
    "BAIXA_ESTORNADA",
  );
  assert.equal(
    classifyFinanceiroNotificationEvent({ operacao: "UPDATE", tipo: "DESPESA", pendenteAnterior: true, pendente: true }),
    null,
  );
});

test("exclusão ganha da baixa quando as duas mudam no mesmo update", () => {
  assert.equal(
    classifyFinanceiroNotificationEvent({
      operacao: "UPDATE",
      tipo: "DESPESA",
      pendenteAnterior: true,
      pendente: false,
      isDeleted: true,
      isDeletedAnterior: false,
    }),
    "LANCAMENTO_EXCLUIDO",
  );
  // Linha que já estava excluída não volta a avisar por causa de outro update.
  assert.equal(
    classifyFinanceiroNotificationEvent({
      operacao: "UPDATE",
      tipo: "DESPESA",
      pendenteAnterior: false,
      pendente: true,
      isDeleted: true,
      isDeletedAnterior: true,
    }),
    null,
  );
});

test("origem sai do vínculo mais específico do lançamento", () => {
  assert.equal(classifyFinanceiroOrigem({ ordemservicoid: 7, vendaid: 3 }), "ORDEM_SERVICO");
  assert.equal(classifyFinanceiroOrigem({ vendaid: 3 }), "VENDA");
  assert.equal(classifyFinanceiroOrigem({ entrada_id: 5 }), "ENTRADA");
  assert.equal(classifyFinanceiroOrigem({ usoconsumo_entrada_id: 5 }), "ENTRADA");
  assert.equal(classifyFinanceiroOrigem({}), "AVULSO");
  assert.equal(isFinanceiroNotificationEvent("CONTA_PAGAR_REAGENDADA"), false);
});

function transaction(overrides: Partial<TelegramFinanceiroTransaction> = {}): TelegramFinanceiroTransaction {
  return {
    id: 183,
    descricao: "Compra NF 743287",
    tipo: "DESPESA",
    valor: 877.07,
    data: "2026-09-01T12:00:00.000Z",
    vencimento_em: "2026-09-01T12:00:00.000Z",
    pago_em: null,
    categoria: "PEÇA",
    metodopagamento: null,
    pendente: true,
    updated_at: "2026-09-01T12:00:00.000Z",
    ordemservicoid: null,
    vendaid: null,
    entrada_id: null,
    usoconsumo_entrada_id: null,
    transferencia_id: null,
    nomepagador: "FORTGIRO",
    cpfcnpjpagador: "12345678000199",
    fornecedor: null,
    banco: null,
    transferencia: null,
    ...overrides,
  };
}

test("conta a pagar registrada mostra recebedor, vencimento e quem lançou", () => {
  const message = buildFinanceiroNotificationMessage("CONTA_PAGAR_CRIADA", transaction(), "Ana & Cia");
  assert.match(message, /Conta a pagar registrada/);
  assert.match(message, /Recebedor:<\/b> FORTGIRO · 12\.345\.678\/0001-99/);
  assert.match(message, /Vencimento:<\/b> 01\/09\/2026/);
  assert.match(message, /Registrado por:<\/b> Ana &amp; Cia/);
  assert.doesNotMatch(message, /Pago em/);
});

test("baixa mostra conta, método e quem baixou no lugar do vencimento", () => {
  const message = buildFinanceiroNotificationMessage("CONTA_PAGAR_LIQUIDADA", transaction({
    pendente: false,
    pago_em: "2026-09-02T13:00:00.000Z",
    metodopagamento: "PIX_QRCODE",
    banco: { titulo: "Banco do Brasil" },
  }), "Carlos");
  assert.match(message, /Pago em:<\/b> 02\/09\/2026/);
  assert.match(message, /Conta:<\/b> Banco do Brasil/);
  assert.match(message, /Método:<\/b> Pix qrcode/);
  assert.match(message, /Baixado por:<\/b> Carlos/);
});

test("conta a receber usa pagador e aponta a origem", () => {
  const message = buildFinanceiroNotificationMessage("CONTA_RECEBER_CRIADA", transaction({
    tipo: "RECEITA",
    ordemservicoid: 1180,
    nomepagador: "Transportes Norte",
    cpfcnpjpagador: null,
  }));
  assert.match(message, /Pagador:<\/b> Transportes Norte/);
  assert.match(message, /Origem:<\/b> OS #1180/);
});

test("estorno explica que o título voltou para em aberto", () => {
  const message = buildFinanceiroNotificationMessage("BAIXA_ESTORNADA", transaction());
  assert.match(message, /Baixa estornada/);
  assert.match(message, /voltou para em aberto/);
});

test("transferência descreve as duas contas e o valor uma vez só", () => {
  const message = buildFinanceiroNotificationMessage("TRANSFERENCIA_ENTRE_CONTAS", transaction({
    transferencia_id: 12,
    descricao: "Reforço de caixa",
    transferencia: {
      valor: 5000,
      data: "2026-09-02T10:00:00.000Z",
      origem: { titulo: "Banco do Brasil" },
      destino: { titulo: "Caixa interno" },
    },
  }), "Ana");
  assert.match(message, /De:<\/b> Banco do Brasil/);
  assert.match(message, /Para:<\/b> Caixa interno/);
  assert.match(message, /5\.000,00/);
  assert.match(message, /Registrada por:<\/b> Ana/);
  assert.doesNotMatch(message, /Recebedor/);
});

test("lançamento excluído carimba a hora da exclusão", () => {
  const message = buildFinanceiroNotificationMessage("LANCAMENTO_EXCLUIDO", transaction({
    updated_at: "2026-09-02T17:45:00.000Z",
  }), "Ana");
  assert.match(message, /Lançamento excluído/);
  assert.match(message, /Excluído por:<\/b> Ana/);
  assert.match(message, /Em:<\/b> 02\/09\/2026/);
});
