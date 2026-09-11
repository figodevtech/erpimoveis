import assert from "node:assert/strict";
import test from "node:test";
import {
  describeMercadoLivreListingStatus,
  moderationReferenceId,
  normalizeMercadoLivreModeration,
  normalizeWrongCategoryDiagnosis,
  parseModerationText,
} from "./mercadolivre-listing-status";

test("anuncio ativo nao pede acao", () => {
  const info = describeMercadoLivreListingStatus({ status: "active", subStatus: [] });
  assert.equal(info.label, "Ativo");
  assert.equal(info.requiresAction, false);
  assert.equal(info.detail, null);
});

test("distingue finalizado pelo vendedor de finalizado pelo Mercado Livre", () => {
  const vendedor = describeMercadoLivreListingStatus({ status: "closed", subStatus: [] });
  assert.equal(vendedor.label, "Finalizado");
  assert.equal(vendedor.closedByMercadoLivre, false);

  const moderado = describeMercadoLivreListingStatus({ status: "closed", subStatus: ["waiting_for_patch"] });
  assert.equal(moderado.label, "Finalizado pelo Mercado Livre");
  assert.equal(moderado.closedByMercadoLivre, true);
  assert.ok(moderado.detail);
});

test("em analise explica o sub_status em vez de repetir o status", () => {
  const info = describeMercadoLivreListingStatus({ status: "under_review", subStatus: ["held"] });
  assert.equal(info.label, "Em análise pelo Mercado Livre");
  assert.equal(info.detail, "O anúncio está oculto aguardando revisão manual do Mercado Livre.");
  assert.equal(info.tone, "review");
});

test("pausado por falta de estoque nao pede acao; pausado pelo vendedor pede", () => {
  const semEstoque = describeMercadoLivreListingStatus({ status: "paused", subStatus: ["out_of_stock"] });
  assert.equal(semEstoque.requiresAction, false);

  const peloVendedor = describeMercadoLivreListingStatus({ status: "paused", subStatus: ["paused_by_seller"] });
  assert.equal(peloVendedor.requiresAction, true);
});

test("excluido tem rotulo proprio e nao volta", () => {
  const info = describeMercadoLivreListingStatus({ status: "closed", subStatus: ["deleted"] });
  assert.equal(info.label, "Excluído");
  assert.equal(info.deleted, true);
});

test("le sub_status vindo das tags do item", () => {
  const info = describeMercadoLivreListingStatus({ status: "paused", tags: ["moderation_penalty"] });
  assert.equal(info.requiresAction, true);
  assert.ok(info.detail?.includes("preventivamente"));
});

test("normaliza a ultima moderacao com motivo, remedio e evidencia", () => {
  const moderation = normalizeMercadoLivreModeration([
    {
      name: "PAUSED_PREVENTION_PRICE",
      id: "7123400818",
      date_created: "2022-10-25 15:57:46.0",
      wordings: [
        { type: "REASON", value: "Pausamos porque detectamos uma alteração incomum no preço." },
        { type: "REMEDY", value: "Verifique o valor antes de reativá-la." },
      ],
      evidence: [{ text_matched: "O preço alertado é 77393.720000", section_name: "item" }],
    },
  ]);

  assert.equal(moderation?.code, "PAUSED_PREVENTION_PRICE");
  assert.equal(moderation?.reason, "Pausamos porque detectamos uma alteração incomum no preço.");
  assert.equal(moderation?.remedy, "Verifique o valor antes de reativá-la.");
  assert.deepEqual(moderation?.evidence, ["O preço alertado é 77393.720000"]);
});

test("moderacao vazia vira null em vez de um objeto sem conteudo", () => {
  assert.equal(normalizeMercadoLivreModeration([]), null);
  assert.equal(normalizeMercadoLivreModeration(null), null);
  assert.equal(normalizeMercadoLivreModeration([{ wordings: [], evidence: [] }]), null);
});

