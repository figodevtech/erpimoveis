import assert from "node:assert/strict";
import test from "node:test";

import {
  interpretarRespostaConsultaProtocolo,
  montarSoapConsultaProtocolo,
} from "./nfeConsultaProtocoloService";

const CHAVE = "25260912260723000109550030000001521061121040";

test("monta a consulta com ambiente e chave da NF-e", () => {
  const soap = montarSoapConsultaProtocolo(CHAVE, "PRODUCAO");

  assert.match(soap, /<tpAmb>1<\/tpAmb>/);
  assert.match(soap, new RegExp(`<chNFe>${CHAVE}<\\/chNFe>`));
  assert.match(soap, /<xServ>CONSULTAR<\/xServ>/);
});

test("extrai autorização e protocolo da consulta após duplicidade", () => {
  const resposta = `
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
      <soap:Body>
        <nfeResultMsg>
          <retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
            <cStat>100</cStat>
            <xMotivo>Autorizado o uso da NF-e</xMotivo>
            <protNFe versao="4.00">
              <infProt>
                <cStat>100</cStat>
                <xMotivo>Autorizado o uso da NF-e</xMotivo>
                <nProt>225260043999999</nProt>
                <dhRecbto>2026-09-20T19:31:40-03:00</dhRecbto>
              </infProt>
            </protNFe>
          </retConsSitNFe>
        </nfeResultMsg>
      </soap:Body>
    </soap:Envelope>`;

  const resultado = interpretarRespostaConsultaProtocolo(resposta);

  assert.equal(resultado.cStat, "100");
  assert.equal(resultado.protocolo.cStat, "100");
  assert.equal(resultado.protocolo.nProt, "225260043999999");
  assert.equal(resultado.protocolo.dhRecbto, "2026-09-20T19:31:40-03:00");
  assert.match(resultado.protNFeXml ?? "", /<protNFe/);
});
