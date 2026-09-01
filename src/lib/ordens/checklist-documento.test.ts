import assert from "node:assert/strict";
import test from "node:test";
import {
  checklistPublicIdValido,
  documentoFiscalValido,
  groupChecklistItemsForPrint,
  statusChecklistDocumento,
} from "./checklist-documento";
import type { ChecklistSnapshotV1 } from "./checklist-documento";
import { conteudoHash, resumirMudancas, snapshotHash } from "./checklist-documento-hash";
import { buildChecklistObjectSnapshot } from "./checklist-snapshot";

test("valida CPF e CNPJ pelos dígitos verificadores", () => {
  assert.equal(documentoFiscalValido("529.982.247-25"), true);
  assert.equal(documentoFiscalValido("04.252.011/0001-10"), true);
  assert.equal(documentoFiscalValido("529.982.247-24"), false);
  assert.equal(documentoFiscalValido("11.111.111/1111-11"), false);
});

test("deriva o estado documental da assinatura e do PDF", () => {
  assert.equal(statusChecklistDocumento(false, false), "NAO_ASSINADO");
  assert.equal(statusChecklistDocumento(true, false), "ASSINADO_PENDENTE_PDF");
  assert.equal(statusChecklistDocumento(true, true), "ASSINADO");
});

test("aceita apenas identificadores documentais no formato UUID", () => {
  assert.equal(checklistPublicIdValido("10000000-0000-4000-8000-000000000001"), true);
  assert.equal(checklistPublicIdValido("nao-e-um-uuid"), false);
  assert.equal(checklistPublicIdValido("10000000-0000-4000-8000-000000000001/extra"), false);
});

test("agrupa somente pares de itens com uma foto e mantém itens sem par em largura total", () => {
  const items = [
    { titulo: "Frente", fotos: [{}] },
    { titulo: "Traseira", fotos: [{}] },
    { titulo: "Painel", fotos: [{}, {}, {}] },
    { titulo: "Estepe", fotos: [] },
    { titulo: "Motor", fotos: [{}] },
  ];
  const groups = groupChecklistItemsForPrint(items);

  assert.equal(groups.length, 4);
  assert.equal(groups[0].kind, "compact");
  if (groups[0].kind === "compact") {
    assert.deepEqual(groups[0].entries.map((entry) => entry.item.titulo), ["Frente", "Traseira"]);
  }
  assert.equal(groups[1].kind, "full");
  if (groups[1].kind === "full") assert.equal(groups[1].entry.item.titulo, "Painel");
  assert.equal(groups[2].kind, "full");
  if (groups[2].kind === "full") assert.equal(groups[2].entry.item.titulo, "Estepe");
  assert.equal(groups[3].kind, "full");
  if (groups[3].kind === "full") assert.equal(groups[3].entry.item.titulo, "Motor");
});

function snapshot(version: number, response = "RASPADO", observation = "Marca no canto") : ChecklistSnapshotV1 {
  return {
    schemaVersion: 1,
    documento: {
      publicId: `00000000-0000-4000-8000-00000000000${version}`,
      codigo: `CHK-E-OS1-V${version}`,
      tipo: "ENTRADA",
      versao: version,
      criadoEm: `2026-09-01T12:00:0${version}.000Z`,
    },
    empresa: { nome: "Oficina", campos: [], logo: null, cores: { primaria: "#000000", secundaria: "#111111", texto: "#ffffff" } },
    ordemServico: { id: 1, campos: [], cliente: [], objeto: { tipo: "PECA", titulo: "Para-choque", campos: [] } },
    checklist: {
      modelo: "Recepção",
      descricaoModelo: null,
      inspecionadoEm: "2026-09-01T11:00:00.000Z",
      responsaveis: ["Ana", "Bruno"],
      retiradoPor: null,
      observacaoDocumento: null,
      itens: [{
        origemId: "77",
        titulo: "Condição visual",
        descricao: null,
        categoria: "Carroceria",
        ordem: 0,
        resposta: response,
        observacao: observation,
        registradoEm: "2026-09-01T11:00:00.000Z",
        responsavel: "Ana",
        fotos: [{ origemId: "9", storagePath: "assets/fotos/a.jpg", sha256: "a".repeat(64), mimeType: "image/jpeg", tamanhoBytes: 10, descricao: "Canto", registradoEm: null }],
      }],
    },
    declaracao: "Ciência do conteúdo.",
  };
}

test("mantém hash semântico entre versões idênticas e diferencia o snapshot exato", () => {
  const first = snapshot(1);
  const second = snapshot(2);
  assert.equal(conteudoHash(first), conteudoHash(second));
  assert.notEqual(snapshotHash(first), snapshotHash(second));
  assert.equal(resumirMudancas(second, first).conteudoIdentico, true);
});

test("detecta mudança em resposta arbitrária, observação ou fotografia", () => {
  const original = snapshot(1);
  const changedResponse = snapshot(2, "AMASSADO");
  const changedObservation = snapshot(2, "RASPADO", "Trinca extensa");
  const changedPhoto = snapshot(2);
  changedPhoto.checklist.itens[0].fotos[0].sha256 = "b".repeat(64);
  assert.notEqual(conteudoHash(original), conteudoHash(changedResponse));
  assert.notEqual(conteudoHash(original), conteudoHash(changedObservation));
  assert.notEqual(conteudoHash(original), conteudoHash(changedPhoto));
  assert.deepEqual(resumirMudancas(changedResponse, original).alterados, ["Condição visual"]);
});

test("monta identificação genérica para veículo, peça e equipamento omitindo campos ausentes", () => {
  const vehicle = buildChecklistObjectSnapshot({ alvo_tipo: "VEICULO", veiculo: { placa: "ABC1D23", marca: "Fiat", modelo: "Uno", cor: null } });
  const part = buildChecklistObjectSnapshot({ alvo_tipo: "PECA", peca: { titulo: "Câmbio", descricao: null, lacre: "L-9" } });
  const equipment = buildChecklistObjectSnapshot({ alvo_tipo: "EQUIPAMENTO", equipamento_nome: "Compressor", equipamento_patrimonio: null, equipamento_horimetro: 823 });
  assert.equal(vehicle.titulo, "Fiat Uno");
  assert.deepEqual(vehicle.campos.map((item) => item.rotulo), ["Placa", "Marca", "Modelo"]);
  assert.equal(part.titulo, "Câmbio");
  assert.deepEqual(part.campos.map((item) => item.rotulo), ["Peça", "Lacre"]);
  assert.equal(equipment.titulo, "Compressor");
  assert.deepEqual(equipment.campos.map((item) => item.rotulo), ["Equipamento", "Horímetro"]);
});
