"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { Search, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Estoque_status } from "../types";

interface SearchFilterProps {
  search: string;
  setSearch: (value: string) => void;
  setStatus: (value: Estoque_status) => void;
  status: Estoque_status;
}

export default function FiltroPesquisa({ search, setSearch, setStatus, status }: SearchFilterProps) {
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput, setSearch]);

  return (
    <Card>
      <CardContent>
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <form
            className="relative flex-1"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            <button
              type="submit"
              className="absolute left-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Buscar produtos"
            >
              <Search className="h-4 w-4" />
            </button>
            <Input
              placeholder="Busque por código, descrição, referência, título..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="pl-10 pr-10"
            />
            {searchInput && (
              <button
                type="button"
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Limpar busca"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </form>
          <Select value={status} onValueChange={(v) => setStatus(v as Estoque_status)}>
            <SelectTrigger className="w-full md:w-2/6 hover:cursor-pointer">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem className="hover:cursor-pointer" value={Estoque_status.TODOS}>
                Todos
              </SelectItem>
              <SelectItem className="hover:cursor-pointer" value={Estoque_status.OK}>
                Ok
              </SelectItem>
              <SelectItem className="hover:cursor-pointer" value={Estoque_status.BAIXO}>
                Estoque Baixo
              </SelectItem>
              <SelectItem className="hover:cursor-pointer" value={Estoque_status.CRITICO}>
                Crítico
              </SelectItem>
              <SelectItem className="hover:cursor-pointer" value={Estoque_status.SEM_ESTOQUE}>
                Sem Estoque
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
