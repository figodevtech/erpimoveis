"use client";

import { Wrench } from "lucide-react";
import { TabelaOrcamento } from "./tabela-orcamento";
import type { LinhaOrcamento } from "./tipos";

export function TabelaServicos({ itens }: { itens: LinhaOrcamento[] }) {
  return (
    <TabelaOrcamento
      titulo="Serviços"
      icone={Wrench}
      vazio="Nenhum serviço no orçamento."
      itens={itens}
    />
  );
}
