"use client";

import { useMemo } from "react";
import { SearchCombobox } from "../../(financeiro)/fluxodecaixa/components/search-combobox";

export type UsuarioDoCombobox = {
  id: string;
  nome: string;
  email: string;
};

const ORDENADOR = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});

function nomeExibido(usuario: UsuarioDoCombobox): string {
  return usuario.nome.trim() || usuario.email.trim() || "Usuário sem nome";
}

export function UsuarioCombobox({
  usuarios,
  value,
  usuarioLogadoId,
  onValueChange,
}: {
  usuarios: UsuarioDoCombobox[];
  value: string;
  usuarioLogadoId: string;
  onValueChange: (id: string) => void;
}) {
  const options = useMemo(
    () =>
      [...usuarios]
        .sort((a, b) => {
          const porNome = ORDENADOR.compare(nomeExibido(a), nomeExibido(b));
          if (porNome !== 0) return porNome;

          const porEmail = ORDENADOR.compare(a.email, b.email);
          return porEmail !== 0 ? porEmail : a.id.localeCompare(b.id);
        })
        .map((usuario) => {
          const nome = nomeExibido(usuario);
          return {
            value: usuario.id,
            label: `${nome}${usuario.id === usuarioLogadoId ? " (você)" : ""}`,
            description: usuario.email && usuario.email !== nome ? usuario.email : undefined,
            searchText: `${usuario.nome} ${usuario.email}`,
          };
        }),
    [usuarioLogadoId, usuarios],
  );

  return (
    <SearchCombobox
      value={value}
      options={options}
      onValueChange={onValueChange}
      placeholder="Selecione um usuário"
      searchPlaceholder="Buscar por nome ou e-mail..."
      emptyMessage="Nenhum usuário encontrado."
    />
  );
}

