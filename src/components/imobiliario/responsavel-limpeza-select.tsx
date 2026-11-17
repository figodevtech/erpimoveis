"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/search-combobox";
import { requestJson } from "./shared";

type Usuario = { id: string; nome: string; email: string };

const ORDENADOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const nomeExibido = (u: Usuario) => u.nome.trim() || u.email.trim() || "Usuário sem nome";

// A lista muda pouco: uma leitura por sessão da página serve ao check-out, à Execução e às configurações.
let pendente: Promise<Usuario[]> | null = null;
function carregarUsuarios() {
  if (!pendente) {
    pendente = requestJson("/api/imobiliario/lookup?tipo=usuarios")
      .then((r) => (r.items ?? []) as Usuario[])
      .catch((error) => {
        pendente = null;
        throw error;
      });
  }
  return pendente;
}

/**
 * Responsável pela limpeza: qualquer usuário ativo do ERP, ou nenhum. Um id que não está na
 * lista (usuário inativado depois de virar padrão) é descartado ao carregar.
 */
export function ResponsavelLimpezaSelect({
  value,
  onValueChange,
  disabled,
}: {
  value: string | null | undefined;
  onValueChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    carregarUsuarios()
      .then((lista) => ativo && setUsuarios(lista))
      .catch((error) => ativo && setErro((error as Error).message));
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    if (usuarios && value && !usuarios.some((u) => u.id === value)) onValueChange(null);
  }, [usuarios, value, onValueChange]);

  const options = useMemo(
    () =>
      [...(usuarios ?? [])]
        .sort((a, b) => ORDENADOR.compare(nomeExibido(a), nomeExibido(b)) || a.id.localeCompare(b.id))
        .map((u) => ({
          value: u.id,
          label: nomeExibido(u),
          description: u.email && u.email !== nomeExibido(u) ? u.email : undefined,
          searchText: `${u.nome} ${u.email}`,
        })),
    [usuarios],
  );

  if (erro) return <p className="text-xs text-destructive">Não foi possível carregar os usuários: {erro}</p>;

  return (
    <SearchCombobox
      value={value ?? ""}
      options={options}
      onValueChange={(id) => onValueChange(id || null)}
      loading={!usuarios}
      disabled={disabled}
      placeholder="Sem responsável"
      searchPlaceholder="Buscar por nome ou e-mail..."
      emptyMessage="Nenhum usuário encontrado."
      clearable
      clearLabel="Sem responsável"
    />
  );
}
