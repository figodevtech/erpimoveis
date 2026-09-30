/**
 * Extrato de amostra para os testes.
 *
 * Reproduz o que foi observado no arquivo real usado nesta implementação:
 * OFXSGML 1.x, créditos e débitos, PIX, boleto, IOF, juros, tarifa, conta de
 * água, débito automático — e, de propósito, DOIS movimentos diferentes com o
 * MESMO `FITID`, que é um dos motivos de o fingerprint não depender dele (o
 * outro está em `EXTRATO_C6_*`).
 *
 * Traz também duas linhas rigorosamente idênticas (duas tarifas de R$ 2,90 no
 * mesmo dia), que são dois fatos e precisam sobreviver como dois movimentos.
 */
export const EXTRATO_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20260901120000[-3:BRT]
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>104
<BRANCHID>1234
<ACCTID>000012345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801000000[-3:BRT]
<DTEND>20260831235959[-3:BRT]
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260801120000[-3:BRT]
<TRNAMT>970.00
<FITID>202608010001
<MEMO>CRED PIX RECEBIDO MARIA SOUZA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260803120000[-3:BRT]
<TRNAMT>-4118.00
<FITID>202608030001
<MEMO>PAGAMENTO DE BOLETO DISTRIBUIDORA XYZ
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260803120000[-3:BRT]
<TRNAMT>-31.57
<FITID>202608030001
<MEMO>DEBITO DE IOF
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260804120000[-3:BRT]
<TRNAMT>-5835.69
<FITID>202608040001
<NAME>FORNECEDOR XYZ LTDA
<MEMO>PAGAMENTO DE BOLETO
</STMTTRN>
<STMTTRN>
<TRNTYPE>FEE
<DTPOSTED>20260805120000[-3:BRT]
<TRNAMT>-2.90
<FITID>202608050001
<MEMO>TARIFA BANCARIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>FEE
<DTPOSTED>20260805120000[-3:BRT]
<TRNAMT>-2.90
<FITID>202608050001
<MEMO>TARIFA BANCARIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>INT
<DTPOSTED>20260806120000[-3:BRT]
<TRNAMT>-18.44
<FITID>202608060001
<MEMO>COBRANCA DE JUROS
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260810120000[-3:BRT]
<TRNAMT>-1000.00
<FITID>202608100001
<MEMO>DEB PIX ENVIADO
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260812120000[-3:BRT]
<TRNAMT>-143.71
<FITID>202608120001
<MEMO>PAGAMENTO AGUA CAGEPA
</STMTTRN>
<STMTTRN>
<TRNTYPE>XFER
<DTPOSTED>20260815120000[-3:BRT]
<DTAVAIL>20260816120000[-3:BRT]
<TRNAMT>2500.00
<CHECKNUM>778812
<MEMO>TRANSFERENCIA ENTRE CONTAS
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>12345.69
<DTASOF>20260831235959[-3:BRT]
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

/** O mesmo extrato no dialeto XML (OFX 2.x), com uma linha só. */
export const EXTRATO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>BRL</CURDEF>
        <BANKACCTFROM>
          <BANKID>341</BANKID>
          <BRANCHID>0001</BRANCHID>
          <ACCTID>98765-4</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20260801000000</DTSTART>
          <DTEND>20260831000000</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260807000000</DTPOSTED>
            <TRNAMT>-250.35</TRNAMT>
            <FITID>XYZ-1</FITID>
            <MEMO>TED ENVIADA JOAO &amp; CIA</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`;

/**
 * Uma linha do extrato C6: o FITID é o id da exportação mais um sufixo, e o
 * REFNUM é o do banco — estável entre exportações.
 */
interface LinhaC6 {
  tipo: "CREDIT" | "DEBIT";
  data: string;
  valor: string;
  sufixo: string;
  refnum: string;
  memo: string;
}

const LINHAS_C6: LinhaC6[] = [
  { tipo: "CREDIT", data: "20260831095908", valor: "3344.4", sufixo: "P5QZ", refnum: "255385557270347365856937065921595386232", memo: "Pix Cashout Transfer" },
  { tipo: "CREDIT", data: "20260901092135", valor: "4273.4", sufixo: "RRV8", refnum: "170760045912946546991965648083993212327", memo: "Pix Cashout Transfer" },
  { tipo: "DEBIT", data: "20260915153834", valor: "-1315.0", sufixo: "JGZB", refnum: "27031588568560517332395369876251281103", memo: "1000 mais 315 Almoço " },
  { tipo: "DEBIT", data: "20260915154126", valor: "-2500.0", sufixo: "ESXK", refnum: "231358419400007266031609015454654005294", memo: "TRANSF ENVIADA PIX" },
  { tipo: "DEBIT", data: "20260915154229", valor: "-2500.0", sufixo: "9861", refnum: "273165280962220317217832418866598129939", memo: "TRANSF ENVIADA PIX" },
  { tipo: "CREDIT", data: "20260918112447", valor: "950.0", sufixo: "YXHQ", refnum: "316083157956188376249559384901316849341", memo: "Oficina Garage Premium" },
];

function extratoC6(exportadoEm: string, idDoArquivo: string, linhas: LinhaC6[]): string {
  const movimentos = linhas
    .map(
      (linha) => `          <STMTTRN>
            <TRNTYPE>${linha.tipo}</TRNTYPE>
            <DTPOSTED>${linha.data}[-3:BRT]</DTPOSTED>
            <TRNAMT>${linha.valor}</TRNAMT>
            <FITID>${idDoArquivo}${linha.sufixo}</FITID>
            <REFNUM>${linha.refnum}</REFNUM>
            <MEMO>${linha.memo}</MEMO>
          </STMTTRN>`,
    )
    .join("\n");

  return `OFXHEADER: 100
DATA: OFXSGML
VERSION: 102
SECURITY: NONE
ENCODING: UTF - 8
CHARSET: 1252
COMPRESSION: NONE
OLDFILEUID: NONE
NEWFILEUID: NONE
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>BRL</CURDEF>
        <BANKACCTFROM>
          <BANKID>336</BANKID>
          <BRANCHID>1</BRANCHID>
          <ACCTID>281170592</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>${exportadoEm}[-3:BRT]</DTSTART>
          <DTEND>${exportadoEm}[-3:BRT]</DTEND>
${movimentos}
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`;
}

/**
 * Duas exportações do C6 com período sobreposto, como as da Garage Premium.
 *
 * O que o banco faz e o sistema precisa aguentar: o FITID muda a cada
 * exportação (o mesmo movimento vem com outro FITID), DTSTART e DTEND são o
 * instante da exportação, e não há LEDGERBAL.
 */
export const EXTRATO_C6_15_09 = extratoC6("20260915172033", "01M2KBMY2Y", LINHAS_C6.slice(0, 5));
export const EXTRATO_C6_22_09 = extratoC6("20260922121649", "01M34V1TM1", LINHAS_C6.slice(1));
