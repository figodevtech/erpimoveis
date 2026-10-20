import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  corpoDoPatch,
  deduzirResposta,
  inventarioAplicavelNaCompetencia,
  patchDaResposta,
  planejarDeducao,
  respostaAtual,
  SPED_PERGUNTAS,
  type SpedFatosEmpresa,
} from "./configuracao-empresa";

/** Oficina mecânica na Paraíba, Simples Nacional, que recebe por cartão. */
const oficinaSimples: SpedFatosEmpresa = {
  uf: "PB",
  regimeTributario: "1",
  cnae: "4520001",
  recebeCartaoOuPix: true,
  importaDoExterior: false,
};

const oficinaNormal: SpedFatosEmpresa = { ...oficinaSimples, regimeTributario: "3" };

/** Aplica o corpo como o servidor grava: campos na linha, evidências e políticas nas evidências. */
function gravar(corpo: Record<string, unknown>): Record<string, unknown> {
  const { evidencias = {}, politicas = {}, ...campos } = corpo as Record<string, Record<string, unknown>>;
  const evidence: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(evidencias)) {
    if (chave === "indicadores_1010") continue;
    evidence[chave] = { ...(valor as object), status: "CONFIRMADO" };
  }
  evidence.indicadores_1010 = evidencias.indicadores_1010 ?? {};
  if (politicas.creditoRevenda) evidence.politica_credito_revenda = { ...(politicas.creditoRevenda as object), status: "CONFIRMADO" };
  if (politicas.csosnEntrada) evidence.politica_csosn_entrada = { ...(politicas.csosnEntrada as object), status: "CONFIRMADO" };
  return { ...campos, evidencias: evidence };
}

describe("dedução pelo cadastro", () => {
  it("oficina do Simples na PB: só fica pergunta o que depende do contador ou da operação", () => {
    const plano = planejarDeducao({}, oficinaSimples);
    const pendentes = SPED_PERGUNTAS.map((pergunta) => pergunta.id).filter((id) => !plano.perguntas.includes(id));
    // GIAF é só de PE e não aparece; 1400 depende de operação específica do estado.
    assert.deepEqual(pendentes.filter((id) => !id.startsWith("giaf")), ["registro1400"]);
    const campos = gravar(corpoDoPatch(plano.patch));
    assert.equal(campos.perfil_efd, "B");
    assert.equal(campos.indicador_atividade, "1");
    assert.equal(campos.contribuinte_ipi, false);
    assert.equal(campos.entrega_efd_contribuicoes, false);
    assert.equal(campos.bloco_k_obrigatorio, false);
    assert.equal(campos.registro_1601_aplicavel, true);
    assert.equal(respostaAtual("creditoRevenda", campos)?.valor, "NAO");
    assert.equal(respostaAtual("creditoAcumulado", campos)?.valor, "NAO");
    assert.equal(respostaAtual("csosn", campos)?.valor, "PADRAO");
  });

  it("regime normal: entrega EFD-Contribuições, credita revenda e pergunta o crédito acumulado ao contador", () => {
    assert.equal(deduzirResposta("efdContribuicoes", oficinaNormal)?.valor, "SIM");
    assert.equal(deduzirResposta("creditoRevenda", oficinaNormal)?.valor, "SIM");
    assert.equal(deduzirResposta("creditoAcumulado", oficinaNormal), null);
    assert.equal(deduzirResposta("blocoK", oficinaNormal)?.valor, "NAO");
  });

  it("Simples com excesso de sublimite recolhe ICMS no regime normal e credita", () => {
    const excesso = { ...oficinaSimples, regimeTributario: "2" };
    assert.equal(deduzirResposta("creditoRevenda", excesso)?.valor, "SIM");
    assert.equal(deduzirResposta("efdContribuicoes", excesso)?.valor, "NAO");
    assert.equal(deduzirResposta("blocoK", excesso)?.valor, "NAO");
  });

  it("indústria no regime normal: atividade industrial, IPI e Bloco K", () => {
    const industria = { ...oficinaNormal, cnae: "2930101" };
    assert.equal(deduzirResposta("industria", industria)?.valor, "SIM");
    assert.equal(deduzirResposta("blocoK", industria)?.valor, "SIM");
    assert.equal(deduzirResposta("blocoK", { ...oficinaNormal, cnae: "4530701" })?.valor, "NAO");
    assert.equal(deduzirResposta("blocoK", { ...oficinaNormal, cnae: "4681801" })?.valor, "SIM");
  });

  it("importador é equiparado a industrial", () => {
    assert.equal(deduzirResposta("industria", { ...oficinaSimples, importaDoExterior: true })?.valor, "SIM");
  });

  it("perfil: B na PB e em PE, A para energia e comunicação, pergunta nas demais UFs", () => {
    assert.equal(deduzirResposta("perfil", oficinaSimples)?.valor, "B");
    assert.equal(deduzirResposta("perfil", { ...oficinaSimples, uf: "PE" })?.valor, "B");
    assert.equal(deduzirResposta("perfil", { ...oficinaSimples, cnae: "6110801" })?.valor, "A");
    assert.equal(deduzirResposta("perfil", { ...oficinaSimples, uf: "SP" }), null);
  });

  it("sem dados não deduz: cadastro incompleto vira pergunta", () => {
    const vazio: SpedFatosEmpresa = { uf: null, regimeTributario: null, cnae: null, recebeCartaoOuPix: null, importaDoExterior: null };
    for (const id of ["industria", "perfil", "cartaoPix", "efdContribuicoes", "blocoK", "creditoRevenda", "combustiveis"] as const) {
      assert.equal(deduzirResposta(id, vazio), null, id);
    }
  });

  it("financeiro sem cartão/PIX não prova que a empresa não recebe assim: pergunta", () => {
    assert.equal(deduzirResposta("cartaoPix", { ...oficinaSimples, recebeCartaoOuPix: false }), null);
  });

  it("atividades do 1010 saem do CNAE; óleo lubrificante não é combustível", () => {
    assert.equal(deduzirResposta("combustiveis", oficinaSimples)?.valor, "NAO");
    assert.equal(deduzirResposta("combustiveis", { ...oficinaSimples, cnae: "4731800" })?.valor, "SIM");
    assert.equal(deduzirResposta("energia", { ...oficinaSimples, cnae: "3514000" })?.valor, "SIM");
    assert.equal(deduzirResposta("aereo", { ...oficinaSimples, cnae: "5111100" })?.valor, "SIM");
  });
});

