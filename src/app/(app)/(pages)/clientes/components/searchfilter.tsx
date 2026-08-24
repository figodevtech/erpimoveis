import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Status } from "../types";
import { cn } from "@/lib/utils";

interface SearchFilterProps {
    search: string
    setSearch: (value: string)=> void
    onSearch: () => void
    onClear: () => void
    setStatus: (value: Status) => void
    status: Status
    /** Mostra só quem tem título vencido em aberto. */
    devedores: boolean
    setDevedores: (value: boolean) => void

}
export default function SearchFilter ({search, setSearch, onSearch, onClear, setStatus, status, devedores, setDevedores}: SearchFilterProps) {
    return(
          <div className="flex gap-6 flex-col md:flex-row bg-card p-4 rounded-2xl shadow-sm border border-primary/30">
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
            {/*
              Devedor é quem tem título VENCIDO em aberto — não quem apenas tem
              parcela a vencer, que está em dia e não deveria aparecer numa lista
              de cobrança.
            */}
            <Button
              type="button"
              variant={devedores ? "default" : "outline"}
              onClick={() => setDevedores(!devedores)}
              aria-pressed={devedores}
              title="Mostrar só clientes com título vencido em aberto"
              className={cn("w-full md:w-auto shrink-0 gap-2")}
            >
              <AlertCircle className="h-4 w-4" />
              Devedores
            </Button>
          </div>
        
    )
}
