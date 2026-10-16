/** Configuração com as políticas fiscais confirmadas, para testes. */
export function configureSpedPoliciesFixture() {
  return {
    evidencias: {
      politica_credito_revenda: { status: "CONFIRMADO", aplicavel: true, descricao: "Regime normal de apuração" },
      politica_csosn_entrada: { status: "CONFIRMADO", mapa: { "102": "90", "500": "60", "999": "10" }, descricao: "Orientação do contador" },
    },
  };
}
