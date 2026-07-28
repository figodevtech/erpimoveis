import { Input } from "@/components/ui/input";
import { SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Select } from "@radix-ui/react-select";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Status } from "../types";

interface SearchFilterProps {
    search: string
    setSearch: (value: string)=> void
    onSearch: () => void
    onClear: () => void
    setStatus: (value: Status) => void
    status: Status

}
export default function SearchFilter ({search, setSearch, onSearch, onClear, setStatus, status}: SearchFilterProps) {
    return(
          <div className="flex gap-6 flex-col md:flex-row">
            <div className="relative w-full">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute left-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2"
                onClick={onSearch}
                aria-label="Pesquisar clientes"
                title="Pesquisar"
              >
                <Search className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSearch();
                  }
                }}
                placeholder="Buscar por nome, email ou telefone..."
                className="pl-10 pr-10"
              />
              {search ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                  onClick={onClear}
                  aria-label="Limpar busca"
                  title="Limpar busca"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              ) : null}
            </div>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as Status)}
            >
              <SelectTrigger className="w-full md:w-2/6 hover:cursor-pointer">
                <SelectValue placeholder="Todos"></SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={Status.TODOS}
                  className="hover:cursor-pointer"
                >
                  Todos
                </SelectItem>
                <SelectItem
                  value={Status.ATIVO}
                  className="hover:cursor-pointer"
                >
                  Ativos
                </SelectItem>
                <SelectItem
                  value={Status.INATIVO}
                  className="hover:cursor-pointer"
                >
                  Inativos
                </SelectItem>
                <SelectItem
                  value={Status.PENDENTE}
                  className="hover:cursor-pointer"
                >
                  Pendentes
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        
    )
}
