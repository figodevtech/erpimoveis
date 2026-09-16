// Leiaute conferido contra as fontes oficiais, em docs/sefaz/:
//
//   * NT 2025.001 v1.00 — item 04 e regras ZX02-220 a ZX02-338;
//   * Manual de Padrões Técnicos do DANFE NFC-e e QR Code v6.0 (março/2025),
//     seções 4.3 (versão 2.00) e 4.4 (versão 3.00).
//
// Os dois exemplos numéricos do Manual entram aqui como vetores de teste: se
// uma troca de biblioteca ou um "ajuste inofensivo" mudar a montagem da string
// ou a caixa de um hexadecimal, estes testes quebram antes de a SEFAZ recusar.

import assert from "node:assert/strict";
import { createHash, createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { assinarPayloadQrCode } from "./assinaturaQrCode";
import {
  gerarQrCodeNfce,
  injetarInfNFeSupl,
  QRCODE_VERSAO_2,
  QRCODE_VERSAO_3,
  TP_ID_DEST,
  versaoExigeCsc,
} from "./qrCode";

// URL oficial do QR Code da PB em homologação. O protocolo é http:// de
// propósito: a SEFAZ compara o endereço (ZX02-20, rejeição 395).
const URL = "http://www.sefaz.pb.gov.br/nfcehom";
const CSC = "SEGREDO-DO-CONTRIBUINTE";

// cUF(25=PB) AAMM(2608) CNPJ(14) mod(65) serie(001) nNF(9) tpEmis(1) cNF(8) dv(1)
const CHAVE_44 = "25260812345678000199" + "65" + "001" + "000000001" + "1" + "12345678" + "9";

/** Chave RSA fixa para os testes. Gerada aqui, nunca é certificado real. */
const { privateKey: CHAVE_TESTE_PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const base = { chaveAcesso: CHAVE_44, tpAmb: 2 as const, tpEmis: 1, urlConsulta: URL };
const v2 = { ...base, versao: QRCODE_VERSAO_2, idCsc: "000001", csc: CSC };
const v3 = { ...base, versao: QRCODE_VERSAO_3 };

const parametros = (qrCode: string) => qrCode.split("?p=")[1].split("|");
const payloadAssinado = (qrCode: string) => {
  const campos = parametros(qrCode);
  return campos.slice(0, 7).join("|");
};

// ---------------------------------------------------------------------------
// Vetores oficiais do Manual v6.0
// ---------------------------------------------------------------------------
describe("Manual v6.0: exemplos oficiais do hash da versão 2", () => {
  const sha1Upper = (s: string) => createHash("sha1").update(s, "utf8").digest("hex").toUpperCase();

  it("4.3.6.1 — exemplo ONLINE reproduz o hash publicado", () => {
    const entrada =
      "28170800156225000131650110000151341562040824|2|1|1" +
      "SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES";
    assert.equal(sha1Upper(entrada), "DC6AE2C2B9A992BE59679AC365E29922DE6B7511");
  });

  it("4.3.6.2 — exemplo OFFLINE reproduz o hash publicado", () => {
    const entrada =
      "28170800156225000131650110000151349562040824|2|1|02|60.90|" +
      "797a4759685578312f5859597a6b7357422b6650523351633530633d|1" +
      "SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES";
    assert.equal(sha1Upper(entrada), "4615A93BB0D7C4E780F8D30EE77EDD5BA55C7D66");
  });

  it("digVal vira hexadecimal MINÚSCULO, como no exemplo do Manual", () => {
    // Se a caixa mudar, o hash muda — e a SEFAZ recusa o QR Code.
    const hex = Buffer.from("yzGYhUx1/XYYzksWB+fPR3Qc50c=", "utf8").toString("hex");
    assert.equal(hex, "797a4759685578312f5859597a6b7357422b6650523351633530633d");
    assert.equal(hex, hex.toLowerCase());
  });

  it("nosso gerador monta a string offline v2 na ordem do Manual", () => {
    const { qrCode } = gerarQrCodeNfce({
      ...v2,
      tpEmis: 9,
      dhEmi: "2026-08-02T10:00:00-03:00",
      vNF: "60.90",
      digVal: "yzGYhUx1/XYYzksWB+fPR3Qc50c=",
    });

    const campos = parametros(qrCode);
    // chave | 2 | tpAmb | dia | vNF | digVal(hex minúsculo) | idCSC | hash
    assert.equal(campos.length, 8);
    assert.equal(campos[3], "02");
    assert.equal(campos[4], "60.90");
    assert.equal(campos[5], "797a4759685578312f5859597a6b7357422b6650523351633530633d");
    assert.equal(campos[6], "1"); // idCSC sem zeros não significativos
    assert.match(campos[7], /^[0-9A-F]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// Versão 3 — ONLINE
// ---------------------------------------------------------------------------
describe("QR Code v3 ONLINE (Manual 4.4.1, Tabela 6)", () => {
  it("produção: chave|3|1", () => {
    const { qrCode } = gerarQrCodeNfce({ ...v3, tpAmb: 1 });
    assert.equal(qrCode, `${URL}?p=${CHAVE_44}|3|1`);
  });

  it("homologação: chave|3|2", () => {
    const { qrCode } = gerarQrCodeNfce({ ...v3, tpAmb: 2 });
    assert.equal(qrCode, `${URL}?p=${CHAVE_44}|3|2`);
  });

  it("ZX02-330: sem parâmetro de assinatura e sem CSC", () => {
    const { qrCode } = gerarQrCodeNfce(v3);
    assert.equal(parametros(qrCode).length, 3);
    assert.equal(versaoExigeCsc(QRCODE_VERSAO_3), false);
  });

  it("não exige chave privada: online não assina nada", () => {
    assert.doesNotThrow(() => gerarQrCodeNfce(v3));
  });
});

// ---------------------------------------------------------------------------
// Versão 3 — OFFLINE
// ---------------------------------------------------------------------------
describe("QR Code v3 OFFLINE (Manual 4.4.2, Tabela 7)", () => {
  const offline = {
    ...v3,
    tpEmis: 9,
    dhEmi: "2026-08-10T14:30:00-03:00",
    vNF: "150.00",
    privateKeyPem: CHAVE_TESTE_PEM,
  };

  it("monta os 8 parâmetros na ordem oficial", () => {
    const { qrCode } = gerarQrCodeNfce({ ...offline, documentoDestinatario: "11144477735" });
    const campos = parametros(qrCode);

    assert.equal(campos.length, 8);
    assert.equal(campos[0], CHAVE_44);
    assert.equal(campos[1], "3");
    assert.equal(campos[2], "2");
    assert.equal(campos[3], "10");
    assert.equal(campos[4], "150.00");
    assert.equal(campos[5], TP_ID_DEST.CPF);
    assert.equal(campos[6], "11144477735");
  });

  it("CNPJ usa tp_idDest 1", () => {
    const { qrCode } = gerarQrCodeNfce({ ...offline, documentoDestinatario: "19131243000197" });
    const campos = parametros(qrCode);
    assert.equal(campos[5], "1");
    assert.equal(campos[6], "19131243000197");
  });

  it("CNPJ alfanumérico preserva as letras no payload assinado", () => {
    const { qrCode } = gerarQrCodeNfce({
      ...offline,
      documentoDestinatario: "00.000.000/E08G-12",
    });
    const campos = parametros(qrCode);
    assert.equal(campos[5], TP_ID_DEST.CNPJ);
    assert.equal(campos[6], "00000000E08G12");
  });

  it("CPF usa tp_idDest 2", () => {
    const { qrCode } = gerarQrCodeNfce({ ...offline, documentoDestinatario: "11144477735" });
    assert.equal(parametros(qrCode)[5], "2");
  });

  it("consumidor não identificado: campos 6 e 7 vazios, separadores mantidos", () => {
    const { qrCode } = gerarQrCodeNfce(offline);
    const campos = parametros(qrCode);

    assert.equal(campos[5], "");
    assert.equal(campos[6], "");
    assert.ok(payloadAssinado(qrCode).endsWith("|150.00||"));
  });

  it("estrangeiro: tipo 3 com identificação VAZIA", () => {
    // Manual, Tabela 7, parâmetro 7º: "Caso Destinatário estrangeiro ou não
    // identificado, informar apenas o separador |".
    const { qrCode } = gerarQrCodeNfce({ ...offline, idEstrangeiro: "PASSAPORTE123" });
    const campos = parametros(qrCode);

    assert.equal(campos[5], TP_ID_DEST.ESTRANGEIRO);
    assert.equal(campos[6], "");
    assert.ok(!qrCode.includes("PASSAPORTE123"));
  });

  it("assina os parâmetros 1 a 7 — nunca a própria assinatura", () => {
    const { qrCode } = gerarQrCodeNfce({ ...offline, documentoDestinatario: "11144477735" });
    const campos = parametros(qrCode);
    const esperada = assinarPayloadQrCode(campos.slice(0, 7).join("|"), CHAVE_TESTE_PEM);

    assert.equal(campos[7], esperada);
  });

  it("exige a chave privada", () => {
    assert.throws(
      () => gerarQrCodeNfce({ ...offline, privateKeyPem: undefined }),
      /Chave privada/i,
    );
  });

  it("produção e homologação mudam o payload assinado", () => {
    const prod = gerarQrCodeNfce({ ...offline, tpAmb: 1 });
    const homolog = gerarQrCodeNfce({ ...offline, tpAmb: 2 });
    assert.notEqual(payloadAssinado(prod.qrCode), payloadAssinado(homolog.qrCode));
  });
});

// ---------------------------------------------------------------------------
// Dia da emissão e vNF
// ---------------------------------------------------------------------------
describe("dia da emissão: lido da representação fiscal, sem passar por UTC", () => {
  const offline = {
    ...v3,
    tpEmis: 9,
    vNF: "10.00",
    privateKeyPem: CHAVE_TESTE_PEM,
  };
  const dia = (dhEmi: string) => parametros(gerarQrCodeNfce({ ...offline, dhEmi }).qrCode)[3];

  it("sempre com dois dígitos", () => {
    assert.equal(dia("2026-08-01T10:00:00-03:00"), "01");
    assert.equal(dia("2026-08-09T10:00:00-03:00"), "09");
    assert.equal(dia("2026-08-10T10:00:00-03:00"), "10");
    assert.equal(dia("2026-08-31T10:00:00-03:00"), "31");
  });

  it("meia-noite em -03:00 mantém o dia fiscal, e não o dia em UTC", () => {
    // 00:30 -03:00 é 03:30 UTC do mesmo dia; mas 23:30 -03:00 já seria o DIA
    // SEGUINTE em UTC. O dia tem que sair do texto, não de um Date.
    assert.equal(dia("2026-08-10T00:30:00-03:00"), "10");
    assert.equal(dia("2026-08-10T23:30:00-03:00"), "10");
  });

  it("recusa dhEmi malformado", () => {
    assert.throws(() => dia("10/08/2026"), /dhEmi inválido/i);
  });
});

describe("vNF: mesma representação fiscal do XML", () => {
  const offline = {
    ...v3,
    tpEmis: 9,
    dhEmi: "2026-08-10T10:00:00-03:00",
    privateKeyPem: CHAVE_TESTE_PEM,
  };
  const vNF = (valor: string) => parametros(gerarQrCodeNfce({ ...offline, vNF: valor }).qrCode)[4];

  it("preserva centavos e valores altos", () => {
    assert.equal(vNF("150.00"), "150.00");
    assert.equal(vNF("0.01"), "0.01");
    assert.equal(vNF("999999.99"), "999999.99");
  });

  it("recusa formatos que mudariam os bytes assinados", () => {
    assert.throws(() => vNF("150"), /vNF inválido/i);
    assert.throws(() => vNF("150,00"), /vNF inválido/i);
    assert.throws(() => vNF("1.500,00"), /vNF inválido/i);
    assert.throws(() => vNF("R$ 150.00"), /vNF inválido/i);
    assert.throws(() => vNF("-150.00"), /vNF inválido/i);
  });
});

// ---------------------------------------------------------------------------
// Assinatura
// ---------------------------------------------------------------------------
describe("assinatura RSA-SHA1 do QR Code", () => {
  const payload = `${CHAVE_44}|3|2|10|150.00|2|11144477735`;

  it("é determinística para a mesma chave e payload", () => {
    const a = assinarPayloadQrCode(payload, CHAVE_TESTE_PEM);
    const b = assinarPayloadQrCode(payload, CHAVE_TESTE_PEM);
    assert.equal(a, b);
  });

  it("devolve Base64 sem quebra de linha", () => {
    const assinatura = assinarPayloadQrCode(payload, CHAVE_TESTE_PEM);
    assert.match(assinatura, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.ok(!/[\r\n]/.test(assinatura));
  });

  it("verifica contra a chave pública, provando RSA-SHA1/PKCS#1", () => {
    const assinatura = assinarPayloadQrCode(payload, CHAVE_TESTE_PEM);
    const verificador = createVerify("sha1");
    verificador.update(Buffer.from(payload, "utf8"));
    verificador.end();
    assert.ok(verificador.verify(createPublicKey(CHAVE_TESTE_PEM), assinatura, "base64"));
  });

  it("qualquer byte diferente muda a assinatura", () => {
    const original = assinarPayloadQrCode(payload, CHAVE_TESTE_PEM);
    assert.notEqual(assinarPayloadQrCode(`${payload} `, CHAVE_TESTE_PEM), original);
    assert.notEqual(assinarPayloadQrCode(payload.replace("150.00", "150.01"), CHAVE_TESTE_PEM), original);
  });

  it("recusa payload com quebra de linha ou vazio", () => {
    assert.throws(() => assinarPayloadQrCode(`${payload}\n`, CHAVE_TESTE_PEM), /quebra de linha/i);
    assert.throws(() => assinarPayloadQrCode("", CHAVE_TESTE_PEM), /vazio/i);
  });
});

// ---------------------------------------------------------------------------
// Validações defensivas e infNFeSupl
// ---------------------------------------------------------------------------
describe("QR Code: validações comuns", () => {
  it("recusa versão desconhecida, chave curta, tpAmb e URL inválidos", () => {
    assert.throws(() => gerarQrCodeNfce({ ...v2, versao: 4 }), /não suportada/i);
    assert.throws(() => gerarQrCodeNfce({ ...v2, chaveAcesso: "123" }), /Chave de acesso/i);
    assert.throws(() => gerarQrCodeNfce({ ...v2, urlConsulta: "" }), /URL estadual/i);
    assert.throws(
      () => gerarQrCodeNfce({ ...v2, tpAmb: 3 as unknown as 1 }),
      /tpAmb inválido/i,
    );
  });

  it("recusa documento de consumidor com tamanho impossível", () => {
    assert.throws(
      () =>
        gerarQrCodeNfce({
          ...v3,
          tpEmis: 9,
          dhEmi: "2026-08-10T10:00:00-03:00",
          vNF: "10.00",
          privateKeyPem: CHAVE_TESTE_PEM,
          documentoDestinatario: "123",
        }),
      /Documento do consumidor inválido/i,
    );
  });

  it("v2 continua exigindo CSC e idCSC", () => {
    assert.throws(() => gerarQrCodeNfce({ ...v2, csc: "" }), /CSC não informado/i);
    assert.throws(() => gerarQrCodeNfce({ ...v2, idCsc: "" }), /ID do CSC/i);
  });

  it("usa & quando a URL da UF já tem query string", () => {
    const { qrCode } = gerarQrCodeNfce({ ...v3, urlConsulta: "https://uf.exemplo/c?origem=qr" });
    assert.ok(qrCode.includes("?origem=qr&p="));
  });
});

describe("versão 3 é o padrão e não depende de CSC", () => {
  it("sem versão informada, sai v3", () => {
    // A SVRS — autorizadora da PB — está com a NT 2025.001 em produção desde
    // 01/09/2025. O CSC deixou de ser requisito operacional.
    const { versao, qrCode } = gerarQrCodeNfce(base);
    assert.equal(versao, QRCODE_VERSAO_3);
    assert.equal(parametros(qrCode).length, 3);
  });

  it("gera sem CSC e sem idCSC cadastrados", () => {
    const semCredencial = gerarQrCodeNfce({ ...base, csc: undefined, idCsc: undefined });
    assert.ok(semCredencial.qrCode.includes("|3|2"));
  });

  it("nem sequer usa o CSC quando ele existe", () => {
    // Passar CSC junto não pode mudar nada na v3.
    const comCsc = gerarQrCodeNfce({ ...base, csc: CSC, idCsc: "000001" });
    const semCsc = gerarQrCodeNfce(base);
    assert.equal(comCsc.qrCode, semCsc.qrCode);
    assert.ok(!comCsc.qrCode.includes(CSC));
  });

  it("v2 continua disponível como compatibilidade", () => {
    const { versao, qrCode } = gerarQrCodeNfce(v2);
    assert.equal(versao, QRCODE_VERSAO_2);
    assert.equal(parametros(qrCode).length, 5);
  });
});

describe("URL do QR Code: protocolo é validado pela SEFAZ", () => {
  it("preserva http:// literalmente — nada de promover para https", () => {
    // ZX02-20 compara o endereço; "corrigir" o protocolo devolve rejeição 395.
    const { qrCode } = gerarQrCodeNfce(base);
    assert.ok(qrCode.startsWith("http://www.sefaz.pb.gov.br/nfcehom?p="));
    assert.ok(!qrCode.startsWith("https://"));
  });

  it("urlChave é campo separado do QR Code (ZX03 x ZX02)", () => {
    const { qrCode, urlChave } = gerarQrCodeNfce({
      ...base,
      urlConsulta: "http://uf.exemplo/qrcode",
      urlChave: "http://uf.exemplo/consulta-por-chave",
    });

    assert.ok(qrCode.startsWith("http://uf.exemplo/qrcode?p="));
    assert.equal(urlChave, "http://uf.exemplo/consulta-por-chave");
  });

  it("sem urlChave própria, repete a do QR Code", () => {
    assert.equal(gerarQrCodeNfce(base).urlChave, URL);
  });
});

describe("infNFeSupl", () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">' +
    '<infNFe Id="NFe123" versao="4.00"><ide></ide></infNFe>' +
    "</NFe>";

  it("entra logo depois de </infNFe>, onde o schema exige", () => {
    const resultado = injetarInfNFeSupl(xml, gerarQrCodeNfce(v3));
    assert.ok(resultado.includes("</infNFe><infNFeSupl>"));
    assert.ok(resultado.includes(`<urlChave>${URL}</urlChave>`));
  });

  it("não duplica o grupo", () => {
    const qr = gerarQrCodeNfce(v3);
    assert.throws(() => injetarInfNFeSupl(injetarInfNFeSupl(xml, qr), qr), /já possui/i);
  });
});
