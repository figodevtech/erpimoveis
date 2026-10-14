import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  descreverRecusaNFSe,
  desfechoDoEnvioNFSe,
  montarRecusaNFSe,
  referenciaJaRecebida,
} from "./nfse-recusa";
import { MENSAGEM_FORA_DO_EMISSOR_NACIONAL_LUCENA } from "./nfse-politica";

const envio = (http: number, corpo: unknown, erros?: unknown, message?: string) => ({
  ok: http >= 200 && http < 300,
  erros,
  message,
  retornoBruto: { http_status: http, corpo },
});

describe("desfecho do envio à Focus", () => {
  it("2xx é aceito; 4xx é rejeição explícita; 5xx e sem resposta são incertos", () => {
    assert.equal(desfechoDoEnvioNFSe(envio(202, { status: "processando_autorizacao" })), "ACEITO");
    for (const http of [400, 401, 403, 404, 422]) {
      assert.equal(desfechoDoEnvioNFSe(envio(http, {}, [{ codigo: "x", mensagem: "y" }])), "REJEITADO", String(http));
    }
    for (const http of [500, 502, 503, 504, 0]) {
      assert.equal(desfechoDoEnvioNFSe(envio(http, "")), "INCERTO", String(http));
    }
  });

  it("referência repetida (422 documentado da Focus) é envio que já chegou", () => {
    const repetida = envio(422, {}, [{ codigo: "erro_validacao", mensagem: "Já existe um DPS com esta referência." }]);
    assert.equal(referenciaJaRecebida(repetida), true);
    assert.equal(desfechoDoEnvioNFSe(repetida), "JA_RECEBIDO");
    assert.equal(referenciaJaRecebida(envio(422, {}, [{ mensagem: "Código de tributação inválido" }])), false);
  });
});

describe("texto da recusa", () => {
  it("mostra provedor, município, ambiente, HTTP, referência, código e mensagem como vieram", () => {
    const recusa = montarRecusaNFSe({
      envio: envio(422, {}, [{ codigo: "E0312", mensagem: "Código de tributação nacional inexistente", correcao: "Informe um cTribNac válido" }]),
      referencia: "OS_1_SRVS_1_1",
      ambiente: "HOMOLOGACAO",
      codigoMunicipio: "2508604",
    });
    assert.equal(
      descreverRecusaNFSe(recusa),
      [
        "Não foi possível autorizar a NFS-e.",
        "Provedor: Focus NFe",
        "Município: Lucena/PB",
        "Ambiente: Homologação",
        "HTTP: 422",
        "Referência: OS_1_SRVS_1_1",
        "",
        "Código: E0312",
        "Mensagem: Código de tributação nacional inexistente",
        "Correção: Informe um cTribNac válido",
      ].join("\n"),
    );
  });

  it("várias rejeições aparecem todas, numeradas", () => {
    const texto = descreverRecusaNFSe(montarRecusaNFSe({
      envio: envio(400, {}, [{ codigo: "A", mensagem: "primeira" }, { codigo: "B", mensagem: "segunda" }]),
      referencia: "r",
      ambiente: "PRODUCAO",
      codigoMunicipio: "2508604",
    }));
    assert.match(texto, /Ambiente: Produção/);
    assert.match(texto, /Rejeição 1 de 2\nCódigo: A\nMensagem: primeira/);
    assert.match(texto, /Rejeição 2 de 2\nCódigo: B\nMensagem: segunda/);
  });

  it("401 em text/html: o corpo cru e a orientação de credencial, sem token", () => {
    const texto = descreverRecusaNFSe(montarRecusaNFSe({
      envio: envio(401, "HTTP Basic: Access denied.", [], "Erro 401 ao emitir NFS-e Nacional"),
      referencia: "r",
      ambiente: "HOMOLOGACAO",
      codigoMunicipio: "2508604",
    }));
    assert.match(texto, /HTTP: 401/);
    assert.match(texto, /Resposta: HTTP Basic: Access denied\./);
    assert.match(texto, /confira o token da Focus do ambiente Homologação/);
  });

  it("E0039 em Lucena: retorno original primeiro, complemento depois como observação", () => {
    const texto = descreverRecusaNFSe(montarRecusaNFSe({
      envio: envio(422, {}, [{ codigo: "E0039", mensagem: "O município emissor informado na DPS deve estar parametrizado para utilizar os emissores públicos nacionais" }]),
      referencia: "r",
      ambiente: "HOMOLOGACAO",
      codigoMunicipio: "2508604",
    }));
    const original = texto.indexOf("Mensagem: O município emissor");
    const complemento = texto.indexOf(`Observação: ${MENSAGEM_FORA_DO_EMISSOR_NACIONAL_LUCENA}`);
    assert.ok(original > 0 && complemento > original);
    assert.doesNotMatch(texto, /João Pessoa/);
  });

  it("sem E0039, nenhuma observação de município", () => {
    const recusa = montarRecusaNFSe({
      envio: envio(422, {}, [{ codigo: "X1", mensagem: "outro" }]),
      referencia: "r",
      ambiente: "HOMOLOGACAO",
      codigoMunicipio: "2508604",
    });
    assert.deepEqual(recusa.observacoes, []);
  });
});
