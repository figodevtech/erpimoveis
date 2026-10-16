import assert from "node:assert/strict";
import { test } from "node:test";
import { mercadoLivreSearchUrl, parseMercadoLivreSearchHtml } from "./mercadolivre-site-prices";

function card(id: number, value: string, cents = "00") {
  return `<li class="ui-search-layout__item">
    <a class="poly-component__title" href="https://produto.mercadolivre.com.br/MLB-${id}-peca-_JM">Peça ${id}</a>
    <div class="poly-price__current"><span class="andes-money-amount__fraction">${value}</span>
      <span class="andes-money-amount__cents">${cents}</span>
    </div>
  </li>`;
}

test("busca pública usa título normalizado na URL", () => {
  assert.equal(mercadoLivreSearchUrl("Módulo Freio ABS HRV"), "https://lista.mercadolivre.com.br/modulo-freio-abs-hrv");
});

test("extrai os cinco primeiros preços válidos na ordem do HTML", () => {
  const html = Array.from({ length: 8 }, (_, i) => card(i + 100, String(100 + i), "50")).join("");
  const result = parseMercadoLivreSearchHtml(html);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((item) => item.price), [100.5, 101.5, 102.5, 103.5, 104.5]);
  assert.equal(result[0].id, "MLB100");
});

test("ignora card sem preço e usa até cinco resultados válidos", () => {
  const html = `<li class="ui-search-layout__item"><a class="poly-component__title" href="https://produto.mercadolivre.com.br/MLB-10-x">Produto sem valor</a></li>` + card(11, "1.250", "90");
  assert.equal(parseMercadoLivreSearchHtml(html).length, 1);
  assert.equal(parseMercadoLivreSearchHtml(html)[0].price, 1250.9);
});

test("rejeita link externo e não retorna preço inventado", () => {
  const html = `<li class="ui-search-layout__item"><a class="poly-component__title" href="https://example.com/malicious">Produto externo</a><div class="poly-price__current"><span class="andes-money-amount__fraction">300</span></div></li>`;
  assert.deepEqual(parseMercadoLivreSearchHtml(html), []);
});
