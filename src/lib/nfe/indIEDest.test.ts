import assert from "node:assert/strict";
import test from "node:test";

import {
  MENSAGEM_IE_OBRIGATORIA,
  MENSAGEM_INDICADOR_AUSENTE,
  deveEnviarIeDoDestinatario,
  ehRejeicaoIeDestinatarioInativa,
  ehRejeicaoIndIeDestIsentoNaoPermitido,
  normalizarIndIEDest,
  sugerirIndIEDest,
  validarInscricaoEstadualDestinatario,
} from "./indIEDest";
import { mapClienteToDestinatario } from "./mapClienteToDestinatario";
import type { ClienteRow, NFeDestinatario } from "./types";
import { buildDestXml } from "./xmlDest";

const ENDERECO: NFeDestinatario["endereco"] = {
  logradouro: "FAGUNDES VARELA",
  numero: "950",
  bairro: "JARDIM ATLANTICO",
  codigoMunicipio: "2609600",
  nomeMunicipio: "OLINDA",
  uf: "PE",
  cep: "53140080",
  codigoPais: "1058",
  nomePais: "BRASIL",
};

function destinatario(
  overrides: Partial<NFeDestinatario> & Pick<NFeDestinatario, "indIEDest">,
): NFeDestinatario {
  return {
    cnpj: "07713983000152",
    razaoSocial: "CONSTRUTORA ALFE LTDA",
    endereco: ENDERECO,
    ...overrides,
  };
}

/* ---------------- Montagem do grupo <dest> ---------------- */

test("contribuinte com IE leva indIEDest 1 e a IE", () => {
  const xml = buildDestXml(
    destinatario({ indIEDest: 1, inscricaoEstadual: "037141953" }),
  );

  assert.match(xml, /<indIEDest>1<\/indIEDest>/);
  assert.match(xml, /<IE>037141953<\/IE>/);
});

test("não contribuinte com IE antiga no cadastro não leva a tag IE", () => {
  // O caso que gerou a rejeição 306: inscrição cadastrada, mas baixada na UF.
  const xml = buildDestXml(
    destinatario({ indIEDest: 9, inscricaoEstadual: "037141953" }),
  );

  assert.match(xml, /<indIEDest>9<\/indIEDest>/);
  assert.doesNotMatch(xml, /<IE>/);
});

test("não contribuinte sem IE leva apenas o indicador", () => {
  const xml = buildDestXml(destinatario({ indIEDest: 9 }));

  assert.match(xml, /<indIEDest>9<\/indIEDest>/);
  assert.doesNotMatch(xml, /<IE>/);
});

test("contribuinte isento não leva IE, nem a palavra ISENTO", () => {
  const xml = buildDestXml(
    destinatario({ indIEDest: 2, inscricaoEstadual: "037141953" }),
  );

  assert.match(xml, /<indIEDest>2<\/indIEDest>/);
  assert.doesNotMatch(xml, /<IE>/);
  assert.doesNotMatch(xml, /ISENTO/);
});

test("aceita o indicador como número ou como texto", () => {
  assert.match(
    buildDestXml(destinatario({ indIEDest: "1", inscricaoEstadual: "037141953" })),
    /<IE>037141953<\/IE>/,
  );
  assert.doesNotMatch(
    buildDestXml(destinatario({ indIEDest: "9", inscricaoEstadual: "037141953" })),
    /<IE>/,
  );
});

/* ---------------- Validação antes de gerar o XML ---------------- */

test("bloqueia contribuinte sem inscrição estadual", () => {
  assert.throws(
    () => validarInscricaoEstadualDestinatario({ indIEDest: 1, inscricaoEstadual: null }),
    { message: MENSAGEM_IE_OBRIGATORIA },
  );
  assert.throws(
    () => validarInscricaoEstadualDestinatario({ indIEDest: 1, inscricaoEstadual: "   " }),
    { message: MENSAGEM_IE_OBRIGATORIA },
  );
});

test("bloqueia quando o indicador não foi selecionado", () => {
  for (const valor of [null, undefined, "", 0, 3, "abc"]) {
    assert.throws(
      () => validarInscricaoEstadualDestinatario({ indIEDest: valor }),
      { message: MENSAGEM_INDICADOR_AUSENTE },
      `deveria bloquear indIEDest=${JSON.stringify(valor)}`,
    );
  }
});

