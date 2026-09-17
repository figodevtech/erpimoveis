import assert from "node:assert/strict";
import test from "node:test";

import { buildEnvEventoCancelamento } from "./eventoCancelamento";
import {
  formatCpfCnpj,
  isValidCnpj,
  normalizeFiscalRecipient,
} from "./recipientNormalization";

test("normaliza destinatário jurídico sem eliminar letras do CNPJ", () => {
  const result = normalizeFiscalRecipient({
    tipoPessoa: "JURIDICA" as const,
    cpfCnpj: "00.000.000/e08g-12",
  });
  assert.equal(result.cpfCnpj, "00000000E08G12");
  assert.equal(isValidCnpj(result.cpfCnpj), true);
  assert.equal(formatCpfCnpj(result.cpfCnpj), "00.000.000/E08G-12");
});

test("XML de evento preserva CNPJ alfanumérico e chave continua numérica", () => {
  const event = buildEnvEventoCancelamento({
    cOrgao: "25",
    tpAmb: 2,
    cnpj: "00.000.000/E08G-12",
    chNFe: "1".repeat(44),
    nProt: "123",
    xJust: "Cancelamento para teste fiscal",
  });
  assert.match(event.xml, /<CNPJ>00000000E08G12<\/CNPJ>/);
  assert.match(event.xml, new RegExp(`<chNFe>${"1".repeat(44)}</chNFe>`));
});
