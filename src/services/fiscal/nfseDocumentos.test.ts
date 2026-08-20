import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { downloadNfsePdf } from "@/lib/nfse-pdf-download";
import { extractNfseUrls } from "@/lib/nfse-urls";

describe("URLs de documentos da NFS-e", () => {
  it("separa o espelho HTML do PDF retornado pela Focus", () => {
    const urls = extractNfseUrls({
      url: "https://api.focusnfe.com.br/notas_fiscais_servico/nota.html",
      url_danfse: "https://focusnfe.s3.amazonaws.com/DANFSEs/nota.pdf",
    });

    assert.equal(urls.consultationUrl, "https://api.focusnfe.com.br/notas_fiscais_servico/nota.html");
    assert.equal(urls.pdfUrl, "https://focusnfe.s3.amazonaws.com/DANFSEs/nota.pdf");
  });

  it("não usa o espelho HTML como fallback de PDF", () => {
    const urls = extractNfseUrls({ url: "https://prefeitura.example/consulta/nota" });

    assert.equal(urls.consultationUrl, "https://prefeitura.example/consulta/nota");
    assert.equal(urls.pdfUrl, null);
  });

  it("transforma um caminho relativo de DANFSe em URL absoluta", () => {
    const urls = extractNfseUrls(
      { caminho_danfse: "/arquivos/DANFSEs/nota.pdf" },
      "https://api.focusnfe.com.br",
    );

    assert.equal(urls.pdfUrl, "https://api.focusnfe.com.br/arquivos/DANFSEs/nota.pdf");
  });

  it("separa o XML da nota do PDF e do espelho", () => {
    const urls = extractNfseUrls(
      {
        url: "https://receita.joaopessoa.pb.gov.br/notafiscal-ws/consulta",
        url_danfse: "https://focusnfe.s3.sa-east-1.amazonaws.com/arquivos/DANFSEs/nota.pdf",
        caminho_xml_nota_fiscal: "/arquivos/12260723000109/202608/XMLsNFSe/nota-nfse.xml",
      },
      "https://api.focusnfe.com.br",
    );

    assert.equal(urls.xmlUrl, "https://api.focusnfe.com.br/arquivos/12260723000109/202608/XMLsNFSe/nota-nfse.xml");
    assert.equal(urls.pdfUrl, "https://focusnfe.s3.sa-east-1.amazonaws.com/arquivos/DANFSEs/nota.pdf");
    assert.equal(urls.consultationUrl, "https://receita.joaopessoa.pb.gov.br/notafiscal-ws/consulta");
  });

  it("não inventa XML para nota que ainda não autorizou", () => {
    const urls = extractNfseUrls({ status: "erro_autorizacao" }, "https://api.focusnfe.com.br");

    assert.equal(urls.xmlUrl, null);
  });
});

describe("download do PDF da NFS-e", () => {
  it("repete quando o provedor devolve HTML antes de publicar o PDF", async () => {
    const responses = [
      new Response("<html>Documento em preparação</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      new Response("%PDF-1.7\nconteudo", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    ];
    const fetchImpl = (async () => responses.shift()!) as typeof fetch;

    const result = await downloadNfsePdf("https://focus.example/nota.pdf", {
      fetchImpl,
      retryDelaysMs: [0],
      timeoutMs: 1_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.length, 2);
    if (result.ok) assert.equal(result.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("rejeita definitivamente uma página HTML", async () => {
    const fetchImpl = (async () => new Response("<html>Consulta</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as typeof fetch;

    const result = await downloadNfsePdf("https://prefeitura.example/consulta", {
      fetchImpl,
      maxAttempts: 2,
      retryDelaysMs: [0],
      timeoutMs: 1_000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.length, 2);
    if (!result.ok) assert.match(result.message, /ainda não retornou um PDF/);
  });
});
