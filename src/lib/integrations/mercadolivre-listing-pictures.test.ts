import assert from "node:assert/strict";
import test from "node:test";
import {
  countDistinctMercadoLivrePictures,
  getMercadoLivreEditPictureRequirement,
  getMercadoLivrePictureRequirement,
  mercadoLivrePictureRequirementMessage,
  MIN_MERCADO_LIVRE_LISTING_PICTURES,
  parseMercadoLivrePictureUrls,
} from "./mercadolivre-listing-pictures";

test("exige pelo menos três fotos públicas válidas e distintas", () => {
  assert.equal(MIN_MERCADO_LIVRE_LISTING_PICTURES, 3);
  assert.deepEqual(getMercadoLivrePictureRequirement(""), { urls: [], count: 0, missing: 3, valid: false });
  assert.equal(getMercadoLivrePictureRequirement("https://img.test/1.jpg\nhttps://img.test/2.jpg").valid, false);
  assert.equal(getMercadoLivrePictureRequirement("https://img.test/1.jpg\nhttps://img.test/2.jpg\nhttps://img.test/3.jpg").valid, true);
});

test("conta fotos distintas já persistidas pelo Mercado Livre", () => {
  assert.equal(countDistinctMercadoLivrePictures([
    { id: "MLB-1", secure_url: "https://img.test/1.jpg" },
    { id: "MLB-2", secure_url: "https://img.test/2.jpg" },
    { id: "MLB-2", secure_url: "https://img.test/2-outra.jpg" },
    "https://img.test/3.jpg",
  ]), 3);
});

test("edição valida as fotos atuais quando pictureUrl não foi alterado", () => {
  const currentPictures = [{ id: "1" }, { id: "2" }, { id: "3" }];
  assert.equal(getMercadoLivreEditPictureRequirement({ currentPictures, pictureUrlProvided: false }).valid, true);
  assert.equal(getMercadoLivreEditPictureRequirement({ currentPictures: currentPictures.slice(0, 2), pictureUrlProvided: false }).valid, false);
});

test("edição usa a nova lista completa quando pictureUrl foi alterado", () => {
  const result = getMercadoLivreEditPictureRequirement({
    currentPictures: [{ id: "1" }, { id: "2" }, { id: "3" }],
    pictureUrlProvided: true,
    pictureUrl: "https://img.test/nova-1.jpg\nhttps://img.test/nova-2.jpg",
  });
  assert.equal(result.valid, false);
  assert.equal(result.count, 2);
});

test("ignora linhas vazias, protocolos inválidos e URLs repetidas", () => {
  const urls = parseMercadoLivrePictureUrls([
    "https://img.test/foto.jpg",
    " https://img.test/foto.jpg ",
    "ftp://img.test/outra.jpg",
    "não é url",
    "",
    "http://img.test/terceira.jpg",
  ].join("\n"));

  assert.deepEqual(urls, ["https://img.test/foto.jpg", "http://img.test/terceira.jpg"]);
  assert.match(mercadoLivrePictureRequirementMessage(urls.length), /Adicione mais 1 foto/);
});
