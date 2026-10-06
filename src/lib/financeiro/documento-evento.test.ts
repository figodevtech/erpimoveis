import assert from "node:assert/strict";
import test from "node:test";
import { despesaDeVendaLancavel, eventoManualDoOperador, modalidadeDeCriacaoVenda } from "./documento-evento";
import { analisarExclusaoEventoFinanceiro } from "@/lib/ordens/exclusao-evento-financeiro";
import { capacidadesDoEvento, montarLinhas } from "@/components/financeiro/eventos-financeiros/modelo";
import { endpointsDeOrdem, endpointsDeVenda, endpointsDoFinanceiro } from "@/components/financeiro/eventos-financeiros/endpoints";

const evento = {
  id: 1, source_type: "VENDA", source_id: 10, ordemservicoid: null, origem: "PRODUTO",
  natureza: "DESPESA" as const, status: "ATIVO" as const, descricao: "Custo complementar",
  valor: 20, is_manual: true, chave_origem: "MANUAL:teste", pode_gerar_transacao: true,
  created_by: "operador", criado_por: { id: "operador", nome: "Maria" },
};

test("criação distingue avulso e frete; payload ambíguo ou desconhecido nunca cria avulso", () => {
  assert.equal(modalidadeDeCriacaoVenda({ modalidade: "AVULSO", tipo: "PRODUTO" }), "AVULSO");
  assert.equal(modalidadeDeCriacaoVenda({ modalidade: "DESPESA_FRETE", eventoReceitaId: 2 }), "DESPESA_FRETE");
  assert.equal(modalidadeDeCriacaoVenda({ eventoReceitaId: 2 }), "DESPESA_FRETE");
  for (const body of [null, [], {}, { modalidade: "OUTRO", eventoReceitaId: 2 },
    { modalidade: "AVULSO", eventoReceitaId: 2 }, { modalidade: "AVULSO", eventoReceitaServicoId: 2 }]) {
    assert.equal(modalidadeDeCriacaoVenda(body), null);
  }
});

test("proveniência exige a marca e a chave; override de comissão continua automático", () => {
  assert.equal(eventoManualDoOperador(evento), true);
  assert.equal(eventoManualDoOperador({ ...evento, is_manual: false }), false);
  assert.equal(eventoManualDoOperador({ ...evento, chave_origem: "COMISSAO_VENDA" }), false);
  const [linha] = montarLinhas([{ ...evento, origem: "COMISSAO", chave_origem: "COMISSAO_VENDA" }]);
  assert.equal(capacidadesDoEvento(linha).editar, true);
  assert.equal(capacidadesDoEvento(linha).excluir, false);
});

test("receitas e despesas manuais têm CRUD e autor, sem sincronização de snapshot da OS", () => {
  for (const origem of ["PRODUTO", "SERVICO", "CONSUMO", "FRETE"]) {
    for (const natureza of ["RECEITA", "DESPESA"] as const) {
      if ((origem === "CONSUMO" || origem === "FRETE") && natureza === "RECEITA") continue;
      const [linha] = montarLinhas([{ ...evento, origem, natureza }]);
      assert.equal(linha.vendaId, 10);
      assert.equal(linha.criadoPorNome, "Maria");
      assert.equal(capacidadesDoEvento(linha).editar, true);
      assert.equal(capacidadesDoEvento(linha).editarTextos, true);
      assert.equal(capacidadesDoEvento(linha).excluir, true);
      assert.equal(capacidadesDoEvento(linha).sincronizarSnapshot, false);
    }
  }
});

test("automáticos da venda não recebem CRUD; somente despesa manual legítima ou comissão é lançável", () => {
  for (const origem of ["PRODUTO", "FRETE", "DESCONTO", "COMISSAO"]) {
    const automatico = { ...evento, origem, is_manual: false, chave_origem: origem, pode_gerar_transacao: origem === "COMISSAO" };
    const [linha] = montarLinhas([automatico]);
    assert.equal(capacidadesDoEvento(linha).editar, false);
    assert.equal(capacidadesDoEvento(linha).excluir, false);
    assert.equal(despesaDeVendaLancavel(automatico), origem === "COMISSAO");
  }
  assert.equal(despesaDeVendaLancavel(evento), true);
  assert.equal(despesaDeVendaLancavel({ ...evento, pode_gerar_transacao: false }), false);
  assert.equal(despesaDeVendaLancavel({ ...evento, natureza: "RECEITA" }), false);
  assert.equal(despesaDeVendaLancavel({ ...evento, source_id: null }), false);
});

