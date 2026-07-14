"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Estoque_status } from "../types";

interface SearchFilterProps {
  search: string;
  setSearch: (value: string) => void;
  setStatus: (value: Estoque_status) => void;
  status: Estoque_status;
}

export default function FiltroPesquisa({ search, setSearch, setStatus, status }: SearchFilterProps) {
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Busque por código, descrição, referência, título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
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
