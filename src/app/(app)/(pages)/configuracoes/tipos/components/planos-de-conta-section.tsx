"use client";

import CategoriasTransacaoSection from "./categorias-transacao-section";

export default function PlanosDeContaSection() {
  return (
    <CategoriasTransacaoSection
      config={{
        endpoint: "/api/tipos/planos-de-conta",
        title: "Planos de conta",
        singular: "plano de conta",
        plural: "planos de conta",
        gender: "M",
        showIcons: false,
      }}
    />
  );
}