test("edição da venda separa snapshots, comissões e avulsos sem liberar exclusão", () => {
  for (const status of ["ATIVO", "CONVERTIDO"] as const) {
    for (const automatico of [
      { origem: "PRODUTO", natureza: "RECEITA", chave_origem: "10" },
      { origem: "FRETE", natureza: "RECEITA", chave_origem: "FRETE" },
      { origem: "COMISSAO", natureza: "DESPESA", chave_origem: "COMISSAO_VENDA" },
    ] as const) {
      const [linha] = montarLinhas([{ ...evento, ...automatico, status, is_manual: false }]);
      assert.equal(capacidadesDoEvento(linha).editar, true);
      assert.equal(capacidadesDoEvento(linha).editarTextos, false);
      assert.equal(capacidadesDoEvento(linha).excluir, false);
    }
    const [manual] = montarLinhas([{ ...evento, status }]);
    assert.equal(capacidadesDoEvento(manual).editar, true);
    assert.equal(capacidadesDoEvento(manual).editarTextos, true);
  }
  const [ajustada] = montarLinhas([{ ...evento, origem: "COMISSAO", chave_origem: "COMISSAO_VENDA", dados_snapshot: { comissao_ajustada_a_mao: true } }]);
  assert.equal(capacidadesDoEvento(ajustada).editar, true);
  assert.equal(capacidadesDoEvento(ajustada).excluir, false);
  assert.equal(ajustada.comissaoAjustada, true);
});

test("impacto de venda usa sua linguagem e protege qualquer vínculo, sem estorno de estoque", () => {
  for (const statusOs of ["CANCELADA", "CANCELADO", "FINALIZADA", "ORCAMENTO", "ORCAMENTO_RECUSADO"]) {
    const impacto = analisarExclusaoEventoFinanceiro(evento, { documentoTipo: "VENDA", statusOs });
    assert.equal(impacto.podeExcluir, true);
    assert.equal(impacto.devolveEstoque, false);
    assert.ok(impacto.efeitos.some((efeito) => efeito.includes("resultado da venda")));
    assert.ok(impacto.efeitos.every((efeito) => !efeito.includes("OS")));
  }
  for (const vinculo of [{ transacaoid: 3 }, { lancamento_id: 4 }, { status: "CONVERTIDO" }]) {
    const impacto = analisarExclusaoEventoFinanceiro({ ...evento, ...vinculo }, { documentoTipo: "VENDA" });
    assert.equal(impacto.podeExcluir, false);
    assert.match(impacto.bloqueio!, /primeiro/);
  }
  assert.equal(analisarExclusaoEventoFinanceiro({ ...evento, consumo_saida_id: 1, origem: "CONSUMO" }, { documentoTipo: "VENDA" }).podeExcluir, false);
});

test("OS mantém override de comissão, bloqueio de cancelamento e endpoints próprios", () => {
  const [linha] = montarLinhas([{ ...evento, source_type: "ORDEM_SERVICO", ordemservicoid: 9, origem: "COMISSAO", is_manual: false }]);
  assert.equal(capacidadesDoEvento(linha).editar, true);
  assert.equal(capacidadesDoEvento(linha).excluir, false);
  assert.equal(analisarExclusaoEventoFinanceiro(evento, { statusOs: "CANCELADO" }).podeExcluir, false);
  assert.equal(endpointsDeOrdem(9).criar({ tipo: "ORDEM_SERVICO", id: 9 }).url, "/api/ordens/9/eventos-financeiros");
  assert.deepEqual(endpointsDoFinanceiro().criar({ tipo: "ORDEM_SERVICO", id: 9 }).corpoExtra, { ordemServicoId: 9 });
  assert.deepEqual(endpointsDeVenda().criar({ tipo: "VENDA", id: 10 }), { url: "/api/venda/10/eventos-financeiros", corpoExtra: { modalidade: "AVULSO" } });
  assert.deepEqual(endpointsDeVenda().criarDespesaVenda!(10).corpoExtra, { modalidade: "DESPESA_FRETE" });
});
