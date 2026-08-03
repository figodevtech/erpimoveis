"use client";

import { Package } from "lucide-react";
import { TabelaOrcamento } from "./tabela-orcamento";
import type { LinhaOrcamento } from "./tipos";

export function TabelaProdutos({ itens }: { itens: LinhaOrcamento[] }) {
  return (
    <TabelaOrcamento
      titulo="Produtos"
      icone={Package}
      vazio="Nenhum produto no orçamento."
      itens={itens}
    />
  );
}
