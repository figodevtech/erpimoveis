import UsoConsumoClient from "../../usoconsumo/usoconsumo-client";

// Mesma tela do estoque de uso e consumo: os dois estoques simples dividem
// tabela, rotas e componentes, e se separam por `escopo`.
export default function EstoqueGeralPage() {
  return <UsoConsumoClient escopo="GERAL" />;
}
