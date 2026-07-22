"use client";

import CategoriasTransacaoSection from "./categorias-transacao-section";

export default function CentrosCustoSection() {
  return (
    <CategoriasTransacaoSection
      config={{
        endpoint: "/api/tipos/centros-de-custo",
        title: "Centros de custo",
        singular: "centro de custo",
        plural: "centros de custo",
        gender: "M",
        showIcons: false,
      }}
    />
  );
}