test("a referencia da moderacao usa o sufixo -ITM", () => {
  assert.equal(moderationReferenceId("mlb7614175096"), "MLB7614175096-ITM");
});

test("extrai o link das frases de moderacao em vez de mostrar o HTML cru", () => {
  const segments = parseModerationText(
    "Verifique as categorias possíveis <a href='http://api.mercadolibre.com/tagging/wrong-domain/prustomer/MLB7614175096' target='_blank'>Aqui</a>",
  );
  assert.deepEqual(segments, [
    { type: "text", text: "Verifique as categorias possíveis" },
    {
      type: "link",
      text: "Aqui",
      href: "http://api.mercadolibre.com/tagging/wrong-domain/prustomer/MLB7614175096",
    },
  ]);
});

test("descarta tags que nao sejam link e decodifica entidades", () => {
  assert.deepEqual(parseModerationText("<b>Categoria</b> incorreta &amp; sem correção"), [
    { type: "text", text: "Categoria incorreta & sem correção" },
  ]);
});

test("um href nao http vira texto, nunca link", () => {
  assert.deepEqual(parseModerationText("Clique <a href=\"javascript:alert(1)\">aqui</a>"), [
    { type: "text", text: "Clique" },
    { type: "text", text: "aqui" },
  ]);
});

test("texto vazio nao gera segmento", () => {
  assert.deepEqual(parseModerationText(""), []);
  assert.deepEqual(parseModerationText(null), []);
});

/* Diagnóstico de categoria -------------------------------------------------- */

const WRONG_CATEGORY = {
  item_id: "MLB7614175096",
  title: "Valvula Dosadora Arla 32 Fase 1",
  category: {
    id: "MLB458502",
    name: "Válvulas Controle Injeção",
    path: "Acessórios para Veículos > Peças de Carros e Caminhonetes > Escapamentos > Ferragens > Válvulas Controle Injeção",
    domain_id: "MLB-VEHICLE_EMISSION_AIR_INJECTION_VALVES",
    search_url: "https://lista.mercadolivre.com.br/acessorios-veiculos/",
    has_me2: true,
  },
  suggested_categories: [
    { id: "MLB432136", name: "Dosadoras de Pó e Grão", path: "Agro > Dosadoras", domain_id: "MLB-POWDER", has_me2: false, score: 0.68 },
    { id: "MLB432421", name: "Válvulas", path: "Eletrodomésticos > Válvulas", domain_id: "MLB-AIR", has_me2: true, score: 0.92 },
    { id: "MLB458502", name: "Válvulas Controle Injeção", path: "…", has_me2: true, score: 0.5 },
  ],
};

test("le a categoria atual e ordena as sugestoes pelo score", () => {
  const diagnosis = normalizeWrongCategoryDiagnosis(WRONG_CATEGORY);
  assert.equal(diagnosis?.current?.id, "MLB458502");
  assert.equal(diagnosis?.current?.hasMe2, true);
  assert.deepEqual(diagnosis?.suggestions.map((entry) => entry.id), ["MLB432421", "MLB432136"]);
  assert.equal(diagnosis?.suggestions[0].score, 0.92);
});

test("a categoria atual nao se repete entre as sugestoes", () => {
  const diagnosis = normalizeWrongCategoryDiagnosis(WRONG_CATEGORY);
  assert.equal(diagnosis?.suggestions.some((entry) => entry.id === "MLB458502"), false);
});

test("guarda se cada categoria aceita Mercado Envios", () => {
  const diagnosis = normalizeWrongCategoryDiagnosis(WRONG_CATEGORY);
  assert.equal(diagnosis?.suggestions.find((entry) => entry.id === "MLB432136")?.hasMe2, false);
});

test("retorno sem categoria alguma vira null", () => {
  assert.equal(normalizeWrongCategoryDiagnosis({}), null);
  assert.equal(normalizeWrongCategoryDiagnosis(null), null);
});