test("libera isento e não contribuinte sem IE", () => {
  assert.doesNotThrow(() =>
    validarInscricaoEstadualDestinatario({ indIEDest: 2, inscricaoEstadual: null }),
  );
  assert.doesNotThrow(() =>
    validarInscricaoEstadualDestinatario({ indIEDest: 9, inscricaoEstadual: null }),
  );
});

/* ---------------- Normalização e regra da tag ---------------- */

test("normaliza apenas 1, 2 e 9", () => {
  assert.equal(normalizarIndIEDest(1), 1);
  assert.equal(normalizarIndIEDest("2"), 2);
  assert.equal(normalizarIndIEDest(9), 9);
  assert.equal(normalizarIndIEDest(3), null);
  assert.equal(normalizarIndIEDest(null), null);
  assert.equal(normalizarIndIEDest(""), null);
});

test("a IE só acompanha o contribuinte do ICMS", () => {
  assert.equal(deveEnviarIeDoDestinatario(1, "037141953"), true);
  assert.equal(deveEnviarIeDoDestinatario(1, "  "), false);
  assert.equal(deveEnviarIeDoDestinatario(2, "037141953"), false);
  assert.equal(deveEnviarIeDoDestinatario(9, "037141953"), false);
  assert.equal(deveEnviarIeDoDestinatario(null, "037141953"), false);
});

test("a sugestão é só para a tela e não vale como classificação", () => {
  assert.equal(sugerirIndIEDest("037141953"), 1);
  assert.equal(sugerirIndIEDest(null), 9);
  // O que a sugestão devolve não passa pela validação sozinho: o cadastro é
  // que decide, e é ele que a validação lê.
  assert.throws(() => validarInscricaoEstadualDestinatario({ indIEDest: undefined }));
});

/* ---------------- Cliente da OS/venda ---------------- */

function cliente(overrides: Partial<ClienteRow> = {}): ClienteRow {
  return {
    id: 1,
    cpfcnpj: "07713983000152",
    nomerazaosocial: "CONSTRUTORA ALFE LTDA",
    estado: "PE",
    cidade: "OLINDA",
    codigomunicipio: "2609600",
    cep: "53140080",
    ...overrides,
  };
}

test("cliente sem classificação não vira contribuinte por ter IE", () => {
  // A regressão que causou a rejeição: antes isto virava indIEDest 1.
  const dest = mapClienteToDestinatario(
    cliente({ inscricaoestadual: "037141953", ind_ie_dest: null }),
  );

  assert.equal(dest.indIEDest, null);
  assert.equal(dest.inscricaoEstadual, undefined);
  assert.throws(() => validarInscricaoEstadualDestinatario(dest), {
    message: MENSAGEM_INDICADOR_AUSENTE,
  });
});

test("cliente classificado como não contribuinte descarta a IE cadastrada", () => {
  const dest = mapClienteToDestinatario(
    cliente({ inscricaoestadual: "037141953", ind_ie_dest: 9 }),
  );

  assert.equal(dest.indIEDest, 9);
  assert.equal(dest.inscricaoEstadual, undefined);
  assert.doesNotMatch(buildDestXml(dest), /<IE>/);
});

test("cliente classificado como contribuinte leva a IE só com dígitos", () => {
  const dest = mapClienteToDestinatario(
    cliente({ inscricaoestadual: "03.714.195-3", ind_ie_dest: 1 }),
  );

  assert.equal(dest.indIEDest, 1);
  assert.equal(dest.inscricaoEstadual, "037141953");
  assert.match(buildDestXml(dest), /<IE>037141953<\/IE>/);
});

/* ---------------- Rejeição 306 ---------------- */

test("reconhece a rejeição 306 vinda como texto ou número", () => {
  assert.equal(ehRejeicaoIeDestinatarioInativa("306"), true);
  assert.equal(ehRejeicaoIeDestinatarioInativa(306), true);
  assert.equal(ehRejeicaoIeDestinatarioInativa(" 306 "), true);
  assert.equal(ehRejeicaoIeDestinatarioInativa("204"), false);
  assert.equal(ehRejeicaoIeDestinatarioInativa(null), false);
});

test('reconhece a rejeição 805 vinda como texto ou número', () => {
  assert.equal(ehRejeicaoIndIeDestIsentoNaoPermitido('805'), true);
  assert.equal(ehRejeicaoIndIeDestIsentoNaoPermitido(805), true);
  assert.equal(ehRejeicaoIndIeDestIsentoNaoPermitido(' 805 '), true);
  assert.equal(ehRejeicaoIndIeDestIsentoNaoPermitido('306'), false);
});