describe("respostas já dadas", () => {
  it("a dedução nunca troca uma resposta existente", () => {
    const campos = gravar(corpoDoPatch(patchDaResposta("perfil", "A", "Contador informou perfil A", "RESPOSTA")));
    const plano = planejarDeducao(campos, oficinaSimples);
    assert.equal(plano.perguntas.includes("perfil"), false);
    assert.equal(plano.patch.campos.perfil_efd, undefined);
  });

  it("a resposta de quem opera guarda a origem e o texto da pergunta", () => {
    const corpo = corpoDoPatch(patchDaResposta("cartaoPix", "NAO", "Resposta: Não", "RESPOSTA"));
    assert.equal(corpo.registro_1601_aplicavel, false);
    assert.equal(corpo.registro_1601_status, "CONFIRMADO");
    assert.deepEqual((corpo.evidencias as Record<string, unknown>)["1601"], { descricao: "Resposta: Não", origem: "RESPOSTA" });
  });

  it("indicador do 1010 vai no formato que o servidor valida", () => {
    const corpo = corpoDoPatch(patchDaResposta("combustiveis", "NAO", "CNAE", "AUTOMATICA"));
    const indicadores = (corpo.evidencias as Record<string, Record<string, unknown>>).indicadores_1010;
    assert.deepEqual(indicadores.IND_COMB, { valor: "N", status: "CONFIRMADO", descricao: "CNAE", origem: "AUTOMATICA" });
  });
});

describe("inventário automático", () => {
  const campos = gravar(corpoDoPatch(patchDaResposta("inventario", "AUTOMATICO", "Lei", "AUTOMATICA")));

  it("só fevereiro leva o inventário", () => {
    assert.equal(inventarioAplicavelNaCompetencia(campos, "2027-02"), true);
    assert.equal(inventarioAplicavelNaCompetencia(campos, "2026-08"), false);
    assert.equal(inventarioAplicavelNaCompetencia(campos, "2026-12"), false);
  });

  it("decisão manual do contador continua valendo como está", () => {
    assert.equal(inventarioAplicavelNaCompetencia({ inventario_status: "CONFIRMADO", inventario_aplicavel: true }, "2026-08"), true);
    assert.equal(inventarioAplicavelNaCompetencia({ inventario_status: "CONFIRMADO", inventario_aplicavel: false }, "2027-02"), false);
  });
});
