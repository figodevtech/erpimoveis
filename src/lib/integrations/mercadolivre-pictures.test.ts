import assert from "node:assert/strict";
import test from "node:test";
import { mercadoLivrePictureUrlFromUpload } from "./mercadolivre-pictures";

test("usa a maior variação devolvida pelo upload do Mercado Livre", () => {
  assert.equal(
    mercadoLivrePictureUrlFromUpload({
      id: "123-MLB1_092026",
      max_size: "1200x900",
      variations: [
        { size: "500x375", secure_url: "https://http2.mlstatic.com/D_123-O.jpg" },
        { size: "1200x900", secure_url: "https://http2.mlstatic.com/D_123-F.jpg" },
      ],
    }),
    "https://http2.mlstatic.com/D_123-F.jpg",
  );
});

test("cai para a primeira variação e para url quando falta secure_url", () => {
  assert.equal(
    mercadoLivrePictureUrlFromUpload({ variations: [{ size: "500x500", url: "http://http2.mlstatic.com/D_9-O.jpg" }] }),
    "http://http2.mlstatic.com/D_9-O.jpg",
  );
  assert.equal(mercadoLivrePictureUrlFromUpload({ id: "sem-variacoes" }), null);
  assert.equal(mercadoLivrePictureUrlFromUpload(null), null);
});
