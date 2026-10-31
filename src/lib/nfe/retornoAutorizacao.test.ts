import assert from "node:assert/strict";
import test from "node:test";
import { buildEnviNFeXml } from "./enviNFe";
import { classificarRetornoAutorizacao, motivoBloqueioTransmissao } from "./retornoAutorizacao";

const retorno = { lote: "104", protocolo: "100", numeroProtocolo: "125260000000001", chaveProtocolo: "1".repeat(44), chaveEnviada: "1".repeat(44) };

test("documentos com desfecho e transmissões incertas exigem consulta, preservando reenvio offline", () => {
  for (const status of ["AUTORIZADA", "CANCELADA", "DENEGADA", "RESULTADO_INCERTO", "ENVIADA"]) {
    assert.ok(motivoBloqueioTransmissao(status));
  }
  for (const status of ["RASCUNHO", "ASSINADA", "PENDENTE_ENVIO", "CONTINGENCIA", "REJEITADA"]) {
    assert.equal(motivoBloqueioTransmissao(status), null);
  }
});

test("preserva solicitação síncrona e classifica a autorização correspondente à chave enviada", () => {
  assert.match(buildEnviNFeXml("<NFe/>"), /<indSinc>1<\/indSinc>/);
  assert.equal(classificarRetornoAutorizacao(retorno), "AUTORIZADA");
  assert.equal(classificarRetornoAutorizacao({ ...retorno, chaveProtocolo: "2".repeat(44) }), "RESULTADO_INCERTO");
  assert.equal(classificarRetornoAutorizacao({ ...retorno, numeroProtocolo: null }), "RESULTADO_INCERTO");
});

test("retornos sem protocolo e duplicidade não liberam numeração nem autorizam o DANFE", () => {
  for (const lote of [null, "104", "105", "108", "999", "204"]) {
    assert.equal(classificarRetornoAutorizacao({ ...retorno, lote, protocolo: null }), "RESULTADO_INCERTO");
  }
  assert.equal(classificarRetornoAutorizacao({ ...retorno, protocolo: "204" }), "RESULTADO_INCERTO");
  assert.equal(classificarRetornoAutorizacao({ ...retorno, lote: "103", protocolo: null }), "ENVIADA");
  assert.equal(classificarRetornoAutorizacao({ ...retorno, protocolo: "539" }), "REJEITADA");
  assert.equal(classificarRetornoAutorizacao({ ...retorno, protocolo: "110" }), "DENEGADA");
});
